import json
from contextlib import closing
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

from fastapi import FastAPI
from fastapi.testclient import TestClient

from game_gateway import install_game_routes


ROOT = Path(__file__).resolve().parent
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "Node.js 24 is required")
class CombinedServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="forest-combined-")
        self.mount = Path(self.directory.name)
        self.database = self.mount / "forest-trail.sqlite"
        self.process = None
        self.context = None
        self.log = open(self.mount / "service.log", "wb")
        self.addCleanup(self.directory.cleanup)
        self.addCleanup(self.log.close)
        self.addCleanup(self.stop_game)
        self.start_game()

    def start_game(self, *, storage=True):
        with socket.socket() as lease:
            lease.bind(("127.0.0.1", 0))
            port = lease.getsockname()[1]
        env = {**os.environ, "DISCORD_CLIENT_ID": "1466831420575186985",
               "DISCORD_CLIENT_SECRET": "fixture-only-never-exposed", "RAILWAY_ENVIRONMENT_ID": "test",
               "GAME_INTERNAL_PORT": str(port), "GAME_ADMIN_ROLE_IDS": "",
               "GAME_ALLOWED_GUILD_ID": "1400787114333044887", "GAME_BETA_ROLE_ID": "1564276225520963726"}
        for name in ("GAME_DATABASE_PATH", "RAILWAY_VOLUME_MOUNT_PATH", "GAME_BOT_API_KEY", "DATABASE_URL", "GAME_DATABASE_URL"):
            env.pop(name, None)
        if storage:
            env["RAILWAY_VOLUME_MOUNT_PATH"] = str(self.mount)
        self.process = subprocess.Popen([NODE, "game/server/combined.js"], cwd=ROOT, env=env,
                                        stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                self.fail("Private game process exited; inspect the test fixture log")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=0.5):
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.05)
        else:
            self.fail("Private game process did not become reachable")
        app = FastAPI()

        @app.get("/api/x/linked")
        async def legacy_linked():
            return {"legacy": True}

        install_game_routes(app, port=port)
        self.context = TestClient(app)
        self.client = self.context.__enter__()

    def stop_game(self):
        if self.context:
            self.context.__exit__(None, None, None)
            self.context = None
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process = None

    def test_same_public_app_serves_built_game_config_and_existing_api(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        self.assertIn("Forest Trail", page.text)
        config = self.client.get("/api/config").json()
        self.assertTrue(config["configured"])
        self.assertEqual(config["clientId"], "1466831420575186985")
        self.assertEqual(self.client.get("/api/x/linked").json(), {"legacy": True})
        self.assertEqual(self.client.get("/readyz").status_code, 200)
        self.assertEqual(self.client.get("/api/leaderboard").status_code, 401)
        for path in ("/.env", "/start.py", "/game/server/combined.js", "/server/api.js"):
            self.assertEqual(self.client.get(path).status_code, 404, path)
        self.assertNotIn("fixture-only-never-exposed", page.text + json.dumps(config) + self.client.get("/healthz").text)

    def test_existing_profiles_survive_private_game_process_restart(self):
        with closing(sqlite3.connect(self.database)) as db:
            db.execute("INSERT INTO profiles(board,user_id,name,avatar,progress) VALUES(?,?,?,?,?)",
                       ("fixture-board", "123456789012345678", "Player", "", '{"level":3}'))
            db.commit()
        self.stop_game()
        self.start_game()
        self.assertEqual(self.client.get("/readyz").status_code, 200)
        with closing(sqlite3.connect(self.database)) as db:
            row = db.execute("SELECT name,progress FROM profiles WHERE board=? AND user_id=?",
                             ("fixture-board", "123456789012345678")).fetchone()
        self.assertEqual(row, ("Player", '{"level":3}'))

    def test_missing_volume_keeps_existing_api_online_without_ephemeral_game_sessions(self):
        self.stop_game()
        self.start_game(storage=False)
        health = self.client.get("/healthz")
        self.assertEqual(health.status_code, 200)
        self.assertFalse(health.json()["game"]["gameConfigured"])
        self.assertIn("RAILWAY_VOLUME_MOUNT_PATH", health.json()["game"]["missingConfiguration"])
        self.assertEqual(self.client.get("/readyz").status_code, 503)
        self.assertEqual(self.client.get("/api/x/linked").json(), {"legacy": True})
        self.assertFalse(self.client.get("/api/config").json()["configured"])
        self.assertEqual(self.client.post("/api/discord/session", json={"code": "fixture-code"}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
