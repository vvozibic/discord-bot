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
2. Ensure the bot has **Message Content Intent** enabled in the Discord developer portal.
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
