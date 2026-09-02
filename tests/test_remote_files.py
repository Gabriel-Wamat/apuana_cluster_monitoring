import unittest
from unittest.mock import patch

from apuana.dashboard.server import remote_files


class RemoteMoveTests(unittest.TestCase):
    def session(self):
        return {
            "token": "tok",
            "login": "gwam",
            "home": "/home/CIN/gwam",
        }

    @patch.object(remote_files, "_session_public")
    def test_refuses_to_move_home_directory(self, session_public):
        session_public.return_value = self.session()

        result = remote_files._move_remote_path("/home/CIN/gwam", "/home/CIN/gwam/research")

        self.assertFalse(result["ok"])
        self.assertIn("home directory", result["error"])

    @patch.object(remote_files, "_session_public")
    def test_refuses_destination_outside_home(self, session_public):
        session_public.return_value = self.session()

        result = remote_files._move_remote_path("/home/CIN/gwam/file.txt", "/tmp")

        self.assertFalse(result["ok"])
        self.assertIn("Access denied", result["error"])

    @patch.object(remote_files, "_session_public")
    def test_refuses_to_move_folder_inside_itself_before_remote_call(self, session_public):
        session_public.return_value = self.session()

        result = remote_files._move_remote_path("/home/CIN/gwam/project", "/home/CIN/gwam/project/nested")

        self.assertFalse(result["ok"])
        self.assertEqual("Cannot move a folder inside itself.", result["error"])

    @patch.object(remote_files, "_session_public")
    @patch.object(remote_files, "_run")
    def test_moves_file_into_destination_folder_without_overwrite(self, run, session_public):
        session_public.return_value = self.session()
        run.return_value = (0, "file\n", "")

        result = remote_files._move_remote_path("/home/CIN/gwam/file.txt", "/home/CIN/gwam/research")

        self.assertTrue(result["ok"])
        self.assertFalse(result["noop"])
        self.assertEqual("/home/CIN/gwam/research/file.txt", result["target"])
        script = run.call_args.args[0][-1]
        self.assertIn('if [ -e "$target_path" ] || [ -L "$target_path" ]; then', script)
        self.assertIn('mv -- "$source_path" "$destination_dir/"', script)

    @patch.object(remote_files, "_session_public")
    @patch.object(remote_files, "_run")
    def test_noops_when_item_is_already_in_destination_folder(self, run, session_public):
        session_public.return_value = self.session()
        run.return_value = (0, "file\nnoop\n", "")

        result = remote_files._move_remote_path("/home/CIN/gwam/research/file.txt", "/home/CIN/gwam/research")

        self.assertTrue(result["ok"])
        self.assertTrue(result["noop"])
        self.assertEqual("/home/CIN/gwam/research/file.txt", result["target"])
        run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
