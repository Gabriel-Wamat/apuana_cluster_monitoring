import unittest
from unittest.mock import patch

from apuana.dashboard.server import runtime


class RuntimeOpenSshFallbackTests(unittest.TestCase):
    def _agent_session(self) -> dict:
        return {
            "token": "tok",
            "login": "gwam",
            "host": "slurm-client2.cin.ufpe.br",
            "home": "/home/CIN/gwam",
            "password": "",
            "client": None,
            "auth_mode": "paramiko-agent",
            "ssh_target": "apuana",
        }

    @patch.object(runtime, "_run_openssh", return_value=(0, "ok", ""))
    @patch.object(runtime, "_connect_ssh", side_effect=RuntimeError("No authentication methods available"))
    @patch.object(runtime, "_session_client")
    def test_run_falls_back_to_openssh_when_agent_reconnect_fails(self, session_client, connect, run_openssh):
        session_client.return_value = self._agent_session()

        result = runtime._run(["bash", "-lc", "echo ok"])

        self.assertEqual((0, "ok", ""), result)
        connect.assert_called_once()
        run_openssh.assert_called_once_with("apuana", ["bash", "-lc", "echo ok"], 8)

    @patch.object(runtime, "_run_openssh_bytes", return_value=(0, b"raw", b""))
    @patch.object(runtime, "_connect_ssh", side_effect=RuntimeError("No authentication methods available"))
    @patch.object(runtime, "_session_client")
    def test_run_bytes_falls_back_to_openssh_when_agent_reconnect_fails(self, session_client, connect, run_openssh):
        session_client.return_value = self._agent_session()

        result = runtime._run_bytes(["bash", "-lc", "cat image.jpg"], timeout=45)

        self.assertEqual((0, b"raw", b""), result)
        connect.assert_called_once()
        run_openssh.assert_called_once_with("apuana", ["bash", "-lc", "cat image.jpg"], data=b"", timeout=45)

    @patch.object(runtime, "_run_openssh_bytes", return_value=(0, b"saved", b""))
    @patch.object(runtime, "_connect_ssh", side_effect=RuntimeError("No authentication methods available"))
    @patch.object(runtime, "_session_client")
    def test_run_with_stdin_falls_back_to_openssh_when_agent_reconnect_fails(
        self,
        session_client,
        connect,
        run_openssh,
    ):
        session_client.return_value = self._agent_session()

        result = runtime._run_with_stdin(["bash", "-lc", "cat > file.txt"], b"payload", timeout=15)

        self.assertEqual((0, "saved", ""), result)
        connect.assert_called_once()
        run_openssh.assert_called_once_with("apuana", ["bash", "-lc", "cat > file.txt"], data=b"payload", timeout=15)

    def test_password_session_does_not_use_openssh_fallback(self):
        session = self._agent_session()
        session["password"] = "secret"
        self.assertFalse(runtime._can_run_via_openssh(session))


if __name__ == "__main__":
    unittest.main()
