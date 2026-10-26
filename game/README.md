# Forest Trail Discord Activity

This directory is the complete Activity frontend and score API. It deploys from
the same `vvozibic/discord-bot` repository as the existing Python bot. Runtime
does not read files, services or tunnels on the developer's laptop.

The Python bot handles `/play` and persistent panel buttons through its existing
Gateway connection. Discord's native Activity callback opens this same bot
application's Activity. There is no browser launch fallback. Opening the hosting
URL directly shows instructions to launch from Discord.

## Railway service

In the existing Railway project, create an Activity service from this repository
with Root Directory `/game`, branch `main`, and config file `/game/railway.json`.
The existing Python service keeps its root and `python start.py` command.

Attach a persistent volume at `/data`, set `RAILWAY_RUN_UID=0`, and keep Serverless
disabled for an always-running game service. Use `/healthz` as the health check.
Generate a Railway HTTPS domain for the service. No local tunnel is used.

Set the variables listed in `.env.server.example`. `DISCORD_CLIENT_ID` and
`DISCORD_CLIENT_SECRET` must belong to the **same application as the running
Python bot**. Use Railway variables for the secret; do not put it in GitHub.
No second bot token, interaction endpoint or privileged intent is needed.

The service refuses to start in Railway without an attached volume, or if its
database path is outside that volume. One replica writes the SQLite WAL database.
Enable Railway volume backups before using the beta for valuable results.

## Discord setup

In the working bot application's Developer Portal, enable Activities and map `/`
to the Activity service's Railway hostname. Keep the working bot's Gateway
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
```

The repository workflow also checks the production container and persistent
volume startup configuration. Unit fixtures use fake OAuth responses only in
tests; production always exchanges and verifies real Discord authorization.
