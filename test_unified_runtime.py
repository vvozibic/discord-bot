import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

import start


class UnifiedRuntimeTests(unittest.TestCase):
    def test_public_and_private_ports_are_independent(self):
        env = start.runtime_environment({"PORT": "8080", "DISCORD_TOKEN": "fixture-only"})
        self.assertEqual(env["PORT"], "8080")
        self.assertEqual(env["GAME_INTERNAL_PORT"], "5179")
        self.assertEqual(env["DISCORD_TOKEN"], "fixture-only")
        self.assertEqual(start.runtime_environment({"PORT": "5179"})["GAME_INTERNAL_PORT"], "5180")
        for values in ({"PORT": "0"}, {"PORT": "bad"}, {"GAME_INTERNAL_PORT": "65536"},
                       {"PORT": "8080", "GAME_INTERNAL_PORT": "8080"}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                start.runtime_environment(values)

    def test_default_runs_game_web_and_gateway_in_separate_processes(self):
        with patch("start.shutil.which", return_value="node"):
            commands = start.child_commands()
            self.assertEqual(len(commands), 3)
            self.assertEqual(Path(commands[0][1]).name, "combined.js")
            self.assertIn("--worker", commands[1])
            self.assertIn("--bot-only", commands[2])
            self.assertEqual(len(start.child_commands(web_only=True)), 2)
        with patch("start.shutil.which", return_value=None), self.assertRaisesRegex(RuntimeError, "Node.js 24"):
            start.child_commands()

    def test_child_failure_stops_all_other_children_and_reports_failure(self):
        created = []
        spawn = subprocess.Popen

        def capture(*args, **kwargs):
            child = spawn(*args, **kwargs)
            created.append(child)
            return child

        commands = [[sys.executable, "-c", "raise SystemExit(7)"],
                    [sys.executable, "-c", "import time; time.sleep(60)"]]
        with patch("start.subprocess.Popen", side_effect=capture):
            self.assertEqual(start.supervise(commands, os.environ.copy()), 7)
        self.assertEqual(len(created), 2)
        self.assertTrue(all(child.poll() is not None for child in created))

    def test_spawn_error_cleans_up_the_child_that_already_started(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                                 start_new_session=os.name == "posix")
        with patch("start.subprocess.Popen", side_effect=[child, FileNotFoundError("test executable")]):
            with self.assertRaises(FileNotFoundError):
                start.supervise([["one"], ["two"]], os.environ.copy())
        self.assertIsNotNone(child.poll())

    def test_combined_image_keeps_the_existing_entrypoint(self):
        root = Path(__file__).resolve().parent
        self.assertIn("python start.py", (root / "Procfile").read_text())
        dockerfile = (root / "Dockerfile").read_text()
        self.assertIn('CMD ["python", "start.py"]', dockerfile)
        self.assertIn("node:24-bookworm-slim", dockerfile)

    def test_container_probe_waits_through_connection_reset_and_startup_responses(self):
        from scripts.check_combined_container import wait_for
        with patch("scripts.check_combined_container.request", side_effect=[
            ConnectionResetError("container port is not ready"),
            (503, b'{}'), (200, b'not-json'), (200, b'{"status":"ok"}'),
        ]) as request, patch("scripts.check_combined_container.time.sleep"):
            self.assertEqual(wait_for("http://127.0.0.1:1", "/readyz"), {"status": "ok"})
        self.assertEqual(request.call_count, 4)


if __name__ == "__main__":
    unittest.main()
