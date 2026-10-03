"""HTTP integration tests. OpenAI is mocked; no real keys or paid calls."""
import http.cookiejar
import json
import os
from pathlib import Path
import threading
import unittest
from urllib.request import Request, build_opener, HTTPCookieProcessor
from urllib.error import HTTPError

os.environ['GEO_DATA_DIR'] = str(Path(__file__).parent / 'test-data')
import server


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        server.initialize()
        cls.password = 'isolated-test-initial-password'
        salt = server.secrets.token_hex(16)
        server.set_setting('admin_salt', salt)
        server.set_setting('admin_hash', server.password_hash(cls.password, salt))
        server.set_setting('api_key', '')
        with server.db() as con:
            con.execute('DELETE FROM chats')
            con.execute('DELETE FROM messages')
            con.execute('DELETE FROM usage')
            con.execute('DELETE FROM sessions')
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.http.allowed_hosts = {'127.0.0.1'}
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port)
        cls.worker = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.worker.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()

    def client(self):
        return build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, client, path, data=None, origin=True):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = self.url
        req = Request(self.url + path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
        try:
            with client.open(req, timeout=10) as r:
                return r.status, json.load(r)
        except HTTPError as e:
            return e.code, json.load(e)

    def test_full_flow(self):
        a, b, admin = self.client(), self.client(), self.client()
        self.assertEqual(self.call(a, '/api/admin/settings')[0], 401)
        self.assertEqual(self.call(a, '/api/status')[0], 200)
        self.assertEqual(self.call(b, '/api/status')[0], 200)
        self.assertEqual(self.call(a, '/api/chat', {'question': '키 없는 질문'})[0], 503)
        self.assertEqual(self.call(a, '/api/admin/login', {'username': 'admin', 'password': 'wrong'}, origin=False)[0], 403)
        password = self.password
        self.assertEqual(self.call(admin, '/api/admin/login', {'username': 'admin', 'password': password})[0], 200)
        key = 'sk-test-only-not-a-real-key-1234567890'
        form = {'api_key': key, 'brand': 'CODEPLANT', 'website': 'https://codeplant.co.kr', 'model': 'gpt-4.1-mini', 'web_search': True, 'daily_limit': 100}
        self.assertEqual(self.call(admin, '/api/admin/settings', form)[0], 200)
        stored = server.setting('api_key')
        self.assertNotIn(key, stored)
        self.assertEqual(server.protect(stored, True), key)
        server.initialize()
        self.assertEqual(server.protect(server.setting('api_key'), True), key)
        config = self.call(admin, '/api/admin/settings')[1]
        self.assertNotIn(key, json.dumps(config))
        form['api_key'] = ''
        self.assertEqual(self.call(admin, '/api/admin/settings', form)[0], 200)
        self.assertEqual(server.setting('api_key'), stored)
        calls = []
        def fake(path, api_key, payload=None):
            self.assertEqual(api_key, key)
            if path == 'models':
                return {'data': [{'id': 'gpt-4.1-mini'}]}
            calls.append(payload)
            text = 'CODEPLANT 교육을 확인하세요. 공식 자료' if len(calls) % 2 else '관측: 브랜드가 언급되었습니다. 개선 제안: 교육 자료를 보완하세요.'
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': text, 'annotations': [{'type': 'url_citation', 'url': 'https://codeplant.co.kr/course', 'title': '공식 교육 자료', 'start_index': 21, 'end_index': 26}] if len(calls) % 2 else []}]}]}
        server.openai = fake
        self.assertEqual(self.call(admin, '/api/admin/test', {})[0], 200)
        code, result = self.call(a, '/api/chat', {'question': '교육 업체를 추천해줘'})
        self.assertEqual(code, 200)
        self.assertNotIn('CODEPLANT', json.dumps(calls[0], ensure_ascii=False))
        self.assertEqual(calls[0]['tool_choice'], 'required')
        self.assertFalse(calls[0]['store'])
        self.assertEqual(result['result']['mentions'], 1)
        self.assertEqual(result['result']['brand_citations'], 1)
        cid = result['chat_id']
        self.assertEqual(len(self.call(a, '/api/chats')[1]), 1)
        self.assertEqual(self.call(b, '/api/chats')[1], [])
        self.assertEqual(self.call(b, '/api/chats/' + cid)[0], 404)
        self.assertEqual(self.call(b, '/api/chats/delete', {'chat_id': cid})[0], 404)
        self.assertEqual(len(self.call(a, '/api/chats/' + cid)[1]['messages']), 2)
        server.initialize()
        self.assertEqual(len(self.call(a, '/api/chats/' + cid)[1]['messages']), 2)
        self.assertEqual(self.call(admin, '/api/admin/password', {'old_password': password, 'new_password': 'test-new-password-12345'})[0], 200)
        self.assertEqual(self.call(admin, '/api/admin/settings')[0], 401)
        self.assertEqual(self.call(admin, '/api/admin/login', {'username':'admin','password':'test-new-password-12345'})[0], 200)
        self.assertEqual(self.call(admin, '/api/admin/delete-key', {})[0], 200)
        self.assertFalse(server.setting('api_key'))
        self.assertEqual(self.call(a, '/api/chats/delete', {'chat_id': cid})[0], 200)
        self.assertEqual(self.call(a, '/api/chats')[1], [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
