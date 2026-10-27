"""Exercise the real unified image without any real Discord/OAuth credentials."""

import json
import http.client
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


def docker(*args, timeout=120):
    return subprocess.check_output(["docker", *args], text=True, timeout=timeout).strip()


def request(base, path, *, data=None):
    req = urllib.request.Request(base + path, data=data, headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.read()


def wait_for(base, path, *, expected=200):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            status, body = request(base, path)
            if status == expected:
                return json.loads(body)
        except (OSError, http.client.HTTPException, json.JSONDecodeError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"Container did not reach {path} ({expected})")


def public_base(name):
    info = json.loads(docker("inspect", name))[0]
    port = info["NetworkSettings"]["Ports"]["8000/tcp"][0]["HostPort"]
    return f"http://127.0.0.1:{port}"


def launch(image, name, volume, *, secret=True):
    values = {
        "PORT": "8000", "RAILWAY_ENVIRONMENT_ID": "ci", "RAILWAY_VOLUME_MOUNT_PATH": "/data",
        "DISCORD_CLIENT_ID": "1466831420575186985", "X_CLIENT_ID": "ci-only-client",
        "X_REDIRECT_URI": "https://example.invalid/x/callback", "LINK_SECRET": "ci-only-link-secret",
        "DB_FILE": "/data/bot-test.sqlite", "PROFILE_CARD_CACHE_DIR": "/tmp/card-cache",
    }
    if secret:
        values["DISCORD_CLIENT_SECRET"] = "ci-only-not-a-real-secret"
    args = ["run", "--detach", "--name", name, "--publish", "127.0.0.1::8000",
            "--mount", f"type=volume,source={volume},target=/data"]
    for key, value in values.items():
        args.extend(["--env", f"{key}={value}"])
    args.extend([image, "python", "start.py", "--web-only"])
    docker(*args)
    return public_base(name)


def main():
    image = sys.argv[1] if len(sys.argv) > 1 else "forest-trail-combined-ci"
    suffix = uuid.uuid4().hex[:12]
    volume = f"forest-combined-ci-data-{suffix}"
    names = [f"forest-combined-ci-{suffix}", f"forest-combined-ci-unconfigured-{suffix}"]
    docker("volume", "create", volume)
    try:
        base = launch(image, names[0], volume)
        ready = wait_for(base, "/readyz")
        assert ready["game"]["gameConfigured"] is True
        status, page = request(base, "/")
        assert status == 200 and b"Forest Trail" in page
        status, config = request(base, "/api/config")
        assert status == 200 and json.loads(config)["configured"] is True
        assert b"ci-only-not-a-real-secret" not in page + config
        assert request(base, "/api/leaderboard")[0] == 401
        for path in ("/.env", "/start.py", "/game/server/combined.js", "/Dockerfile", "/bot_database.db"):
            assert request(base, path)[0] == 404, path
        assert request(base, "/x/start")[0] == 422
        assert request(base, "/x/callback?state=fixture")[0] == 400
        assert request(base, "/api/x/linked?discord_id=123456789012345678")[0] == 200
        docker("exec", names[0], "python", "-c", "import torch,torchvision,easyocr,discord; from PIL import Image; print('Python runtime dependencies OK')")
        assert docker("exec", names[0], "node", "-e", "const {createCanvas}=require('@napi-rs/canvas'); console.log(createCanvas(2,2).width)") == "2"
        write = "import sqlite3; c=sqlite3.connect('/data/forest-trail.sqlite'); c.execute('INSERT INTO profiles(board,user_id,name,avatar,progress) VALUES(?,?,?,?,?)',('ci-board','123456789012345678','Player','','retained')); c.commit(); c.close()"
        docker("exec", names[0], "python", "-c", write)
        docker("restart", "--time", "10", names[0])
        base = public_base(names[0])
        wait_for(base, "/readyz")
        read = "import sqlite3; c=sqlite3.connect('/data/forest-trail.sqlite'); print(c.execute('SELECT progress FROM profiles WHERE board=?',('ci-board',)).fetchone()[0]); c.close()"
        assert docker("exec", names[0], "python", "-c", read) == "retained"
        killer = "import os,signal; found=False\nfor p in os.listdir('/proc'):\n if not p.isdigit(): continue\n try: args=open('/proc/'+p+'/cmdline','rb').read().split(b'\\0')\n except OSError: continue\n if len(args)>1 and args[0].endswith(b'/node') and args[1].endswith(b'/game/server/combined.js'):\n  os.kill(int(p),signal.SIGTERM); found=True; break\nassert found"
        docker("exec", names[0], "python", "-c", killer)
        assert int(docker("wait", names[0], timeout=30)) != 0, "A failed child must stop the unified deployment"
        degraded_base = launch(image, names[1], volume, secret=False)
        state = wait_for(degraded_base, "/healthz")
        deadline = time.monotonic() + 30
        while state["status"] == "starting" and time.monotonic() < deadline:
            time.sleep(0.5)
            state = wait_for(degraded_base, "/healthz")
        assert state["status"] == "needs_configuration"
        assert "DISCORD_CLIENT_SECRET" in state["game"]["missingConfiguration"]
        assert request(degraded_base, "/readyz")[0] == 503
        assert request(degraded_base, "/api/discord/session", data=b'{"code":"fixture"}')[0] == 503
        assert request(degraded_base, "/api/x/linked?discord_id=123456789012345678")[0] == 200
        print("Combined image passed: one public host, legacy OAuth, private game, persistence, failure supervision and safe missing configuration")
    except Exception:
        for name in names:
            exists = subprocess.run(["docker", "inspect", name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
            if exists.returncode == 0:
                subprocess.run(["docker", "logs", "--tail", "100", name], check=False, timeout=30)
        raise
    finally:
        for name in names:
            subprocess.run(["docker", "rm", "--force", name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "volume", "rm", volume], check=False, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
