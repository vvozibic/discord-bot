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
- PostgreSQL deployment variable is `DATABASE_URL`. See `POSTGRES_HANDOFF.md` for exact setup and verification steps.
