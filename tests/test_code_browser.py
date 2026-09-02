import hashlib
import unittest
from unittest.mock import patch

from apuana.dashboard.server import code_browser


class CodeRevisionTests(unittest.TestCase):
    def test_content_revision_is_sha256(self):
        raw = b"print('apuana')\n"
        self.assertEqual(hashlib.sha256(raw).hexdigest(), code_browser._content_revision(raw))

    @patch.object(code_browser, "_safe_remote_path", return_value=("/home/CIN/user/image.png", ""))
    @patch.object(code_browser, "_run", return_value=(0, "42\t123", ""))
    def test_image_file_payload_returns_preview_metadata_without_reading_binary(self, _run, _safe):

        result = code_browser._code_file_payload("/home/CIN/user/image.png")

        self.assertTrue(result["ok"])
        self.assertEqual("image", result["kind"])
        self.assertEqual("image", result["language"])
        self.assertEqual(42, result["size"])

    @patch.object(code_browser, "_safe_remote_path", return_value=("/home/CIN/user/image.png", ""))
    def test_image_files_are_not_saved_as_text(self, _safe):
        result = code_browser._code_file_save_payload("/home/CIN/user/image.png", "not image bytes")

        self.assertFalse(result["ok"])
        self.assertIn("preview-only", result["error"])

    @patch.object(code_browser, "_safe_remote_path", return_value=("/home/CIN/user/main.py", ""))
    @patch.object(
        code_browser,
        "_run_with_stdin",
        return_value=(9, "", "APUANA_REVISION_CONFLICT:abc123\n"),
    )
    def test_save_reports_revision_conflict(self, _run, _safe):
        result = code_browser._code_file_save_payload(
            "/home/CIN/user/main.py",
            "new content",
            expected_revision="old",
        )

        self.assertFalse(result["ok"])
        self.assertEqual("revision_conflict", result["code"])
        self.assertEqual("abc123", result["current_revision"])

    @patch.object(code_browser, "_safe_remote_path", return_value=("/home/CIN/user/main.py", ""))
    @patch.object(code_browser, "_code_file_payload")
    @patch.object(code_browser, "_run_with_stdin", return_value=(0, "11", ""))
    def test_force_save_bypasses_revision_guard(self, run, file_payload, _safe):
        file_payload.return_value = {
            "ok": True,
            "path": "/home/CIN/user/main.py",
            "content": "new content",
            "revision": "new",
        }

        result = code_browser._code_file_save_payload(
            "/home/CIN/user/main.py",
            "new content",
            expected_revision="old",
            force=True,
        )

        self.assertTrue(result["ok"])
        script = run.call_args.args[0][2]
        self.assertIn("force=1", script)


if __name__ == "__main__":
    unittest.main()
