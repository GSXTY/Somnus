import base64
import hashlib
import hmac
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from urllib.parse import parse_qs, urlsplit

import httpx

from dot_relay.app import create_app


class RelayTest(unittest.IsolatedAsyncioTestCase):
    async def test_pkce_pairing_isolation_delivery_pause_and_revocation(self):
        key = b'synthetic-relay-key-' * 2
        received = []

        def send(url, body, headers):
            signature = hmac.digest(key, b'.'.join([
                headers['webhook-id'].encode(), headers['webhook-timestamp'].encode(), body,
            ]), 'sha256')
            self.assertEqual(headers['webhook-signature'], 'v1,' + base64.b64encode(signature).decode())
            event = json.loads(body)
            received.append(event)
            if event.get('type') == 'verification':
                return 200, json.dumps({'challenge': event['challenge']}).encode()
            self.assertEqual(headers['webhook-id'], event['eventId'])
            return 204, b''

        with TemporaryDirectory() as directory:
            endpoint = 'http://127.0.0.1:8893'
            app = create_app(Path(directory) / 'relay.sqlite3', endpoint, local_dev=True, sender=send)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=endpoint) as client:
                unauthenticated = await client.post('/mcp', json={})
                self.assertEqual(unauthenticated.status_code, 401)
                self.assertIn('resource_metadata', unauthenticated.headers['WWW-Authenticate'])
                redirect = 'http://127.0.0.1:8199/redirect'
                registration = await client.post('/oauth/register', json={'redirect_uris': [redirect]})
                self.assertEqual(registration.status_code, 201)
                client_id = registration.json()['client_id']
                verifier = 'a' * 43
                challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')

                async def pair():
                    new_pair = (await client.post('/api/pairs', json={})).json()
                    desktop = {'Authorization': 'Bearer ' + new_pair['desktop_token']}
                    args = {
                        'response_type': 'code', 'client_id': client_id, 'redirect_uri': redirect,
                        'state': 'synthetic-state', 'code_challenge': challenge, 'code_challenge_method': 'S256',
                        'resource': endpoint + '/mcp',
                    }
                    form = await client.get('/oauth/authorize', params=args)
                    self.assertIn('pairing_code', form.text)
                    browser = await client.post('/oauth/authorize', data={
                        **args, 'pairing_code': new_pair['pairing_code'],
                    })
                    reply = parse_qs(urlsplit(browser.headers['location']).query)
                    self.assertEqual(reply['iss'], [endpoint])
                    self.assertEqual(reply['state'], [args['state']])
                    browser_repeat = await client.post('/oauth/authorize', data={
                        **args, 'pairing_code': new_pair['pairing_code'],
                    })
                    self.assertIn('access_denied', browser_repeat.headers['location'])
                    exchange = {
                        'grant_type': 'authorization_code', 'code': reply['code'][0],
                        'code_verifier': verifier, 'redirect_uri': redirect, 'client_id': client_id,
                    }
                    wrong = await client.post('/oauth/token', data={**exchange, 'code_verifier': 'b' * 43})
                    self.assertEqual(wrong.json()['error'], 'invalid_grant')
                    token = await client.post('/oauth/token', data=exchange)
                    self.assertEqual(token.status_code, 200)
                    repeated = await client.post('/oauth/token', data=exchange)
                    self.assertEqual(repeated.json()['error'], 'invalid_grant')
                    dot = {'Authorization': 'Bearer ' + token.json()['access_token']}
                    return desktop, dot, token.json()['refresh_token']

                async def mcp(auth, method, params):
                    response = await client.post('/mcp', headers=auth, json={
                        'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params,
                    })
                    return response.json()

                desktop, dot, refresh = await pair()
                other_desktop, other_dot, _ = await pair()
                self.assertEqual((await client.get('/api/status', headers=dot)).status_code, 401)
                self.assertIn('events', (await mcp(dot, 'initialize', {}))['result']['capabilities'])
                webhook = {'name': 'task.created', 'arguments': {}, 'delivery': {
                    'mode': 'webhook', 'url': 'https://mock.example.test/events',
                    'secret': 'whsec_' + base64.b64encode(key).decode(),
                }}
                self.assertIn('id', (await mcp(dot, 'events/subscribe', webhook))['result'])
                self.assertIn('id', (await mcp(other_dot, 'events/subscribe', webhook))['result'])
                self.assertTrue((await client.get('/api/status', headers=desktop)).json()['ready'])
                task = (await client.post('/api/tasks', headers=desktop,
                                          json={'prompt': 'Summarize three test widgets.'})).json()['task']
                self.assertEqual(task['status'], 'pending')
                self.assertNotIn('widgets', json.dumps(received))
                self.assertEqual((await client.get('/api/tasks/' + task['id'],
                                                    headers=other_desktop)).status_code, 404)
                read = {'name': 'read_task', 'arguments': {'task_id': task['id']}}
                self.assertIn('error', await mcp(other_dot, 'tools/call', read))
                self.assertEqual((await mcp(dot, 'tools/call', read))['result']['structuredContent']['text'],
                                 task['prompt'])
                paused = await client.post('/api/enabled', headers=desktop, json={'enabled': False})
                self.assertFalse(paused.json()['ready'])
                self.assertEqual((await client.post('/api/tasks', headers=desktop,
                                                    json={'prompt': 'blocked'})).status_code, 409)
                submit = {'name': 'submit_result', 'arguments': {'task_id': task['id'], 'result': 'Ready.'}}
                self.assertIn('result', await mcp(dot, 'tools/call', submit))
                self.assertIn('result', await mcp(dot, 'tools/call', submit))
                saved = (await client.get('/api/tasks/' + task['id'], headers=desktop)).json()['task']
                self.assertEqual(saved['result'], 'Ready.')
                self.assertIsNone(saved['prompt'])
                refresh_params = {'grant_type': 'refresh_token', 'client_id': client_id, 'refresh_token': refresh}
                refreshed = await client.post('/oauth/token', data=refresh_params)
                self.assertEqual(refreshed.status_code, 200)
                fresh_dot = {'Authorization': 'Bearer ' + refreshed.json()['access_token']}
                self.assertEqual((await client.post('/mcp', headers=dot, json={})).status_code, 401)
                self.assertEqual((await client.post('/oauth/token', data=refresh_params)).status_code, 400)
                self.assertEqual((await client.delete('/api/pairs/current', headers=desktop)).status_code, 200)
                self.assertEqual((await client.post('/mcp', headers=fresh_dot, json={})).status_code, 401)
                self.assertTrue((await client.get('/api/status', headers=other_desktop)).json()['ready'])
