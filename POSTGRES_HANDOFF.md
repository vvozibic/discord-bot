# PostgreSQL Handoff

This project supports PostgreSQL when `DATABASE_URL` is set.

## Variable to set on server

- `DATABASE_URL`

Example format:

```text
postgresql://USER:PASSWORD@HOST:PORT/DBNAME
```

## Local setup

1. Add to `.env`:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start app normally (`python start.py` or your current service command).

## Runtime behavior

- If `DATABASE_URL` is set, app uses PostgreSQL.
- If `DATABASE_URL` is empty, app falls back to local SQLite (`DB_FILE`, default `bot_database.db`).
- Tables are created automatically on startup.

## Quick verification after deploy

1. Run `/xlink` + `/verify` once.
2. Check metrics endpoint:

```text
GET /api/x/metrics?discord_id=<DISCORD_USER_ID>
```

Expected data fields:

- `discord_id`
- `discord_username`
- `x_username`
- `verified`
- `last_verify_timestamp`
- `last_score`
- `role_assigned`

## Security note

If a raw DB URL/password was shared in chat or screenshots, rotate credentials after setup.
