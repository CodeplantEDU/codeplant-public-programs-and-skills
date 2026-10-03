"""HTTP integration tests. OpenAI is mocked; no real keys or paid calls."""
import http.cookiejar
import json
import os
from pathlib import Path
import threading
import shutil
import unittest
from unittest import mock
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, build_opener, HTTPCookieProcessor, ProxyHandler
from urllib.error import HTTPError

import server


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test_root = Path(__file__).resolve().parent / 'test-data'
        test_root.mkdir(exist_ok=True)
        # mkdir's default ACL works for both Windows users and sandbox identities;
        # TemporaryDirectory's owner-only ACL cannot be reopened in some sandboxes.
        cls.test_data = test_root / ('run-' + server.secrets.token_hex(12))
        cls.test_data.mkdir()
        cls.addClassCleanup(shutil.rmtree, cls.test_data)
        cls.data_patch = mock.patch.object(server, 'DATA', cls.test_data)
        cls.db_patch = mock.patch.object(server, 'DB', cls.test_data / 'geo.sqlite3')
        cls.data_patch.start()
        cls.db_patch.start()
        cls.addClassCleanup(cls.data_patch.stop)
        cls.addClassCleanup(cls.db_patch.stop)
        server.initialize()
        cls.password = 'isolated-test-initial-password'
        salt = server.secrets.token_hex(16)
        cls.salt, cls.pwhash = salt, server.password_hash(cls.password, salt)
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        cls.http.allowed_hosts = {'127.0.0.1'}
        cls.url = 'http://127.0.0.1:' + str(cls.http.server_port)
        cls.worker = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.worker.start()

    def setUp(self):
        server.set_setting('admin_salt', self.salt)
        server.set_setting('admin_hash', self.pwhash)
        for name, value in server.DEFAULTS.items():
            server.set_setting(name, value)
        server.set_setting('api_key', '')
        server.set_setting('key_tested', False)
        server.RATE.clear()
        with server.db() as con:
            con.execute('DELETE FROM chats')
            con.execute('DELETE FROM messages')
            con.execute('DELETE FROM usage')
            con.execute('DELETE FROM sessions')
        self.openai_patch = mock.patch.object(server, 'openai')
        self.api_mock = self.openai_patch.start()
        self.addCleanup(self.openai_patch.stop)

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.worker.join(timeout=5)

    def client(self):
        return build_opener(ProxyHandler({}), HTTPCookieProcessor(http.cookiejar.CookieJar()))

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

    def configured(self):
        admin, visitor = self.client(), self.client()
        self.assertEqual(self.call(admin, '/api/admin/login', {'username': 'admin', 'password': self.password})[0], 200)
        self.assertEqual(self.call(visitor, '/api/status')[0], 200)
        form = {'api_key': 'sk-test-only-not-a-real-key-1234567890', 'brand': 'CODEPLANT', 'website': 'https://codeplant.co.kr', 'model': 'gpt-4.1-mini', 'web_search': True, 'daily_limit': 100}
        self.assertEqual(self.call(admin, '/api/admin/settings', form)[0], 200)
        return admin, visitor, form

    def test_model_change_requires_retest(self):
        admin, _, form = self.configured()
        self.api_mock.return_value = {'data': [{'id': form['model']}]}
        self.assertEqual(self.call(admin, '/api/admin/test', {})[0], 200)
        self.assertTrue(server.setting('key_tested'))
        encrypted = server.setting('api_key')
        form.update(api_key='', model='another-model')
        self.assertEqual(self.call(admin, '/api/admin/settings', form)[0], 200)
        self.assertFalse(self.call(admin, '/api/admin/settings')[1]['key_tested'])
        self.assertEqual(server.setting('api_key'), encrypted)

    def test_settings_changed_during_key_test(self):
        admin, _, form = self.configured()
        def changed(path, key, payload=None):
            server.set_setting('model', 'another-model')
            return {'data': [{'id': form['model']}]}
        self.api_mock.side_effect = changed
        self.assertEqual(self.call(admin, '/api/admin/test', {})[0], 409)
        self.assertFalse(server.setting('key_tested'))

    def test_validation_does_not_change_saved_settings(self):
        admin, _, form = self.configured()
        previous = server.settings_snapshot()
        for changes in ({'daily_limit': 1.5}, {'daily_limit': True}, {'daily_limit': '1.5'}, {'brand': None}, {'api_key': 123}, {'website': 'https://user:password@example.com'}, {'website': 'https://example.com/a b'}):
            with self.subTest(changes=changes):
                self.assertEqual(self.call(admin, '/api/admin/settings', {**form, **changes})[0], 400)
                self.assertEqual(server.settings_snapshot(), previous)

    def test_host_origin_and_body_validation(self):
        client = self.client()
        for headers, payload, expected in (
            ({'Host': 'untrusted.example'}, None, 403),
            ({'Content-Type': 'application/json', 'Origin': 'https://untrusted.example'}, b'{}', 403),
            ({'Content-Type': 'text/plain', 'Origin': self.url}, b'{}', 415),
            ({'Content-Type': 'application/json', 'Origin': self.url}, b'{"broken":', 400),
            ({'Content-Type': 'application/json', 'Origin': self.url}, b'[]', 400),
        ):
            with self.subTest(headers=headers):
                req = Request(self.url + '/api/status' if payload is None else self.url + '/api/admin/login', data=payload, headers=headers)
                with self.assertRaises(HTTPError) as raised:
                    client.open(req, timeout=5)
                self.assertEqual(raised.exception.code, expected)

    def test_busy_chat_cannot_be_reordered_or_deleted(self):
        _, visitor, _ = self.configured()
        with mock.patch.object(server, 'evaluate', return_value={'text': 'first answer'}):
            code, first = self.call(visitor, '/api/chat', {'question': 'first'})
        self.assertEqual(code, 200)
        cid = first['chat_id']
        entered, release = threading.Event(), threading.Event()
        def delayed(question, history, key, config=None):
            self.assertEqual([m['content'] for m in history], ['first', 'first answer'])
            entered.set()
            self.assertTrue(release.wait(5))
            return {'text': 'second answer'}
        with mock.patch.object(server, 'evaluate', side_effect=delayed), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.call, visitor, '/api/chat', {'question': 'second', 'chat_id': cid})
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.call(visitor, '/api/chat', {'question': 'overlap', 'chat_id': cid})[0], 429)
                self.assertEqual(self.call(visitor, '/api/chats/delete', {'chat_id': cid})[0], 429)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=5)[0], 200)
        messages = self.call(visitor, '/api/chats/' + cid)[1]['messages']
        self.assertEqual([m['data']['text'] for m in messages], ['first', 'first answer', 'second', 'second answer'])
        self.assertEqual(self.call(visitor, '/api/chats/delete', {'chat_id': cid})[0], 200)
        self.assertEqual(self.call(visitor, '/api/chats/' + cid)[0], 404)

    def test_daily_limit_is_atomic_and_busy_state_released(self):
        _, visitor, _ = self.configured()
        server.set_setting('daily_limit', 1)
        other = self.client()
        self.call(other, '/api/status')
        entered, release = threading.Event(), threading.Event()
        def delayed(*args):
            entered.set()
            self.assertTrue(release.wait(5))
            raise ValueError('synthetic upstream failure')
        with mock.patch.object(server, 'evaluate', side_effect=delayed), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.call, visitor, '/api/chat', {'question': 'first'})
            try:
                self.assertTrue(entered.wait(5))
                self.assertEqual(self.call(other, '/api/chat', {'question': 'over limit'})[0], 429)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=5)[0], 400)
        server.set_setting('daily_limit', 2)
        with mock.patch.object(server, 'evaluate', return_value={'text': 'recovered'}):
            self.assertEqual(self.call(visitor, '/api/chat', {'question': 'retry'})[0], 200)
        self.assertFalse(server.ACTIVE_CHATS)

    def test_partial_analysis_failure_keeps_answer(self):
        self.configured()
        answer = {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': 'CODEPLANT answer'}]}]}
        self.api_mock.side_effect = [answer, ValueError('synthetic analysis failure')]
        result = server.evaluate('question', [], 'dummy-key')
        self.assertEqual(result['text'], 'CODEPLANT answer')
        self.assertEqual(result['evaluation_error'], 'synthetic analysis failure')

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
        self.api_mock.side_effect = fake
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


class UpstreamFailureTest(unittest.TestCase):
    def test_citation_offsets_preserve_leading_whitespace_and_parts(self):
        parts = [
            {'type': 'output_text', 'text': '  hello source', 'annotations': [{'type': 'url_citation', 'url': 'https://example.com/one', 'start_index': 8, 'end_index': 14}]},
            {'type': 'output_text', 'text': 'More source', 'annotations': [{'type': 'url_citation', 'url': 'https://example.com/two', 'start_index': 5, 'end_index': 11}]},
        ]
        result = server.unpack({'status': 'completed', 'output': [{'type': 'message', 'content': parts}]})
        self.assertTrue(result['text'].startswith('  '))
        for annotation in result['annotations']:
            self.assertEqual(result['text'][annotation['start']:annotation['end']], 'source')

    def test_transport_and_bad_json_are_user_errors(self):
        for failure in (ConnectionResetError('reset'), server.HTTPException('truncated'), json.JSONDecodeError('invalid', '', 0)):
            with self.subTest(failure=type(failure).__name__), mock.patch.object(server, 'urlopen', side_effect=failure):
                with self.assertRaises(ValueError) as raised:
                    server.openai('responses', 'dummy-key', {})
                self.assertNotIn('dummy-key', str(raised.exception))


if __name__ == '__main__':
    unittest.main(verbosity=2)
