import threading
import unittest
from urllib.request import urlopen

from apuana.dashboard.server.http import Handler, _Server


class DashboardSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = _Server(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def fetch(self, path):
        with urlopen(f"{self.base_url}{path}", timeout=3) as response:
            return response.status, response.headers, response.read()

    def test_dashboard_serves_local_editor_and_terminal_assets(self):
        status, _, html = self.fetch("/")
        page = html.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertIn("/static/vendor/generated/monaco.js", page)
        self.assertIn("/static/vendor/generated/terminal.js", page)
        self.assertIn("/static/scripts/features/code-workspace-core.js", page)
        self.assertNotIn("cdnjs.cloudflare.com", page)

        for path in (
            "/static/vendor/generated/monaco.js",
            "/static/vendor/generated/monaco-worker.js",
            "/static/vendor/generated/terminal.js",
        ):
            asset_status, headers, body = self.fetch(path)
            self.assertEqual(asset_status, 200)
            self.assertIn("javascript", headers.get_content_type())
            self.assertGreater(len(body), 1000)

    def test_code_workspace_markup_contains_editor_terminal_and_conflict_flow(self):
        _, _, html = self.fetch("/")
        page = html.decode("utf-8")
        self.assertIn('id="code-editor"', page)
        self.assertIn('id="code-terminal-screen"', page)
        self.assertIn('id="code-sidebar-collapse"', page)
        self.assertIn('id="code-conflict-modal"', page)
        self.assertLess(page.index('id="code-terminal-panel"'), page.index('id="code-create-modal"'))


if __name__ == "__main__":
    unittest.main()
