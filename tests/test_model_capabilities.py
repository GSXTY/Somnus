import io
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError

from ai_assistant.models import ModelError, ModelStore
from ai_assistant.company_runtime import ProviderRosterLease, open_response
from ai_assistant.service import Config


class ModelCapabilitiesTests(unittest.TestCase):
    def row(self, store, **extra):
        value = dict(name='Synthetic', model='synthetic-model', base_url='https://synthetic.invalid/v1', api_key='synthetic-key')
        value.update(extra)
        return store.put(value)

    def test_capabilities_round_trip_and_legacy_defaults(self):
        with tempfile.TemporaryDirectory() as folder:
            store = ModelStore(folder)
            row = self.row(store, context_window=200000, max_output_tokens=32000,
                           supports_developer_role=True, supports_long_cache_retention=True, cache_retention='long')
            second = store.put(dict(group_id=row['group_id'], model='other', context_window=96000))
            self.assertEqual(second['group_id'], row['group_id'])
            self.assertIsNone(second['max_output_tokens'])
            saved = ModelStore(folder).configured_snapshot()[1][0]
            self.assertEqual(saved['context_window'], 200000)
            self.assertEqual(saved['max_output_tokens'], 32000)
            self.assertEqual(saved['cache_retention'], 'long')
            self.assertNotIn('synthetic-key', json.dumps(row))
            edited = store.put(dict(max_output_tokens=None), row['id'])
            self.assertEqual(edited['group_id'], row['group_id'])
            self.assertIsNone(edited['max_output_tokens'])

    def test_invalid_capabilities_never_replace_saved_settings(self):
        with tempfile.TemporaryDirectory() as folder:
            store = ModelStore(folder)
            row = self.row(store)
            before = store.path.read_bytes()
            for patch in (dict(context_window=True), dict(context_window=1023), dict(max_output_tokens=0),
                          dict(context_window=2048, max_output_tokens=2048), dict(context_window=4096, max_output_tokens=4095), dict(supports_developer_role='yes'),
                          dict(cache_retention='long'), dict(api='anthropic-messages', supports_developer_role=True),
                          dict(api='bedrock-converse-stream', supports_long_cache_retention=True)):
                with self.subTest(patch=patch), self.assertRaises(ModelError):
                    store.put(patch, row['id'])
                self.assertEqual(store.path.read_bytes(), before)

    def lease(self, api, **capabilities):
        row = dict(id='m_0123456789', model='upstream-model', name='Synthetic', base_url='https://synthetic.invalid/v1',
                   api_key='synthetic-secret', api=api, vision_enabled=False, reasoning_efforts=[], **capabilities)
        return ProviderRosterLease([row], lambda value: Config.from_provider(value, timeout=2), {'maxActiveSubagents': 1})

    def test_responses_relay_preserves_capabilities_and_upstream_failure(self):
        lease = self.lease('openai-responses', context_window=200000, max_output_tokens=32000,
                           supports_developer_role=True, supports_long_cache_retention=True, cache_retention='long')
        body = dict(model='m_0123456789', stream=True, input=[dict(role='developer', content='Synthetic instructions')],
                    max_output_tokens=40000, prompt_cache_key='synthetic-session', prompt_cache_retention='24h')
        config, request = lease.authorize(lease.token, body, True)
        self.assertEqual(request['max_output_tokens'], 32000)
        self.assertEqual(request['input'][0]['role'], 'developer')
        self.assertEqual(request['prompt_cache_retention'], '24h')
        self.assertEqual(request['model'], 'upstream-model')
        sent = []
        def upstream(req, **kwargs):
            sent.append(json.loads(req.data))
            raise HTTPError(req.full_url, 400, 'unsupported retention', {}, io.BytesIO(b'synthetic'))
        _, status = open_response(upstream, lease, request, True, configured=config)
        self.assertEqual(status, 400)
        self.assertEqual(sent[0]['prompt_cache_retention'], '24h')
        lease.release()
        body.pop('prompt_cache_retention')
        body['prompt_cache_options'] = {'ttl': '30m'}
        self.assertEqual(lease.authorize(lease.token, body, True)[1]['prompt_cache_options'], {'ttl': '30m'})
        lease.release()

    def test_other_models_do_not_inherit_compatibility_and_limits(self):
        lease = self.lease('openai-completions', context_window=4096, supports_developer_role=False)
        body = dict(model='m_0123456789', stream=True, messages=[dict(role='user', content='Synthetic')], max_tokens=50000)
        self.assertEqual(lease.authorize(lease.token, body)[1]['max_tokens'], 1024)
        lease.release()
        body['messages'][0]['role'] = 'developer'
        self.assertIsNone(lease.authorize(lease.token, body))
        body['messages'][0]['role'] = 'user'
        body['prompt_cache_retention'] = '24h'
        self.assertIsNone(lease.authorize(lease.token, body))
        body.pop('prompt_cache_retention')
        body['prompt_cache_key'] = 'bad\nkey'
        self.assertIsNone(lease.authorize(lease.token, body))

    def test_anthropic_cache_markers_follow_explicit_model_support(self):
        lease = self.lease('anthropic-messages', supports_long_cache_retention=True, cache_retention='long', max_output_tokens=24000)
        body = dict(model='m_0123456789', stream=True, messages=[dict(role='user', content='Synthetic')],
                    system=[dict(type='text', text='Synthetic', cache_control=dict(type='ephemeral', ttl='1h'))], max_tokens=30000)
        result = lease.authorize(lease.token, body, 'anthropic-messages')
        self.assertEqual(result[1]['max_tokens'], 24000)
        self.assertEqual(result[1]['system'][0]['cache_control']['ttl'], '1h')
        lease.release()
        unsupported = self.lease('anthropic-messages')
        self.assertIsNone(unsupported.authorize(unsupported.token, body, 'anthropic-messages'))


if __name__ == '__main__':
    unittest.main()
