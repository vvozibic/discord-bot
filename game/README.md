# Forest Trail Discord Activity

This directory is the complete Activity frontend and score API. The repository's
root Dockerfile combines it with the existing Python bot in one Railway service.
Runtime does not read files, services or tunnels on the developer's laptop.

The Python bot handles `/play` and persistent panel buttons through its existing
Gateway connection. Discord's native Activity callback opens this same bot
application's Activity. There is no browser launch fallback. Opening the hosting
URL directly shows instructions to launch from Discord.

## One Railway service

Deploy from the repository root on branch `main`. Railway detects the root
Dockerfile, which installs Python 3.11 and Node.js 24, builds the frontend and
retains `python start.py` as the entrypoint. No additional service is created.

The supervisor starts three isolated processes in that container: the existing
Discord Gateway bot, the public FastAPI server and the private Node game server.
The public server keeps the existing `/x/*` and `/api/x/*` routes and forwards
game assets/API calls to loopback. The game process never binds a public port.
The processes shut down together; an unexpected child exit fails the deployment.

Add `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` to the same service's Railway
Variables and apply the staged changes. They must belong to the **same application
as the running Python bot**. The working Mindo AI application ID is
`1466831420575186985`. Keep actual secrets out of GitHub. No second bot token,
Interactions Endpoint URL or privileged intent is needed.

Attach a persistent volume to that service, normally at `/data`. With one
replica, the SQLite game database defaults to
`<RAILWAY_VOLUME_MOUNT_PATH>/forest-trail.sqlite`; `GAME_DATABASE_PATH` may select
another file inside that volume. The existing bot's `DATABASE_URL`/`DB_FILE`
configuration is preserved. Guild/beta scope defaults to the existing Forest
Trail settings. Add exact `GAME_ADMIN_ROLE_IDS` for admins who lack the beta role;
server-owner status alone does not satisfy the game API's role check.

Use the existing public HTTPS hostname for the Activity URL Mapping. `/healthz`
is liveness and includes game status/missing variable names; `/readyz` returns
503 until game configuration and writable persistent storage are available.
These checks do not exchange a real player's OAuth code. Missing game setup does
not stop the bot or existing OAuth endpoints, and never enables temporary scores.
Enable Railway volume backups for results that need to be retained.

For local integration checks, build the frontend and run
`python start.py --web-only` with test OAuth/X variables and a local absolute
`GAME_DATABASE_PATH`. That explicit flag omits the Discord bot process;
production's normal `python start.py` always starts it.

The original `game/Dockerfile` and strict standalone entrypoint remain available
for a separate game service when explicitly desired. Its variables are listed
in `.env.server.example`; it refuses to start with missing credentials/storage.

## Discord setup

In the working bot application's Developer Portal, enable Activities and map `/`
to the existing combined service's Railway hostname. Keep the working bot's Gateway
interaction configuration; do not set an HTTP Interactions Endpoint for this
game service. The app's OAuth client secret must match the service variable.

Unverified Activities are limited by Discord to developers and accepted app
testers, and to small servers. The server's `beta-tester` role does not grant
app-tester status. Public beta access inside the large Mindo AI server requires
the application's Discord verification/distribution requirements to be met.
Message Content Intent approval is a separate permission.

After the Python bot is updated and restarted, an administrator can run
`/game-panel` in `#beta-testing`. Its persistent **Play Forest Trail** button and
`/play` both enforce the exact guild, channel and role IDs. No message is posted
automatically on reconnect.

The bot checks its cached application flags before attempting a launch. If it
reports that Forest Trail is not enabled, check the application ID in its log,
configure that application's URL Mapping and enable Activities. Restart the bot
after changing those settings so its cached flags are refreshed.

Launch failures log the application/interaction IDs, HTTP status, Discord error
code and interaction age without tokens or raw response bodies. An expired or
already acknowledged interaction is not retried. The Activity launch must be
the initial response within Discord's three-second window; do not defer `/play`
before calling `launch_activity()`. An expired error reply cannot replace the
original launch error in the logs.

## Scores and identity

The game connects through Discord's Embedded App SDK and OAuth scopes `identify`
and `guilds.members.read`. The API verifies the app, guild membership and allowed
beta/admin role IDs before creating a game session. The main game requires a
connected profile; there is no anonymous local score fallback.

Profiles, level progress, attempts and verified wins are stored on the persistent
server volume. Identity is keyed by `(server/campaign, Discord user ID)`; the
latest server nickname is displayed separately. Changing a nickname preserves
scores. The leaderboard uses one best verified result per player. Each submitted
run is replayed with server rules, rather than trusting a client-supplied score.

## Validation

```sh
npm ci
npm run build
npm test
docker build -t forest-trail .
# From the repository root: combined Python + Node image
docker build -t forest-trail-combined ..
```

The repository workflow also checks the production container and persistent
volume startup configuration. Unit fixtures use fake OAuth responses only in
tests; production always exchanges and verifies real Discord authorization.
