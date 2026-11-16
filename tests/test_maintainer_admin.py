import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from maintainer_admin.app import create_app
from maintainer_admin.releases import AdminError, Draft, version_key
from model_relay.control import RelayControl


class MaintainerTests(unittest.TestCase):
    def test_host_origin_auth_draft_and_relay(self):
        with TemporaryDirectory() as folder:
            control = Path(folder) / 'sharing.json'
            make = lambda: TestClient(create_app(folder, control, 'owner-only'),
                                      base_url='http://127.0.0.1:8895')
            credentials = {'Authorization': 'Bearer owner-only'}
            with make() as local:
                self.assertEqual(local.get('/').status_code, 200)
                self.assertEqual(local.get('/api/state').status_code, 401)
                credentials['Origin'] = 'https://external.test'
                self.assertEqual(local.post('/api/relay', json={'enabled': True}, headers=credentials).status_code, 403)
                del credentials['Origin']
                self.assertEqual(local.get('/', headers={'Host': 'other.test'}).status_code, 403)
                enabled = {'enabled': True}
                self.assertEqual(local.post('/api/relay', json=enabled, headers=credentials).json(), enabled)
                self.assertTrue(RelayControl(control).enabled())
                fields = dict(version='0.3.0-beta.6', handoff=False, notes='Verify release', signed=False)
                self.assertEqual(local.post('/api/submit', json=fields, headers=credentials).status_code, 400)
                self.assertEqual(local.post('/api/draft', json=fields, headers=credentials).json(), fields)
            with make() as restarted, patch('maintainer_admin.app.StandardRelease.submit',
                                             return_value={'version': fields['version']}) as publish:
                response = restarted.post('/api/submit', json=fields, headers=credentials)
                self.assertEqual(response.json()['version'], fields['version'])
                publish.assert_called_once_with(Draft.parse(fields))
                self.assertTrue(RelayControl(control).enabled())
                restarted.post('/api/relay', json={'enabled': False}, headers=credentials)
                self.assertEqual(json.loads(control.read_text()), {'enabled': False})

    def test_version_grammar_and_unsigned_requirements(self):
        self.assertLess(version_key('0.3.0-beta.10'), version_key('0.3.0'))
        self.assertLess(version_key('0.3.0-beta.9'), version_key('0.3.0-beta.10'))
        with self.assertRaises(AdminError):
            version_key('0.3.0-beta.03')
        with self.assertRaises(AdminError):
            Draft.parse(dict(version='0.3.0', handoff=True, notes='formal', signed=False))


if __name__ == '__main__':
    unittest.main()
