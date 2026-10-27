from contextlib import asynccontextmanager
import gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
import threading
import unittest

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.testclient import TestClient

from game_gateway import MAX_BODY, install_game_routes


class GameHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, content_type="application/json", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        self.server.requests.append(self.path)
        if self.path == "/healthz":
            self.send(200, json.dumps({"gameConfigured": self.server.ready}).encode())
        elif self.path == "/compressed":
            self.send(200, gzip.compress(b"game asset bytes"), "application/javascript",
                      {"Content-Encoding": "gzip", "Cache-Control": "public, max-age=3600"})
        elif self.path == "/redirect":
            self.send(302, b"", extra={"Location": "https://never-request.invalid/"})
        else:
            self.send(200, json.dumps({"path": self.path, "headers": dict(self.headers)}).encode())

    def do_HEAD(self):
        self.send(200, b"asset-body", "application/javascript")

    def do_POST(self):
        self.server.requests.append(self.path)
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.send(201, json.dumps({"path": self.path, "body": body.decode(),
                                  "headers": {key.lower(): value for key, value in self.headers.items()}}).encode())


def legacy_app(events):
    @asynccontextmanager
    async def lifespan(app):
        events.append("legacy-started")
        yield
        events.append("legacy-stopped")

    app = FastAPI(lifespan=lifespan)

    @app.get("/x/start")
    async def old_start():
        return RedirectResponse("https://legacy-x.invalid/authorize")

    @app.get("/api/x/linked")
    async def old_linked():
        return {"legacy": True}

    return app


class GameGatewayTests(unittest.TestCase):
    def setUp(self):
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), GameHandler)
        self.upstream.ready = True
        self.upstream.requests = []
        self.thread = threading.Thread(target=self.upstream.serve_forever, daemon=True)
        self.thread.start()
        self.events = []
        self.app = legacy_app(self.events)
        install_game_routes(self.app, port=self.upstream.server_port)
        self.context = TestClient(self.app)
        self.client = self.context.__enter__()

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.upstream.shutdown()
        self.upstream.server_close()
        self.thread.join(timeout=3)
        self.assertEqual(self.events, ["legacy-started", "legacy-stopped"])

    def test_existing_oauth_routes_take_priority_over_game_proxy(self):
        response = self.client.get("/x/start", follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "https://legacy-x.invalid/authorize")
        self.assertEqual(self.client.get("/api/x/linked").json(), {"legacy": True})
        self.assertEqual(self.upstream.requests, [])

    def test_json_auth_headers_origin_and_encoded_query_reach_game(self):
        response = self.client.post("/api/test?next=%2Froom%3Fa%3D1", json={"input": "test"}, headers={
            "Authorization": "Bearer fixture-session", "Origin": "https://1466831420575186985.discordsays.com",
            "Connection": "keep-alive, x-discard", "X-Discard": "not-forwarded",
        })
        self.assertEqual(response.status_code, 201)
        result = response.json()
        self.assertEqual(result["path"], "/api/test?next=%2Froom%3Fa%3D1")
        self.assertEqual(json.loads(result["body"]), {"input": "test"})
        self.assertEqual(result["headers"]["authorization"], "Bearer fixture-session")
        self.assertEqual(result["headers"]["origin"], "https://1466831420575186985.discordsays.com")
        self.assertEqual(result["headers"]["host"], "testserver")
        self.assertNotIn("x-discard", result["headers"])

    def test_compressed_assets_and_head_keep_correct_transport_headers(self):
        response = self.client.get("/compressed")
        self.assertEqual(response.content, b"game asset bytes")
        self.assertEqual(response.headers["content-encoding"], "gzip")
        self.assertEqual(response.headers["cache-control"], "public, max-age=3600")
        head = self.client.head("/asset.js")
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.content, b"")
        self.assertEqual(head.headers["content-length"], "10")

    def test_large_requests_are_rejected_before_forwarding(self):
        response = self.client.post("/api/test", content=b"x" * (MAX_BODY + 1))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.upstream.requests, [])

    def test_proxy_does_not_follow_an_upstream_redirect(self):
        response = self.client.get("/redirect", follow_redirects=False)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["location"], "https://never-request.invalid/")
        self.assertEqual(self.upstream.requests, ["/redirect"])

    def test_liveness_and_game_readiness_have_distinct_results(self):
        self.assertEqual(self.client.get("/readyz").status_code, 200)
        self.upstream.ready = False
        self.assertEqual(self.client.get("/healthz").status_code, 200)
        self.assertEqual(self.client.get("/healthz").json()["status"], "needs_configuration")
        self.assertEqual(self.client.get("/readyz").status_code, 503)

    def test_unavailable_game_does_not_break_existing_oauth_routes(self):
        with socket.socket() as lease:
            lease.bind(("127.0.0.1", 0))
            port = lease.getsockname()[1]
        app = legacy_app([])
        install_game_routes(app, port=port)
        with TestClient(app) as client:
            self.assertEqual(client.get("/").status_code, 503)
            self.assertEqual(client.get("/healthz").json()["status"], "starting")
            self.assertEqual(client.get("/readyz").status_code, 503)
            self.assertEqual(client.get("/api/x/linked").json(), {"legacy": True})


if __name__ == "__main__":
    unittest.main()
