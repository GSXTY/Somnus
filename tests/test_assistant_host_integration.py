"""Same-origin host integration with isolated assistant storage and fake transport."""
import http.client
import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from ai_assistant.service import AssistantService, Config
from event_detection import viewer


class AssistantHostTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.previous=viewer.recording,viewer.event_store,viewer.assistant_service
        self.store=Mock()
        viewer.recording=None
        viewer.event_store=self.store
        viewer.assistant_service=AssistantService(Path(self.temp.name)/'assistant.sqlite3',
                                                Config(base_url='',model='',api_key=''))
        self.server=viewer.ThreadingHTTPServer(('127.0.0.1',0),viewer.Handler)
        self.worker=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.worker.start()
        self.base=f'http://127.0.0.1:{self.server.server_port}'
        self.client=build_opener(ProxyHandler({}))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(3)
        viewer.recording,viewer.event_store,viewer.assistant_service=self.previous
        self.temp.cleanup()

    def call(self,path,body=None,headers=None):
        request=Request(self.base+path,data=None if body is None else json.dumps(body).encode(),
                        headers={'Content-Type':'application/json',**(headers or {})})
        with self.client.open(request,timeout=5) as response:
            return response.status,json.load(response)

    def test_status_conversations_and_unconfigured_send_do_not_require_csv(self):
        # Assistant dispatch must precede the detection "open CSV" guard and
        # must not acquire its waveform lock, including during network work.
        viewer.recording_lock.acquire()
        try:
            status,packet=self.call('/api/assistant/status')
        finally:
            viewer.recording_lock.release()
        self.assertEqual(status,200)
        self.assertFalse(packet['configured'])
        self.assertEqual(packet['connection_status'],'not_configured')
        self.assertFalse(packet['database_connected'])
        status,created=self.call('/api/assistant/conversations',{'title':'local test'})
        self.assertEqual(status,201)
        cid=created['conversation']['id']
        self.call(f'/api/assistant/conversations/{cid}/rename',{'title':'renamed'})
        self.assertEqual(self.call('/api/assistant/conversations')[1]['conversations'][0]['title'],'renamed')
        with self.assertRaises(HTTPError) as error:
            self.call(f'/api/assistant/conversations/{cid}/messages',{'content':'test'})
        self.assertEqual(error.exception.code,503)
        self.assertEqual(json.load(error.exception)['error']['code'],'not_configured')
        self.assertEqual(self.call(f'/api/assistant/conversations/{cid}')[1]['messages'],[])
        self.assertEqual(self.store.mock_calls,[])
        health=self.call('/api/health')[1]
        self.assertEqual(health['entrypoints']['events'],'/events')
        with self.client.open(self.base+'/events',timeout=5) as response:
            self.assertIn('value="dynamic_baseline_v3" selected',response.read().decode())

    def test_origin_guard_precedes_assistant_writes_and_unavailable_is_explicit(self):
        with self.assertRaises(HTTPError) as error:
            self.call('/api/assistant/conversations',{'title':'must not save'},
                      headers={'Origin':'https://unrelated.invalid'})
        self.assertEqual(error.exception.code,403)
        self.assertEqual(self.call('/api/assistant/conversations')[1]['conversations'],[])
        viewer.assistant_service=None
        with self.assertRaises(HTTPError) as error:
            self.call('/api/assistant/status')
        self.assertEqual(error.exception.code,503)
        self.assertEqual(json.load(error.exception)['error']['code'],'service_unavailable')
        self.assertEqual(self.call('/api/health')[0],200)
        self.assertEqual(self.store.mock_calls,[])

    def test_streaming_does_not_hold_detection_lock_and_disconnect_releases_turn(self):
        service=AssistantService(Path(self.temp.name)/'streaming.sqlite3',
                                 Config(base_url='http://127.0.0.1:1/v1',model='synthetic-test',api_key='test-only'))
        viewer.assistant_service=service
        cid=service.create('fake stream')['id']
        started=threading.Event()
        allow_write=threading.Event()
        closed=threading.Event()

        def fake_stream(conversation_id,user,assistant,cancel):
            try:
                started.set()
                yield 'start',{'conversation_id':conversation_id}
                allow_write.wait(3)
                # A disconnected client fails on one of these flushed writes.
                for _ in range(20):
                    yield 'delta',{'text':'x'*32768}
            finally:
                closed.set()

        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=5)
        with patch.object(service,'stream',side_effect=fake_stream):
            try:
                connection.request('POST',f'/api/assistant/conversations/{cid}/messages',
                                   body=json.dumps({'content':'test stream'}),
                                   headers={'Content-Type':'application/json'})
                response=connection.getresponse()
                self.assertEqual(response.getheader('Content-Type'),'text/event-stream; charset=utf-8')
                self.assertTrue(started.wait(2))
                self.assertEqual(self.call('/api/health')[0],200)
                self.assertTrue(viewer.recording_lock.acquire(blocking=False))
                viewer.recording_lock.release()
                # Closing a non-fully-read SSE body emulates AbortController.
                sock=response.fp.raw._sock
                sock.shutdown(socket.SHUT_RDWR)
                response.close()
                connection.close()
                allow_write.set()
                self.assertTrue(closed.wait(3),'stream iterator must be closed on disconnect')
            finally:
                allow_write.set()
                connection.close()
        # The server marks an unfinished local reply cancelled and releases busy.
        deadline=threading.Event()
        for _ in range(100):
            if cid not in service.active:
                break
            deadline.wait(.01)
        self.assertNotIn(cid,service.active)
        self.assertEqual(service.get(cid)['messages'][-1]['status'],'cancelled')
        self.assertEqual(self.store.mock_calls,[])


if __name__=='__main__':
    unittest.main()
