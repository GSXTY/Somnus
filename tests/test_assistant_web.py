import unittest

from ai_assistant import web


class WebFetchGuardTest(unittest.TestCase):
    def test_rejects_non_http_schemes(self):
        for url in ('file:///C:/Windows/win.ini', 'ftp://example.com/a', 'javascript:alert(1)'):
            with self.assertRaises(web.FetchError):
                web.fetch(url)

    def test_rejects_private_and_loopback_hosts(self):
        for url in ('http://127.0.0.1:8765/api/health', 'http://localhost/', 'http://192.168.1.68/', 'http://10.0.0.5/'):
            with self.assertRaises(web.FetchError):
                web.fetch(url)

    def test_rejects_empty_url(self):
        with self.assertRaises(web.FetchError):
            web.fetch('')
        with self.assertRaises(web.FetchError):
            web.fetch('https://' + 'a' * 3000)

    def test_html_to_text_strips_markup_and_scripts(self):
        title, body = web.to_text(
            '<html><head><title>标题 &amp; 说明</title>'
            '<script>var x = 1;</script><style>.a{}</style></head>'
            '<body><h1>你好</h1><p>正文  内容</p></body></html>')
        self.assertEqual(title, '标题 & 说明')
        self.assertIn('你好', body)
        self.assertIn('正文', body)
        self.assertNotIn('var x', body)
        self.assertNotIn('<', body)


if __name__ == '__main__':
    unittest.main()
