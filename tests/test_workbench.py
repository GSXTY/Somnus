from contextlib import closing
from datetime import datetime
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler

from agent_core.workbench import MODELS, dashboard, user_detail, reporting_quality
from agent_core.sql_access import SqlSettings
from event_detection import viewer

NOW = datetime.fromisoformat('2026-11-09T15:00:00+08:00')


class WorkbenchDataTests(unittest.TestCase):
    def test_live_snore_models_use_their_own_dated_summary_rows(self):
        tables = ('statistics_ya43', 'statistics_ya46')
        settings = SqlSettings('mysql://example.invalid/db', allowed_tables=tables)
        with closing(sqlite3.connect(':memory:')) as database:
            database.create_function('regexp', 2, lambda pattern, value: bool(value and re.search(pattern, value)))
            for table in tables:
                database.execute(f'CREATE TABLE {table}(record_date VARCHAR, userid INT, deviceid VARCHAR, snore_count INT)')
                database.execute(f"INSERT INTO {table} VALUES ('2026-11-08', 1, 'a', 4)")
                database.execute(f"INSERT INTO {table} VALUES ('2026-11-01', 2, 'z', 2), ('2026-11-09', 2, 'z', 2)")
            database.execute('ALTER TABLE statistics_ya43 ADD COLUMN success_count int')
            database.execute("UPDATE statistics_ya43 SET success_count=3 WHERE record_date='2026-11-08'")
            database.execute("""INSERT INTO statistics_ya46 VALUES ('2026-11-08 17:00:00', 1, 'b', 7),
                             ('2026-11-02', 2, 'q', 1), ('2026-11-08-invalid', 2, 'bad', 900)""")

            def query(_settings, sql, params=()):
                if 'information_schema.columns' in sql:
                    self.assertIn(params[0], tables)
                    return [('record_date', 'varchar'), ('userid', 'bigint'), ('deviceid', 'varchar'),
                            ('snore_count', 'int'), *([('success_count', 'int')] if params[0] == tables[0] else [])]
                return database.execute(sql.replace('%s', '?'), params).fetchall()

            with (patch('agent_core.live_dashboard._rows', side_effect=query),
                  patch('agent_core.live_dashboard.device_types', return_value=[])):
                for model, expected in [('YA43', [1, 1, 1, 4, 3]), ('YA46', [2, 1, 2, 11])]:
                    data = dashboard({'source': ['live'], 'model': [model]}, NOW, settings=settings)
                    self.assertEqual(data['source']['mode'], 'live')
                    self.assertEqual(data['model_scope'], [model])
                    self.assertEqual(
                        [metric['value'] for metric in data['home']['metrics']], expected,
                    )
                    points = data['home']['charts'][0]['points']
                    self.assertEqual((points[0]['date'], points[-1]['date']), ('2026-11-02', '2026-11-08'))
                    self.assertGreater(sum(point['value'] for point in points), 0)
                    self.assertTrue(all(value['value'] is None for value in data['kpis'].values()))
                    self.assertIn(dict(value=model, label=model, home_only=True), data['model_options'])

    def test_live_snore_models_preserve_discovery_reason_without_manufacturing_metrics(self):
        settings = SqlSettings('mysql://example.invalid/db', allowed_tables=('statistics_ya43',))
        query = {'source': ['live'], 'model': ['YA43']}
        for metadata, expected in [
            ([], '字段结构'),
            ([('start_time', 'datetime')], '缺少已确认'),
            ([('record_date', 'int'), ('userid', 'bigint'), ('deviceid', 'varchar'),
              ('snore_count', 'int')], 'record_date 类型'),
        ]:
            with self.subTest(metadata=metadata):
                with (patch('agent_core.live_dashboard.available', return_value=True),
                      patch('agent_core.live_dashboard.device_types', return_value=[]),
                      patch('agent_core.live_dashboard._rows', return_value=metadata) as rows):
                    result = dashboard(query, NOW, settings=settings)
                self.assertIn(expected, result['source']['label'])
                self.assertEqual(result['home'], {'metrics': [], 'charts': []})
                self.assertEqual(rows.call_count, 1)
        with patch('agent_core.live_dashboard.available', return_value=False):
            result = dashboard(query, NOW, settings=settings)
        self.assertIn('连接', result['source']['label'])
        self.assertEqual(result['model_options'], [dict(value='YA43', label='YA43', home_only=True)])
        with patch('agent_core.live_dashboard.available') as probe:
            result = dashboard({'source': ['live'], 'model': ['YA46']}, NOW, settings=settings)
        probe.assert_not_called()
        self.assertIn('白名单', result['source']['label'])

    def test_live_ya50_uses_daily_reports_without_double_counting_or_estimating_events(self):
        settings = SqlSettings('mysql://example.invalid/db', allowed_tables=('resp_statistics',))
        with closing(sqlite3.connect(':memory:')) as database:
            database.execute('CREATE TABLE resp_statistics(record_date TEXT, userid TEXT, treat_time INT, breath_event_index REAL)')
            database.executemany('INSERT INTO resp_statistics VALUES (?, ?, ?, ?)', (
                ('2026-11-08', 'a', 60, 3), ('2026-11-08', 'a', 90, 3),
                ('2026-11-08', 'b', 30, 7), ('2026-11-08', None, 60, 1),
                ('2026-11-08', '', 60, 1), ('2026-11-08', 'c', 0, 2),
                ('2026-11-07', 'a', 30, None), ('2026-11-09', 'a', 240, 99),
            ))

            def query(_settings, sql, params=()):
                return database.execute(sql.replace('%s', '?'), params).fetchall()

            with patch('agent_core.live_dashboard._rows', side_effect=query):
                data = dashboard({'source': ['live'], 'model': ['YA50']}, NOW, settings=settings)

        self.assertEqual(data['source']['mode'], 'live')
        self.assertEqual(data['model_scope'], ['YA50'])
        self.assertIn({'value': 'YA50', 'label': 'YA50'}, data['model_options'])
        self.assertEqual(len(data['daily']), 7)
        self.assertEqual(data['kpis']['active_users']['value'], 2)
        self.assertEqual(data['kpis']['active_users']['previous'], 1)
        self.assertEqual(data['kpis']['treatment_hours']['value'], 2.0)
        self.assertEqual(data['kpis']['avg_ahi']['value'], 5.0)
        self.assertIn('呼吸事件指数', data['kpis']['avg_ahi']['label'])
        self.assertIsNone(data['kpis']['reported_events']['value'])
        self.assertTrue(all(day['event_count'] is None for day in data['daily']))

    def test_live_ya50_reports_unavailable_when_database_cannot_be_verified(self):
        settings = SqlSettings('mysql://example.invalid/db', allowed_tables=('resp_statistics',))
        with (patch('agent_core.live_dashboard.available', return_value=True),
              patch('agent_core.live_dashboard.device_types', return_value=[]),
              patch('agent_core.live_dashboard._rows', side_effect=RuntimeError('private connection detail'))):
            data = dashboard({'source': ['live'], 'model': ['YA50']}, NOW, settings=settings)

        self.assertEqual(data['source']['mode'], 'unconfigured')
        self.assertEqual(data['daily'], [])
        self.assertIsNone(data['kpis']['active_users']['value'])
        self.assertEqual(data['model_options'], [{'value': 'YA50', 'label': 'YA50'}])
        self.assertNotIn('private connection detail', str(data))

    def test_reporting_loss_uses_additive_counters_and_weighted_rate(self):
        whole=dashboard({},NOW)['data_quality']
        parts=[dashboard({'model':[model]},NOW)['data_quality'] for model in MODELS]
        for key in ('expected_records','received_records','lost_records'):
            self.assertEqual(whole[key],sum(part[key] for part in parts))
            self.assertIs(type(whole[key]),int)
        self.assertEqual(whole['expected_records'],whole['received_records']+whole['lost_records'])
        self.assertAlmostEqual(whole['loss_rate'],whole['lost_records']/whole['expected_records']*100)
        self.assertNotAlmostEqual(whole['loss_rate'],sum(p['loss_rate'] for p in parts)/len(parts))
        self.assertEqual(whole['unit'],'records')
        self.assertIn('合成',whole['basis'])
        self.assertIn('当前上海自然日',whole['basis'])
        for part in parts:
            self.assertGreaterEqual(part['received_records'],0)
            self.assertGreaterEqual(part['lost_records'],0)
            self.assertLessEqual(part['received_records'],part['expected_records'])
            self.assertGreaterEqual(part['loss_rate'],0)
            self.assertLessEqual(part['loss_rate'],100)
        self.assertEqual(dashboard({'model':['YA70LAB']},NOW)['data_quality']['loss_rate'],0)
        # Rendering a different alert population must not change upload counts.
        with patch('agent_core.workbench._alerts',return_value=[]):
            self.assertEqual(dashboard({},NOW)['data_quality'],whole)

    def test_reporting_loss_unknown_zero_and_invalid_counters(self):
        self.assertEqual(reporting_quality(0,0)['lost_records'],0)
        self.assertIsNone(reporting_quality(0,0)['loss_rate'])
        self.assertEqual(reporting_quality(100,0)['loss_rate'],100)
        self.assertEqual(reporting_quality(100,100)['loss_rate'],0)
        self.assertIsNone(reporting_quality(100,None)['loss_rate'])
        for expected,received in ((-1,0),(10,-1),(10,11),(0,1),(True,0),(10,True),
                                  (10.,8),(10,float('nan'))):
            with self.subTest(expected=expected,received=received),self.assertRaises(ValueError):
                reporting_quality(expected,received)
        live=dashboard({'source':['live']},NOW)['data_quality']
        for key in ('expected_records','received_records','lost_records','loss_rate'):
            self.assertIsNone(live[key])
        self.assertEqual(live['unit'],'records')
        self.assertIn('尚未接入',live['basis'])
        # Returned values cannot poison the next dashboard response.
        first=dashboard({},NOW);first['data_quality']['loss_rate']=-1
        self.assertGreaterEqual(dashboard({},NOW)['data_quality']['loss_rate'],0)

    def test_model_partitions_preserve_population_totals_and_alert_identity(self):
        all_data = dashboard({}, NOW)
        parts = [dashboard({'model':[model]}, NOW) for model in MODELS]
        self.assertEqual(sum(len(p['users']) for p in parts), len(all_data['users']))
        for key in ('active_users', 'treatment_hours', 'reported_events'):
            self.assertAlmostEqual(sum(p['kpis'][key]['value'] for p in parts), all_data['kpis'][key]['value'])
        self.assertEqual(sum(p['fleet']['online'] for p in parts), all_data['fleet']['online'])
        alerts = {alert['id']:alert for alert in all_data['alerts']}
        for part in parts:
            for alert in part['alerts']:
                self.assertEqual(alert, alerts[alert['id']])
        self.assertEqual(sum(row['value'] for row in all_data['alert_distribution']), len(alerts))

    def test_kpi_periods_and_current_fleet_are_explicit(self):
        data = dashboard({}, NOW)
        self.assertEqual(data['period']['kpi_date'], '2026-11-08')
        self.assertEqual(len(data['daily']), 7)
        for key, field in (('active_users','active_users'), ('treatment_hours','treatment_hours'),
                           ('reported_events','event_count')):
            self.assertEqual(data['kpis'][key]['value'], data['daily'][-1][field])
            self.assertEqual(data['kpis'][key]['previous'], data['daily'][-2][field])
            self.assertEqual(len(data['kpis'][key]['trend']), 7)
        fleet = data['fleet']
        self.assertEqual(data['kpis']['online_rate']['value'], 100*fleet['online']/fleet['total'])
        self.assertIsNone(fleet['latency_seconds'])

    def test_unknown_live_source_does_not_fall_back_to_demo_or_zero(self):
        data = dashboard({'source':['live']}, NOW)
        self.assertEqual(data['source']['mode'], 'unconfigured')
        self.assertFalse(data['source']['connected'])
        self.assertEqual(data['users'], [])
        self.assertEqual(data['daily'], [])
        self.assertEqual(data['alerts'], [])
        self.assertIsNone(data['kpis']['reported_events']['value'])
        self.assertIsNone(data['fleet']['online'])
        self.assertIsNone(user_detail('demo-001', {'source':['live']}, NOW)['waveform'])

    def test_detail_is_consistent_bounded_and_cannot_bind_a_real_record(self):
        data = dashboard({}, NOW)
        self.assertFalse(any('waveform' in row for row in data['users']))
        for row in data['users']:
            detail = user_detail(row['id'], {}, NOW)
            self.assertEqual(row, detail['user'])
            self.assertIsNone(row['recording_ref'])
            self.assertEqual(detail['event_count'], row['events_24h'])
            self.assertEqual(len(detail['events']), detail['event_count'])
            wave = detail['waveform']
            self.assertEqual(wave['origin'], 'synthetic')
            for channel in wave['channels']:
                self.assertEqual(len(channel['points']), 721)
                self.assertEqual(channel['points'][0][0], 0)
                self.assertEqual(channel['points'][-1][0], wave['duration_seconds'])
            for event in detail['events']:
                self.assertLess(event['start'], event['end'])
                self.assertLessEqual(event['end'], wave['duration_seconds'])
        critical = [a for a in data['alerts'] if a['severity']=='critical']
        self.assertTrue(critical)
        self.assertTrue(all(a['preview']['duration_seconds']==30 for a in critical))
        # Source samples are fresh values: changing a returned object cannot poison future calls.
        detail['waveform']['channels'][0]['points'][0][1] = -999
        self.assertNotEqual(user_detail(row['id'], {}, NOW)['waveform']['channels'][0]['points'][0][1], -999)

    def test_invalid_source_model_and_user_are_explicit_errors(self):
        for query in ({'source':['unknown']}, {'model':['YA50']}):
            with self.assertRaises(ValueError): dashboard(query, NOW)
        with self.assertRaises(LookupError): user_detail('real-user-id', {}, NOW)
        with self.assertRaises(LookupError): user_detail('demo-001', {'model':['YA70B20']}, NOW)


class WorkbenchHttpTests(unittest.TestCase):
    def test_routes_assets_and_source_boundary_without_opening_csv(self):
        previous = viewer.recording, viewer.event_store, viewer.PAGE_ASSETS
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            web = root/'web'
            (web/'assets').mkdir(parents=True)
            (web/'index.html').write_text('<div id="root"></div><script src="/workbench-assets/assets/main.js"></script>', encoding='utf-8')
            (web/'assets'/'main.js').write_text('window.example=1;', encoding='utf-8')
            (root/'outside.txt').write_text('PRIVATE', encoding='utf-8')
            viewer.recording = None
            viewer.event_store = None
            viewer.PAGE_ASSETS = root
            server = viewer.ThreadingHTTPServer(('127.0.0.1',0), viewer.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            client = build_opener(ProxyHandler({}))
            def get(path):
                return client.open(f'http://127.0.0.1:{server.server_port}'+path, timeout=10)
            try:
                with get('/') as response:
                    self.assertIn(b'/workbench-assets/assets/main.js', response.read())
                with get('/workbench-assets/assets/main.js') as response:
                    self.assertEqual(response.headers.get_content_type(), 'text/javascript')
                    self.assertIn(b'window.example', response.read())
                with get('/api/workbench') as response:
                    data=json.load(response)
                    self.assertEqual(data['source']['mode'], 'demo')
                    self.assertEqual(data['data_quality'],dashboard({})['data_quality'])
                with get('/api/workbench?model=YA70B20') as response:
                    quality=json.load(response)['data_quality']
                    self.assertEqual(quality['expected_records'],96000)
                    self.assertEqual(quality['received_records'],94560)
                    self.assertEqual(quality['lost_records'],1440)
                    self.assertEqual(quality['loss_rate'],1.5)
                with get('/api/workbench?source=live') as response:
                    data=json.load(response)
                    self.assertIsNone(data['kpis']['active_users']['value'])
                    self.assertTrue(all(data['data_quality'][key] is None for key in
                                        ('expected_records','received_records','lost_records','loss_rate')))
                with get('/api/workbench/users/demo-001?source=demo') as response:
                    self.assertEqual(json.load(response)['user']['id'], 'demo-001')
                with get('/api/workbench/detection-context') as response:
                    context = json.load(response)
                    self.assertFalse(context['available'])
                    self.assertFalse(context['user_binding']['verified'])
                for path, status in (('/api/workbench?model=YA50',400),
                                     ('/api/workbench/users/no-user',404),
                                     ('/workbench-assets/%2e%2e/outside.txt',404),
                                     ('/workbench-assets/..%5coutside.txt',404),
                                     ('/workbench-assets/missing.js',404)):
                    with self.assertRaises(HTTPError) as error: get(path)
                    self.assertEqual(error.exception.code, status)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(5)
                viewer.recording, viewer.event_store, viewer.PAGE_ASSETS = previous


if __name__ == '__main__':
    unittest.main()
