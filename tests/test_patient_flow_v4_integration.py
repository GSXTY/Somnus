"""Exercise the real shared API and storage with a temporary synthetic recording."""
import copy
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, ProxyHandler, build_opener

import numpy as np
import pandas as pd

from event_detection import viewer
from event_detection.event_store import EventStore, scan_fingerprint, validate_event
from event_detection.patient_flow_v4 import VERSION, names, settings, waveform_channels
from app_version import APP_ID, APP_VERSION


def fixture():
    seconds = np.repeat(np.arange(200), 20)
    amplitude = np.where((seconds>=80)&(seconds<100), .02, np.where((seconds>=135)&(seconds<155), .4, 1.))
    flow = np.tile([20., -20.], len(seconds)//2)*amplitude
    frame = pd.DataFrame({'时间':pd.Timestamp('2026-11-01')+pd.to_timedelta(seconds,unit='s'),
                          '流量':flow,'压力':600.,'漏气量':2.,'运行状态':1,'模式':1})
    return viewer.Recording(frame.to_csv(index=False).encode('utf-8'), 'synthetic-patient.csv')


class PatientFlowIntegrationTests(unittest.TestCase):
    def test_health_is_backward_compatible_and_available_without_recording(self):
        handler=viewer.Handler.__new__(viewer.Handler)
        handler.path='/api/health'
        handler.send=Mock()
        with patch.object(viewer,'recording',None):
            handler.do_GET()
        packet=handler.send.call_args.args[0]
        self.assertEqual(packet['app_id'],APP_ID)
        self.assertEqual(packet['app_version'],APP_VERSION)
        self.assertEqual(packet['entrypoints'],{'workbench':'/','events':'/events'})
        self.assertEqual(packet['detection_profiles']['patient_flow_v4'],VERSION)

    def test_metadata_uses_user_confirmation_without_claiming_sampling_verification(self):
        recording = fixture()
        self.assertIn('患者呼吸流量',recording.meta['channel_roles']['流量'])
        self.assertEqual(recording.meta['flow_semantics']['confirmation'],'user')
        self.assertFalse(recording.meta['flow_semantics']['leak_subtraction'])
        self.assertFalse(recording.meta['sampling_info']['uniform_sampling_verified'])
        self.assertEqual(recording.meta['patient_flow_v4_version'],VERSION)
        self.assertTrue(all(name in recording.meta['channels'] for name in names(5)))

    def test_api_readonly_scan_review_snapshot_wave_and_feedback_scopes(self):
        original=viewer.recording,viewer.event_store
        with tempfile.TemporaryDirectory() as temp:
            recording=fixture();fid=recording.meta['file_id']
            viewer.recording=recording;viewer.event_store=EventStore(Path(temp)/'events.sqlite3')
            server=viewer.ThreadingHTTPServer(('127.0.0.1',0),viewer.Handler)
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            client=build_opener(ProxyHandler({}))
            def call(path,body=None):
                request=Request(f'http://127.0.0.1:{server.server_port}'+path,
                                data=None if body is None else json.dumps(body).encode('utf-8'),
                                headers={'Content-Type':'application/json'})
                with client.open(request,timeout=20) as response:return json.load(response)
            args=dict(file_id=fid,profile='patient_flow_v4',dynamic_method='absolute_mean',window_seconds=5,min_duration=10)
            try:
                health=call('/api/health')
                self.assertEqual(health['entrypoints'],{'workbench':'/','events':'/events'})
                self.assertEqual(health['detection_profiles']['patient_flow_v4'],VERSION)
                before=viewer.event_store.read(fid)
                analyzed=call('/api/analyze',args)
                self.assertTrue(analyzed['read_only'])
                self.assertEqual(analyzed['settings']['flow_semantics'],'user_confirmed_patient_flow')
                self.assertEqual(viewer.event_store.read(fid),before)
                self.assertIsNone(call('/api/scans/match',args)['match'])
                result=call('/api/detect',args)
                events=[e for e in result['packet']['events'] if e['detection_profile']=='patient_flow_v4']
                self.assertEqual({e['type'] for e in events},{'呼吸暂停候选','低通气候选'})
                self.assertEqual(len(events),2)
                self.assertTrue(all(e['status']=='candidate' for e in events))
                self.assertIsNotNone(call('/api/scans/match',args)['match'])
                self.assertIsNone(call('/api/scans/match',dict(args,window_seconds=4))['match'])
                run=result['packet']['run_id']
                snapshot=viewer.event_store.feedback(recording.meta,run,'automatic')
                self.assertEqual(snapshot['signal_metadata']['flow_semantics']['confirmation'],'user')
                self.assertEqual(snapshot['time_basis'],'raw')
                packet=viewer.event_store.read(fid)
                original_evidence=copy.deepcopy(events[0]['evidence'])
                target=next(e for e in packet['events'] if e['id']==events[0]['id'])
                target.update(status='reviewed',note='human review',start=target['start']+.25)
                updated=call('/api/events',packet)
                reviewed=next(e for e in updated['events'] if e['id']==target['id'])
                self.assertEqual(reviewed['evidence'],original_evidence)
                repeated=call('/api/detect',args)
                self.assertEqual(repeated['added'],0)
                self.assertEqual(next(e for e in repeated['packet']['events'] if e['id']==target['id']),reviewed)
                self.assertEqual(viewer.event_store.feedback(recording.meta,run,'automatic'),snapshot)
                # Pending annotations of a different window do not enter this review.
                other=call('/api/detect',dict(args,window_seconds=4))
                self.assertGreater(other['added'],0)
                for e in repeated['packet']['events']:e['status']='reviewed'
                live=viewer.event_store.read(fid)
                chosen_ids={e['id'] for e in repeated['packet']['events']}
                for e in live['events']:
                    if e['id'] in chosen_ids:e['status']='reviewed'
                call('/api/events',live)
                feedback=call('/api/feedback',dict(file_id=fid,run_id=run,kind='reviewed',reviewer='test',
                         reviewed_range=[0,recording.meta['raw_duration']],reviewed_types=['呼吸暂停候选','低通气候选'],review_mode='complete'))
                self.assertTrue(all(e['detection_window_seconds']==5 for e in feedback['events']))
                self.assertEqual(feedback['signal_metadata']['flow_semantics']['confirmation'],'user')
                wave=call('/api/wave?'+urlencode(dict(file_id=fid,start=60,end=170,channel=names(5),pixels=1200,
                              mode='raw',optimized_method='detrended_abs',optimized_duration=5),doseq=True))
                expected=waveform_channels(recording,names(5))
                for name,points in wave['series'].items():
                    self.assertTrue(any(p[1] is not None for p in points))
                    for _,value,index in points:
                        if value is not None:self.assertAlmostEqual(value,expected[name][index])
                for invalid in (dict(args,min_duration=5),dict(args,dynamic_method='detrended_abs')):
                    with self.assertRaises(HTTPError) as error:call('/api/analyze',invalid)
                    self.assertEqual(error.exception.code,400)
            finally:
                server.shutdown();server.server_close();worker.join(2)
                viewer.recording,viewer.event_store=original

    def test_scan_fingerprint_and_event_validation_isolate_v4_configuration(self):
        recording=fixture()
        one=settings(window_seconds=1);five=settings(window_seconds=5)
        self.assertNotEqual(scan_fingerprint(0,199,one),scan_fingerprint(0,199,five))
        event=dict(id='test',start=80,end=100,mode='raw',type='呼吸暂停候选',channels=['流量'],
                   source='detector',status='candidate',updated_at='now',note='',
                   detection_profile='patient_flow_v4',detection_version=VERSION,detection_method='absolute_mean',
                   detection_window_seconds=5,detection_min_duration=10,evidence={'schema':1,'value':.1})
        self.assertEqual(validate_event(event,recording.meta)['evidence'],event['evidence'])
        for patch in ({'detection_min_duration':5},{'detection_method':'detrended_abs'},{'detection_window_seconds':True}):
            with self.assertRaises(ValueError):validate_event(dict(event,**patch),recording.meta)


if __name__=='__main__':unittest.main()
