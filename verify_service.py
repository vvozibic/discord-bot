import os, time, json, hmac, hashlib, base64, secrets, urllib.parse, tempfile
import aiohttp
from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from dotenv import load_dotenv
import database

load_dotenv()

# ---- Config ----
X_CLIENT_ID = os.environ["X_CLIENT_ID"]
X_CLIENT_SECRET = os.environ.get("X_CLIENT_SECRET", "")  # optional for public client
X_REDIRECT_URI = os.environ["X_REDIRECT_URI"]            # e.g. https://your-service.com/x/callback
X_SCOPES = os.environ.get("X_SCOPES", "users.read tweet.read")

LINK_SECRET = os.environ["LINK_SECRET"]  # shared with bot (HMAC)
LINK_TTL = 10 * 60                       # seconds validity of signed link

PENDING_FILE = "oauth_pending.json"
LINKS_FILE = "x_links.json"

app = FastAPI()

@app.on_event("startup")
async def startup_event():
    await database.init_db()

# ---- JSON helpers (atomic write) ----
def _load(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {}

def _atomic_write(path, data):
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix="._tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    finally:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except:
            pass

def _b64url_no_pad(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("utf-8")

def _pkce_challenge(verifier: str) -> str:
    return _b64url_no_pad(hashlib.sha256(verifier.encode("utf-8")).digest())

# ---- Signed link verification (prevents hijack) ----
def _check_sig(discord_id: str, ts: int, sig: str):
    if abs(int(time.time()) - ts) > LINK_TTL:
        raise HTTPException(400, "link expired, run !xlink again")

    msg = f"{discord_id}:{ts}".encode("utf-8")
    expected = hmac.new(LINK_SECRET.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "bad signature")

# ---- X calls ----
async def _token_exchange(code: str, verifier: str) -> dict:
    url = "https://api.x.com/2/oauth2/token"
    headers = {"Content-Type": "application/x-www-form-urlencoded"}

    if X_CLIENT_SECRET:
        basic = base64.b64encode(f"{X_CLIENT_ID}:{X_CLIENT_SECRET}".encode()).decode()
        headers["Authorization"] = f"Basic {basic}"

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": X_REDIRECT_URI,
        "code_verifier": verifier,
        "client_id": X_CLIENT_ID,
    }

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
        async with s.post(url, headers=headers, data=data) as r:
            txt = await r.text()
            if r.status != 200:
                raise HTTPException(r.status, f"token exchange failed: {txt[:300]}")
            return json.loads(txt)

async def _users_me(access_token: str) -> dict:
    url = "https://api.x.com/2/users/me"
    params = {"user.fields": "id,username,name,verified,verified_type"}
    headers = {"Authorization": f"Bearer {access_token}"}

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15)) as s:
        async with s.get(url, headers=headers, params=params) as r:
            txt = await r.text()
            if r.status != 200:
                raise HTTPException(r.status, f"/2/users/me failed: {txt[:300]}")
            return json.loads(txt)

# ---- Routes ----
@app.get("/x/start")
async def x_start(
    discord_id: str = Query(...),
    ts: int = Query(...),
    sig: str = Query(...),
):
    _check_sig(discord_id, ts, sig)

    state = secrets.token_urlsafe(24)
    code_verifier = secrets.token_urlsafe(48)
    code_challenge = _pkce_challenge(code_verifier)

    pending = _load(PENDING_FILE)
    pending[state] = {
        "discord_id": discord_id,
        "code_verifier": code_verifier,
        "created_at": int(time.time())
    }
    _atomic_write(PENDING_FILE, pending)

    params = {
        "response_type": "code",
        "client_id": X_CLIENT_ID,
        "redirect_uri": X_REDIRECT_URI,
        "scope": X_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }

    # Authorize URL documented here. :contentReference[oaicite:7]{index=7}
    auth_url = "https://x.com/i/oauth2/authorize?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    return RedirectResponse(auth_url)

@app.get("/x/callback", response_class=HTMLResponse)
async def x_callback(
    state: str = Query(...),
    code: str = Query(None),
    error: str = Query(None),
    error_description: str = Query(None),
):
    if error:
        return HTMLResponse(f"<h3>X login failed</h3><p>{error}: {error_description}</p>", status_code=400)
    if not code:
        return HTMLResponse("<h3>Missing code</h3>", status_code=400)

    pending = _load(PENDING_FILE)
    st = pending.pop(state, None)
    _atomic_write(PENDING_FILE, pending)

    if not st:
        return HTMLResponse("<h3>Invalid/expired state</h3><p>Run !xlink again.</p>", status_code=400)

    token = await _token_exchange(code, st["code_verifier"])
    me = await _users_me(token["access_token"])
    user = me["data"]

    # Treat verified_type as additional signal (optional)
    verified_raw = bool(user.get("verified", False))
    vtype = (user.get("verified_type") or "").lower().strip()
    verified = verified_raw or (vtype in {"blue", "business", "government"})

    link_payload = {
        "x_user_id": user.get("id"),
        "x_username": user.get("username"),
        "x_name": user.get("name"),
        "verified": verified,
        "verified_type": user.get("verified_type"),
        "linked_at": int(time.time()),
    }
    await database.save_link(st["discord_id"], link_payload)

    return HTMLResponse(get_success_html(user.get("username")), status_code=200)

def get_success_html(username):
    return f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Account Linked</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
            
            body {{
                margin: 0;
                padding: 0;
                font-family: 'Inter', sans-serif;
                background: radial-gradient(circle at top left, #1a2a6c, #b21f1f00),
                            radial-gradient(circle at bottom right, #fdbb2d, #1a2a6c);
                background-color: #0f172a;
                height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                color: white;
                overflow: hidden;
            }}

            .glass-card {{
                background: rgba(255, 255, 255, 0.05);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                padding: 3rem;
                text-align: center;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
                max-width: 400px;
                width: 90%;
                animation: float 6s ease-in-out infinite;
                position: relative;
                overflow: hidden;
            }}

            .glass-card::before {{
                content: '';
                position: absolute;
                top: 0;
                left: -50%;
                width: 100%;
                height: 100%;
                background: linear-gradient(to right, transparent, rgba(255,255,255,0.1), transparent);
                transform: skewX(-25deg);
                animation: shine 3s infinite;
            }}

            .checkmark-circle {{
                width: 80px;
                height: 80px;
                border-radius: 50%;
                background: rgba(16, 185, 129, 0.2);
                display: flex;
                justify-content: center;
                align-items: center;
                margin: 0 auto 1.5rem;
                box-shadow: 0 0 20px rgba(16, 185, 129, 0.4);
            }}

            .checkmark {{
                width: 40px;
                height: 40px;
                fill: #10b981;
                filter: drop-shadow(0 0 5px #10b981);
            }}

            h1 {{
                font-size: 1.8rem;
                font-weight: 600;
                margin-bottom: 0.5rem;
                background: linear-gradient(to right, #fff, #cbd5e1);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }}

            p {{
                color: #94a3b8;
                line-height: 1.5;
                font-size: 0.95rem;
            }}

            .username {{
                color: #38bdf8;
                font-weight: 600;
            }}

            @keyframes float {{
                0%, 100% {{ transform: translateY(0); }}
                50% {{ transform: translateY(-10px); }}
            }}

            @keyframes shine {{
                0% {{ left: -100%; }}
                20% {{ left: 100%; }}
                100% {{ left: 100%; }}
            }}
        </style>
    </head>
    <body>
        <div class="glass-card">
            <div class="checkmark-circle">
                <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
            </div>
            <h1>Success!</h1>
            <p>Your X account <span class="username">@{username}</span><br>has been successfully linked.</p>
            <p style="margin-top: 1rem; font-size: 0.85rem; opacity: 0.7;">You can now close this window and return to Discord.</p>
        </div>
    </body>
    </html>
    """

@app.get("/api/x/linked")
async def api_linked(discord_id: str = Query(...)):
    obj = await database.get_link(discord_id)
    return {"linked": bool(obj), "data": obj}

@app.get("/api/x/metrics")
async def api_metrics(discord_id: str = Query(...)):
    obj = await database.get_user_metrics(discord_id)
    return {"found": bool(obj), "data": obj}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
