"""Run the existing bot, OAuth server and Forest Trail in one deployment."""

import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import threading
import time

from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent


def runtime_environment(source=None):
    env = dict(os.environ if source is None else source)
    public_port = int(env.get("PORT", "8000"))
    internal_port = int(env.get("GAME_INTERNAL_PORT", "5180" if public_port == 5179 else "5179"))
    if not 1 <= public_port <= 65535 or not 1 <= internal_port <= 65535:
        raise ValueError("PORT and GAME_INTERNAL_PORT must be valid ports")
    if public_port == internal_port:
        raise ValueError("PORT and GAME_INTERNAL_PORT must be different")
    env.update(PORT=str(public_port), GAME_INTERNAL_PORT=str(internal_port), PYTHONUNBUFFERED="1")
    return env


def child_commands(*, web_only=False):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 24 is required; deploy the repository's root Dockerfile")
    commands = [
        [node, str(ROOT / "game/server/combined.js")],
        [sys.executable, str(ROOT / "start.py"), "--worker"],
    ]
    if not web_only:
        commands.append([sys.executable, str(ROOT / "start.py"), "--bot-only"])
    return commands


def stop_children(children):
    for process in children:
        if process.poll() is None:
            if os.name == "posix":
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
            else:
                process.terminate()
    deadline = time.monotonic() + 8
    for process in children:
        try:
            process.wait(timeout=max(0, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            if os.name == "posix":
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            else:
                process.kill()
            process.wait()


def supervise(commands, env):
    stopped = threading.Event()
    previous = {}

    def shutdown(_signum, _frame):
        stopped.set()

    for signum in (signal.SIGINT, signal.SIGTERM):
        previous[signum] = signal.signal(signum, shutdown)
    children = []
    try:
        for command in commands:
            children.append(subprocess.Popen(
                command, cwd=ROOT, env=env, start_new_session=os.name == "posix",
            ))
        while not stopped.wait(0.2):
            for index, process in enumerate(children):
                code = process.poll()
                if code is not None:
                    print(f"Combined service child {index + 1} exited ({code}); stopping the deployment", flush=True)
                    return code if code > 0 else 1
        return 0
    finally:
        stop_children(children)
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def run_web():
    import uvicorn
    from game_gateway import install_game_routes
    from verify_service import app

    install_game_routes(app, port=int(os.environ["GAME_INTERNAL_PORT"]))
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), log_level="info")


def run_bot():
    import config
    import bot
    if not config.DISCORD_TOKEN:
        raise SystemExit("DISCORD_TOKEN is not set.")
    bot.client.run(config.DISCORD_TOKEN)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--bot-only", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--web-only", action="store_true", help="Run web/game integration checks without connecting a Discord bot")
    args = parser.parse_args(argv)
    if args.worker and args.bot_only:
        parser.error("Choose only one internal worker mode")
    load_dotenv(ROOT / ".env")
    env = runtime_environment()
    if args.worker or args.bot_only:
        os.environ.update(env)
        run_web() if args.worker else run_bot()
        return 0
    return supervise(child_commands(web_only=args.web_only), env)


if __name__ == "__main__":
    raise SystemExit(main())
