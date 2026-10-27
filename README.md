# On-chain Verification Bot

A Discord bot that listens in `#verify`, validates a submission with an image + X (Twitter) link, queues a verification job in Redis, and posts results with role assignment.

## Features

- Only processes messages in the configured verify channel.
- Requires **exactly 1 image attachment**.
- Parses `@username` and X link, validates the link format, and ensures usernames match.
- Enqueues jobs to Redis and consumes results (stub worker included).
- Assigns a role returned by the worker and posts an embed with details.

## Setup

1. Copy `.env.example` to `.env` and fill in your Discord token.
2. The Python bot starts without privileged intents by default. For message-content features, follow the optional access setup below.
3. Create Discord roles that match the stub worker output (defaults to `Project A`, `Project B`, `Project C`, `Project D`) or adjust the worker output in `bot/src/queue.ts`.
4. Start the services:

```bash
docker-compose up
```

## Submission format

```
@myhandle https://x.com/myhandle/status/123456789012345678
```

The message **must** include exactly one image attachment.

## Local development

```bash
cd bot
npm install
npm run dev
```

## Notes

- The worker is stubbed and returns deterministic fake results based on the user ID + link. Replace the stub worker with your real job processor when ready.
- The bot role must be above the target roles in the Discord role hierarchy to assign them.

## Forest Trail mini-game

The complete Discord Activity and score API live in [`game/`](game/README.md).
The repository's root Dockerfile builds both runtimes. The existing Railway
service keeps `python start.py`: it now supervises the bot, public OAuth/game
gateway and private Node.js game process in the same container. The existing
public domain serves the game and its API as well as the unchanged `/x/*` and
`/api/x/*` routes. No second Railway service or laptop tunnel is required.

Set `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` for the running bot's own
application in that service's Railway Variables, and apply the staged changes.
Attach a persistent volume to the same service, normally at `/data`; the game
database defaults to `<RAILWAY_VOLUME_MOUNT_PATH>/forest-trail.sqlite`.
Existing bot database variables and files are not moved. Use one replica with
the SQLite volume. `GAME_ADMIN_ROLE_IDS` can additionally allow exact admin
role IDs; otherwise players need `beta-tester`, including server owners.

`/healthz` is liveness and reports game configuration separately. `/readyz`
returns 200 only when the game is configured and its database can be opened;
it does not perform a user's Discord login. Missing game credentials/storage
are listed by variable name without secret values. The existing bot stays
available, while game authentication/runs fail closed until setup is complete.

`/play` and the persistent **Play Forest Trail** panel button launch this bot's
own Activity inside Discord. The beta is restricted to the exact `beta-tester`
role in `#beta-testing`; administrators may also use `#admin-only`.
Administrators publish the panel with `/game-panel` in either allowed channel.
The bot registers the persistent view after reconnect and does not repost panels.

```dotenv
FOREST_TRAIL_ENABLED=true
# Optional extra identity check: this SAME bot application's ID.
FOREST_TRAIL_ACTIVITY_ID=
FOREST_TRAIL_GUILD_ID=1400787114333044887
FOREST_TRAIL_TEST_CHANNEL_ID=1421187164187791381
FOREST_TRAIL_BETA_CHANNEL_ID=1564277364089823285
FOREST_TRAIL_BETA_ROLE_ID=1564276225520963726
```

The launcher uses the existing bot token and Gateway command sync. It does not
open a website or launch another bot application's Activity. Existing bot
features keep their current configuration. `FOREST_TRAIL_ENABLED=false` disables
the game launcher and panel publishing without affecting other commands.

Scores are validated by the server and stored under Discord user IDs, with the
latest server nickname for display. Scores and progress survive nickname changes,
restarts and redeployments when the required Railway volume is attached.

Activity hosting does not remove Discord's verification requirements. An
unverified Activity is restricted to developers/app testers and small servers;
Message Content Intent approval alone does not release an Activity to everyone.
See [`game/README.md`](game/README.md) for deployment and Discord configuration.

Validation: build `game/` before running `python -m unittest discover -s . -p
'test_*.py'`; the web integration tests additionally require `httpx`. The
workflow tests both the standalone game and the root combined image, including
legacy routes, volume persistence, child-process failure and missing settings.

## Optional Message Content Intent

The Python bot defaults to `DISCORD_MESSAGE_CONTENT_INTENT=false`, so missing
Discord approval does not prevent it from logging in. Slash commands, Forest
Trail's `/play` and `/game-panel`, FAQ buttons, `/verify` screenshot uploads and
native system-message welcomes do not require message-content access.

Ascended campaign participation checks, automatic duplicate-proof deletion,
`/108-hours-no-duplicates`, `/150h-no-duplicates-links`, `/audit-messages` and
`/audit-image-senders` need Message Content Intent. With access disabled, passive
duplicate checks are skipped and those commands/buttons explain that the feature
is unavailable before reading history or changing campaign eligibility. They do
not emit incomplete content reports. Author-only campaign exports, role exports
and contributor exports remain available.

To restore message-content features, enable **Message Content Intent** under
**Bot → Privileged Gateway Intents** for the application whose token the bot uses,
obtain Discord approval if required, set `DISCORD_MESSAGE_CONTENT_INTENT=true` in
Railway, and restart the bot. Setting the variable alone does not grant access;
Discord will reject the connection if the intent is not enabled or approved.
No Members or Presence privileged intent is requested by this change.

## Automatic member welcomes

When Discord posts a native join notification (`MessageType.new_member`) in
`1401891894329479278`, the bot welcomes that notification's author in
`1421187164187791381`. One message contains:

- `Hey , @member, welcome to Mindo AI` with an actual mention of the joining user.
- The member's current Discord display avatar as a thumbnail (including the
  server avatar or Discord's default avatar when appropriate).
- The supplied Mindo Poker image, bundled as `assets/mindo-welcome.png`, below
  the greeting in the same message.

The channel IDs work without additional configuration and can be overridden:

```dotenv
WELCOME_SOURCE_CHANNEL_ID=1401891894329479278
WELCOME_TARGET_CHANNEL_ID=1421187164187791381
```

Set either ID to `0` to disable welcomes. The destination must be a text channel
in the same server. In **Server Settings → Overview**, set the system messages
channel to the source channel and enable Discord's random welcome messages for
new members. The bot needs **View Channel** in the source channel and **View
Channel**, **Send Messages**, **Attach Files**, and **Embed Links** in the
destination. This uses the existing guild message events; Server Members Intent
is not required.

Only new system join notifications for human users trigger a welcome. Ordinary
chat, other bots' log messages, boosts, and message edits do not. Old channel
history is not replayed when the bot starts. Repeated delivery of the same join
message is ignored for the last 4,096 successful sends in the running process;
a later rejoin with a new system message receives a new welcome. Missing images
and Discord permission/send errors are logged without posting a partial welcome.

Run the welcome checks with `python -m unittest test_member_welcome -v`.

## Configurable message audit and raffle

Members with the configured export-command role can run `/audit-messages` to
export every non-bot message in an editable local date/time range and select
random winners. The default channel is `1527375658014085292`, the default
timezone is `Europe/Warsaw`, and the default raffle selects five unique users:

```env
AUDIT_CHANNEL_ID=1527375658014085292
IMAGE_AUDIT_CHANNEL_ID=1400848157436280943
AUDIT_TIMEZONE=Europe/Warsaw
AUDIT_WINNER_COUNT=5
AUDIT_MAX_RANGE_DAYS=31
AUDIT_MAX_MESSAGES=10000
AUDIT_MAX_BUFFER_MB=8
```

Every run can override the channel, timezone, and winner count:

```text
/audit-messages start:"04/08/2026 12:26" end:"05/08/2026 13:00"
/audit-messages start:"2026-09-01" end:"2026-09-07" timezone_name:"Europe/Warsaw" winner_count:10 channel:#campaign
```

### Image-sender-only audit

`/audit-image-senders` uses the same editable dates, timezone, unique-user
raffle, CSV/JSON output, permissions, and safety limits, but retains only
messages that contain at least one image attachment. A captioned image still
qualifies. Non-image files, link embeds, and stickers alone do not qualify.

Its configured default channel is `1400848157436280943`. For the requested
range, run:

```text
/audit-image-senders start:"25/08/2026 16:48" end:"25/08/2026 17:39"
```

The channel, timezone, and winner count can still be overridden on every run:

```text
/audit-image-senders start:"2026-09-01" end:"2026-09-07" timezone_name:"Europe/Warsaw" winner_count:10 channel:#campaign
```

Image detection prefers Discord's `image/*` attachment MIME type and falls
back to common image filename extensions when Discord does not provide a usable
MIME type. Every qualifying sender receives one raffle entry regardless of how
many images they posted. Image bytes are not downloaded or OCRed.

Accepted date formats are `YYYY-MM-DD` and `DD/MM/YYYY`; add `HH:MM` (and
optionally seconds) for exact times. The start is inclusive. The end is also
inclusive at the entered precision: an end date includes the whole day and an
end such as `13:00` includes the whole `13:00` minute.

The command returns a spreadsheet-safe CSV plus canonical JSON. It retains
attachment-only, sticker-only, embed-only, and empty-text messages, so their
senders remain eligible; images are not downloaded or OCRed. The JSON includes
all message rows, a deduplicated sender list with representative content, and
the winners. Each stable Discord user ID gets one raffle entry regardless of
message count. Bot-authored messages are excluded.

This complements `/exportchannelcontributors`: that command reports one
current-identity row per contributor, while `/audit-messages` preserves every
message, attachment metadata, and raffle outcome for an exact range.

To protect the bot from unbounded scans, either audit command stops without
producing partial winners if it exceeds the configured date, scanned-message,
or memory limit. Bot/webhook and filtered non-image messages count toward the
scan limit even though they are excluded from the image-only export and raffle.
Shorten the range or adjust `AUDIT_MAX_*` when a larger export is intentional.

The bot needs **View Channel** and **Read Message History** in each audited
channel, and **Message Content Intent** must remain enabled. Access follows the
same `EXPORT_COMMAND_ROLE_ID` role gate as the bot's other export commands.

## Private X direct-comment draw

Members with the configured export-command role can privately select direct
replies to an X post:

```text
/pick-x-comments post:"2077814191163924565" winner_count:2 unique_authors:true
/pick-x-comments post:"https://x.com/example/status/2077814191163924565"
```

The response is ephemeral. The command accepts a numeric post ID or complete
`x.com`/`twitter.com` status URL, excludes comments from the original post's
author, and uses `secrets.SystemRandom`. With the default
`unique_authors:true`, each eligible X account receives one entry and one of
that account's direct comments is selected for display. Set it to `false` to
give every eligible direct comment one entry.

The command uses app-only X API authentication and full-archive search. It
anchors the search at the original post's creation time, follows every
`next_token`, requests no author expansions for the candidate pool, and looks
up profiles only for the selected authors. Configure:

```env
X_BEARER_TOKEN=your_x_app_bearer_token
X_RAFFLE_MAX_REPLIES=5000
```

The X app must have access to `GET /2/tweets/search/all`. Full-archive search is
a paid X API capability. Each available reply is a Post resource read, so set
the reply cap deliberately. If another page exists at the configured cap, the
command stops without drawing from a partial candidate list. Deleted,
protected, or withheld replies that X does not return cannot be included.

To prevent invisible rerolls, the first completed result is stored in the bot
database before it is displayed. Running `/pick-x-comments` again returns the
current saved result without calling X or selecting again, even when different
options are supplied. The audit row stores the candidate comment IDs, selected
IDs, candidate-list SHA-256, requester, guild, settings, and result.

An intentional replacement must use:

```text
/redraw-x-comments post:"2077814191163924565" reason:"Original winner declined"
```

The redraw command requires the export-command role plus Discord's **Manage
Server** permission. It preserves the saved winner count and unique-author
rule, records the requester and mandatory reason in a new audit row, and makes
that redraw the current result returned by later `/pick-x-comments` calls.

Before using the command for compensated engagement, confirm that the campaign
complies with the current X Developer Policy and applicable promotion rules.
