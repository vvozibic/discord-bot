"""Serve Forest Trail through the existing public OAuth host."""

import asyncio
from contextlib import asynccontextmanager

import aiohttp
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from yarl import URL


MAX_BODY = 1024 * 1024
HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade",
}


def forwarded_headers(headers):
    excluded = HOP_HEADERS | {
        item.strip().lower() for item in headers.get("connection", "").split(",")
    }
    return {key: value for key, value in headers.items() if key.lower() not in excluded}


def install_game_routes(app: FastAPI, *, port: int):
    """Install last, preserving all existing /x/* and /api/x/* routes."""
    if not 1 <= port <= 65535:
        raise ValueError("The private game port must be valid")
    if getattr(app.state, "forest_game_installed", False):
        return
    app.state.forest_game_installed = True
    target = f"http://127.0.0.1:{port}"

    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def combined_lifespan(application):
        async with original_lifespan(application):
            async with aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30, connect=3),
                auto_decompress=False, trust_env=False,
            ) as client:
                application.state.forest_game_client = client
                yield

    app.router.lifespan_context = combined_lifespan

    @app.get("/healthz")
    async def combined_health():
        try:
            async with app.state.forest_game_client.get(
                f"{target}/healthz", timeout=aiohttp.ClientTimeout(total=3),
            ) as response:
                game = await response.json()
                ready = response.status == 200 and game.get("gameConfigured") is True
                return {"status": "ok" if ready else "needs_configuration", "mode": "combined", "game": game}
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return {"status": "starting", "mode": "combined", "game": {"gameConfigured": False}}

    @app.get("/readyz")
    async def game_readiness():
        state = await combined_health()
        return JSONResponse(state, status_code=200 if state["status"] == "ok" else 503)

    @app.api_route("/{path:path}", methods=["GET", "HEAD", "POST", "DELETE", "PUT", "PATCH", "OPTIONS"])
    async def game_proxy(request: Request, path: str):
        body = bytearray()
        try:
            async with asyncio.timeout(10):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_BODY:
                        return JSONResponse({"error": "Request is too large"}, status_code=413)
                    body.extend(chunk)
        except asyncio.TimeoutError:
            return JSONResponse({"error": "Request body timed out"}, status_code=408)
        raw_path = request.scope.get("raw_path", request.url.path.encode()).decode("ascii")
        query = request.scope.get("query_string", b"").decode("ascii")
        url = URL(target + raw_path + ("?" + query if query else ""), encoded=True)
        try:
            upstream = await app.state.forest_game_client.request(
                request.method, url, data=bytes(body),
                headers=forwarded_headers(request.headers), allow_redirects=False,
            )
        except (aiohttp.ClientError, asyncio.TimeoutError):
            return JSONResponse({"error": "The game service is starting or unavailable"}, status_code=503)

        async def chunks():
            try:
                async for chunk in upstream.content.iter_chunked(64 * 1024):
                    yield chunk
            finally:
                upstream.release()

        return StreamingResponse(chunks(), status_code=upstream.status, headers=forwarded_headers(upstream.headers))
