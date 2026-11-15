from datetime import date, datetime, timezone
import unittest

from agent_core.analytics import User, UsageSession, Snapshot, aggregate, dashboard


def stamp(value):
    return datetime.fromisoformat(value)


class UserAnalyticsTests(unittest.TestCase):
    def test_overlap_midnight_clipping_and_active_user_day_denominator(self):
        users = (User('a', stamp('2026-01-01T00:00:00+08:00')),
                 User('b', stamp('2026-11-09T08:00:00+08:00')),
                 User('future', stamp('2026-11-10T00:00:00+08:00')))
        sessions = (
            UsageSession('a', stamp('2026-11-08T23:30:00+08:00'), stamp('2026-11-09T00:30:00+08:00')),
            UsageSession('a', stamp('2026-11-09T00:00:00+08:00'), stamp('2026-11-09T01:00:00+08:00')),
            UsageSession('a', stamp('2026-11-09T00:00:00+08:00'), stamp('2026-11-09T01:00:00+08:00')),
            UsageSession('b', stamp('2026-11-09T23:00:00+08:00'), stamp('2026-11-10T01:00:00+08:00')),
        )
        result = aggregate(Snapshot(users, sessions), date(2026,11,8), date(2026,11,9))
        self.assertEqual(result['metrics'], dict(total_users=2, new_users=1, active_users=2,
            total_usage_minutes=150, active_user_days=3, avg_daily_usage_minutes=50))
        self.assertEqual([d['usage_minutes'] for d in result['daily']], [30, 120])
        self.assertEqual([d['active_users'] for d in result['daily']], [1, 2])

    def test_offset_registration_boundaries_and_no_usage_is_unknown(self):
        user = User('a', stamp('2026-11-08T16:00:00+00:00'))
        result = aggregate(Snapshot((user,user), ()), date(2026,11,9), date(2026,11,9))
        self.assertEqual(result['metrics']['new_users'], 1)
        self.assertEqual(result['metrics']['active_users'], 0)
        self.assertIsNone(result['metrics']['avg_daily_usage_minutes'])
        self.assertIsNone(result['users'][0]['avg_daily_usage_minutes'])

    def test_unknown_users_are_excluded_and_sessions_before_registration_clipped(self):
        user = User('a', stamp('2026-11-09T10:00:00+08:00'))
        sessions = (UsageSession('a', stamp('2026-11-09T09:00:00+08:00'), stamp('2026-11-09T11:00:00+08:00')),
                    UsageSession('unknown', stamp('2026-11-09T09:00:00+08:00'), stamp('2026-11-09T11:00:00+08:00')))
        result = aggregate(Snapshot((user,), sessions), date(2026,11,9), date(2026,11,9))
        self.assertEqual(result['metrics']['total_usage_minutes'], 60)
        self.assertTrue(result['warnings'])

    def test_unconfigured_and_demo_cannot_masquerade_as_connected(self):
        unconfigured = dashboard({}, today=date(2026,11,9))
        self.assertIsNone(unconfigured['metrics']['total_users'])
        self.assertFalse(unconfigured['source']['connected'])
        self.assertEqual(len(unconfigured['daily']), 0)
        demo = dashboard({'source':['demo']}, today=date(2026,11,9))
        self.assertEqual(demo['source']['mode'], 'demo')
        self.assertFalse(demo['source']['connected'])
        self.assertEqual(len(demo['daily']), 30)
        self.assertEqual(demo['metrics']['total_users'], 4)
        self.assertEqual(demo['metrics']['new_users'], 3)
        self.assertTrue(all(not u['recordings_available'] for u in demo['users']))

    def test_invalid_range_source_timestamps_and_conflicting_users_are_rejected(self):
        for query in ({'source':['csv']}, {'start_date':['bad']},
                      {'start_date':['2026-11-10'],'end_date':['2026-11-09']},
                      {'start_date':['2020-01-01'],'end_date':['2026-11-09']}):
            with self.assertRaises(ValueError): dashboard(query)
        with self.assertRaises(ValueError):
            aggregate(Snapshot((User('a', datetime(2026,11,9)),), ()), date(2026,11,9), date(2026,11,9))
        with self.assertRaises(ValueError):
            aggregate(Snapshot((User('a', stamp('2026-11-09T00:00:00+08:00')),
                User('a', stamp('2026-11-09T01:00:00+08:00'))), ()), date(2026,11,9), date(2026,11,9))

    def test_read_only_adapter_injection_and_complete_population(self):
        class Repository:
            def snapshot(self, start_at, end_at):
                self.bounds = start_at, end_at
                return Snapshot((User('database-user', stamp('2026-11-09T00:00:00+08:00')),), ())
        repository = Repository()
        result = dashboard({}, repository, today=date(2026,11,9))
        self.assertEqual(result['source']['mode'], 'live')
        self.assertTrue(result['source']['connected'])
        self.assertEqual(result['metrics']['total_users'], 1)
        self.assertEqual(repository.bounds[1].astimezone(timezone.utc), stamp('2026-11-09T16:00:00+00:00'))


if __name__ == '__main__':
    unittest.main()
