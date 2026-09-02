import threading
import unittest
from unittest.mock import patch

from apuana.dashboard.server import terminal


class _FakeChannel:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.closed = False
        self.sent = []

    def recv_ready(self):
        return bool(self.chunks)

    def recv(self, _limit):
        return self.chunks.pop(0)

    def recv_stderr_ready(self):
        return False

    def sendall(self, data):
        self.sent.append(data)


class _FakeTerminalBackend:
    def __init__(self):
        self.closed = False
        self.sent = []
        self.resizes = []

    def is_alive(self):
        return not self.closed

    def read(self, _limit=terminal._MAX_READ_BYTES):
        return ""

    def send(self, data):
        self.sent.append(data)

    def resize(self, cols, rows):
        self.resizes.append((cols, rows))

    def close(self):
        self.closed = True


def _session_without_reader():
    session = terminal._TerminalSession.__new__(terminal._TerminalSession)
    session._condition = threading.Condition()
    session._chunks = []
    session._history_chars = 0
    session._seq = 0
    session._read_seq = 0
    session._closed = False
    session.updated_at = 0
    return session


class TerminalBufferTests(unittest.TestCase):
    def tearDown(self):
        terminal._terminal_close_active()

    def test_large_output_is_chunked_without_advancing_past_unread_data(self):
        session = _session_without_reader()
        payload = "x" * (terminal._MAX_READ_BYTES + terminal._OUTPUT_CHUNK_CHARS)

        session._append_output(payload)
        first_seq, first = session._collect_since_locked(0)
        final_seq, second = session._collect_since_locked(first_seq)

        self.assertLess(first_seq, session._seq)
        self.assertEqual(payload, first + second)
        self.assertEqual(session._seq, final_seq)

    def test_read_with_sequence_returns_cursor_matching_output(self):
        session = _session_without_reader()
        session._append_output("first")
        session._append_output("second")

        seq, output = session.read_with_sequence()

        self.assertEqual("firstsecond", output)
        self.assertEqual(session._seq, seq)
        self.assertEqual(seq, session._read_seq)

    def test_paramiko_decoder_preserves_split_utf8_character(self):
        encoded = "ação".encode("utf-8")
        channel = _FakeChannel([encoded[:2]])
        backend = terminal._ParamikoTerminal(channel)
        first = backend.read()
        channel.chunks.append(encoded[2:])
        second = backend.read()

        self.assertEqual("ação", first + second)

    def test_paramiko_send_uses_sendall(self):
        channel = _FakeChannel([])
        backend = terminal._ParamikoTerminal(channel)

        backend.send("echo ok\n")

        self.assertEqual(["echo ok\n"], channel.sent)

    def test_openssh_authenticated_session_selects_pty_backend(self):
        session = {
            "auth_mode": "openssh",
            "client": None,
            "ssh_target": "apuana-alias",
            "login": "user",
            "host": "cluster",
        }
        sentinel = object()
        with patch("apuana.dashboard.server.terminal._OpenSshPtyTerminal", return_value=sentinel) as factory:
            backend, name = terminal._open_terminal_backend(session, 120, 28)

        self.assertIs(backend, sentinel)
        self.assertEqual("openssh-pty", name)
        factory.assert_called_once_with("apuana-alias", 120, 28)

    def test_start_creates_independent_terminal_sessions(self):
        fake_session = {
            "token": "tok",
            "login": "user",
            "host": "cluster",
            "home": "/home/CIN/user",
            "client": object(),
        }
        backends = [_FakeTerminalBackend(), _FakeTerminalBackend()]
        with patch("apuana.dashboard.server.terminal._session_client", return_value=fake_session), \
             patch("apuana.dashboard.server.terminal._open_terminal_backend", side_effect=[(backends[0], "fake"), (backends[1], "fake")]):
            first = terminal._terminal_start_payload({"cols": 100, "rows": 24, "cwd": "/home/CIN/user"})
            second = terminal._terminal_start_payload({"cols": 120, "rows": 30, "cwd": "/home/CIN/user/project"})

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(2, len(terminal._terminals))
        self.assertEqual(["cd /home/CIN/user\n"], backends[0].sent)
        self.assertEqual(["cd /home/CIN/user/project\n"], backends[1].sent)


if __name__ == "__main__":
    unittest.main()
