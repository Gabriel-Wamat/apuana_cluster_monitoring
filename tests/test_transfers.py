import io
import unittest
from unittest.mock import patch

from apuana.dashboard.server import transfers


class TransferAuthTests(unittest.TestCase):
    def test_passwordless_openssh_session_uses_configured_target_for_rsync(self):
        session = {"auth_mode": "openssh", "ssh_target": "apuana", "password": ""}

        spec = transfers._remote_spec_for_session(session, "gwam", "slurm-client2.cin.ufpe.br", "/home/CIN/gwam/")

        self.assertEqual("apuana:/home/CIN/gwam/", spec)

    def test_passwordless_paramiko_agent_session_uses_external_ssh_path(self):
        session = {
            "token": "tok",
            "auth_mode": "paramiko-agent",
            "ssh_target": "apuana",
            "password": "",
            "client": object(),
        }

        self.assertTrue(transfers._uses_external_ssh_session(session))

    @patch.object(transfers, "_execute_rsync_upload")
    @patch.object(transfers, "_session_client")
    def test_selected_upload_falls_back_to_rsync_for_openssh_only_session(self, session_client, rsync_upload):
        session_client.return_value = {
            "token": "tok",
            "login": "gwam",
            "host": "slurm-client2.cin.ufpe.br",
            "home": "/home/CIN/gwam",
            "password": "",
            "client": None,
            "auth_mode": "openssh",
            "ssh_target": "apuana",
        }
        rsync_upload.return_value = {
            "ok": True,
            "stdout": "rsync ok",
            "stderr": "",
            "error": "",
        }

        result = transfers._upload_streams([("nested/example.txt", io.BytesIO(b"hello"))], "/home/CIN/gwam/uploads/")

        self.assertTrue(result["ok"])
        self.assertEqual(1, result["files"])
        self.assertEqual(5, result["bytes"])
        local_path, remote_path = rsync_upload.call_args.args[:2]
        self.assertTrue(local_path.endswith("/"))
        self.assertEqual("/home/CIN/gwam/uploads/", remote_path)


if __name__ == "__main__":
    unittest.main()
