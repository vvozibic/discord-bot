import os
import time
import aiosqlite

try:
    import asyncpg
except ImportError:
    asyncpg = None

DB_FILE = os.getenv("DB_FILE", "bot_database.db")
DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
USE_POSTGRES = DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")

_pg_pool = None


def _now() -> int:
    return int(time.time())


async def _ensure_pg_pool():
    global _pg_pool
    if _pg_pool is not None:
        return _pg_pool
    if asyncpg is None:
        raise RuntimeError("DATABASE_URL is set but asyncpg is not installed. Add asyncpg to requirements.")
    _pg_pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    return _pg_pool


async def _init_postgres():
    pool = await _ensure_pg_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS x_accounts (
                discord_id TEXT PRIMARY KEY,
                x_user_id TEXT,
                x_username TEXT,
                x_name TEXT,
                verified BOOLEAN,
                verified_type TEXT,
                linked_at BIGINT
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS verification_history (
                id BIGSERIAL PRIMARY KEY,
                discord_id TEXT NOT NULL,
                discord_username TEXT,
                guild_id TEXT,
                project TEXT,
                score TEXT,
                role_assigned TEXT,
                timestamp BIGINT NOT NULL
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_metrics (
                discord_id TEXT PRIMARY KEY,
                discord_username TEXT,
                x_username TEXT,
                verified BOOLEAN,
                last_verify_timestamp BIGINT,
                last_score TEXT,
                role_assigned TEXT,
                updated_at BIGINT NOT NULL
            )
            """
        )
        await conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_verification_history_discord_id_ts ON verification_history (discord_id, timestamp DESC)"
        )


async def _init_sqlite():
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS x_accounts (
                discord_id TEXT PRIMARY KEY,
                x_user_id TEXT,
                x_username TEXT,
                x_name TEXT,
                verified BOOLEAN,
                verified_type TEXT,
                linked_at INTEGER
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS verification_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                discord_id TEXT,
                discord_username TEXT,
                guild_id TEXT,
                project TEXT,
                score TEXT,
                role_assigned TEXT,
                timestamp INTEGER
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS user_metrics (
                discord_id TEXT PRIMARY KEY,
                discord_username TEXT,
                x_username TEXT,
                verified BOOLEAN,
                last_verify_timestamp INTEGER,
                last_score TEXT,
                role_assigned TEXT,
                updated_at INTEGER
            )
            """
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_verification_history_discord_id_ts ON verification_history (discord_id, timestamp DESC)"
        )
        await db.commit()


async def init_db():
    if USE_POSTGRES:
        await _init_postgres()
    else:
        await _init_sqlite()


async def get_link(discord_id: str):
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM x_accounts WHERE discord_id = $1", discord_id)
            return dict(row) if row else None

    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM x_accounts WHERE discord_id = ?", (discord_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def save_link(discord_id: str, data: dict):
    # data expects keys: x_user_id, x_username, x_name, verified, verified_type, linked_at
    linked_at = data.get("linked_at", _now())
    verified = bool(data.get("verified"))
    x_username = data.get("x_username")

    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO x_accounts (discord_id, x_user_id, x_username, x_name, verified, verified_type, linked_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (discord_id) DO UPDATE SET
                    x_user_id = EXCLUDED.x_user_id,
                    x_username = EXCLUDED.x_username,
                    x_name = EXCLUDED.x_name,
                    verified = EXCLUDED.verified,
                    verified_type = EXCLUDED.verified_type,
                    linked_at = EXCLUDED.linked_at
                """,
                discord_id,
                data.get("x_user_id"),
                x_username,
                data.get("x_name"),
                verified,
                data.get("verified_type"),
                linked_at,
            )
            await conn.execute(
                """
                INSERT INTO user_metrics (discord_id, x_username, verified, updated_at)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (discord_id) DO UPDATE SET
                    x_username = EXCLUDED.x_username,
                    verified = EXCLUDED.verified,
                    updated_at = EXCLUDED.updated_at
                """,
                discord_id,
                x_username,
                verified,
                _now(),
            )
        return

    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            """
            INSERT INTO x_accounts (discord_id, x_user_id, x_username, x_name, verified, verified_type, linked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                x_user_id = excluded.x_user_id,
                x_username = excluded.x_username,
                x_name = excluded.x_name,
                verified = excluded.verified,
                verified_type = excluded.verified_type,
                linked_at = excluded.linked_at
            """,
            (
                discord_id,
                data.get("x_user_id"),
                x_username,
                data.get("x_name"),
                verified,
                data.get("verified_type"),
                linked_at,
            ),
        )
        await db.execute(
            """
            INSERT INTO user_metrics (discord_id, x_username, verified, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                x_username = excluded.x_username,
                verified = excluded.verified,
                updated_at = excluded.updated_at
            """,
            (discord_id, x_username, verified, _now()),
        )
        await db.commit()


async def delete_link(discord_id: str):
    now_ts = _now()
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM x_accounts WHERE discord_id = $1", discord_id)
            await conn.execute(
                """
                INSERT INTO user_metrics (discord_id, x_username, verified, updated_at)
                VALUES ($1, NULL, FALSE, $2)
                ON CONFLICT (discord_id) DO UPDATE SET
                    x_username = NULL,
                    verified = FALSE,
                    updated_at = EXCLUDED.updated_at
                """,
                discord_id,
                now_ts,
            )
        return True

    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute("DELETE FROM x_accounts WHERE discord_id = ?", (discord_id,))
        await db.execute(
            """
            INSERT INTO user_metrics (discord_id, x_username, verified, updated_at)
            VALUES (?, NULL, 0, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                x_username = NULL,
                verified = 0,
                updated_at = excluded.updated_at
            """,
            (discord_id, now_ts),
        )
        await db.commit()
        return True


async def log_result(
    discord_id: str,
    discord_username: str,
    guild_id: str,
    project: str,
    score: str,
    role_assigned: str,
):
    ts = _now()
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO verification_history (discord_id, discord_username, guild_id, project, score, role_assigned, timestamp)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                discord_id,
                discord_username,
                guild_id,
                project,
                score,
                role_assigned,
                ts,
            )
            await conn.execute(
                """
                INSERT INTO user_metrics (discord_id, discord_username, last_verify_timestamp, last_score, role_assigned, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (discord_id) DO UPDATE SET
                    discord_username = EXCLUDED.discord_username,
                    last_verify_timestamp = EXCLUDED.last_verify_timestamp,
                    last_score = EXCLUDED.last_score,
                    role_assigned = EXCLUDED.role_assigned,
                    updated_at = EXCLUDED.updated_at
                """,
                discord_id,
                discord_username,
                ts,
                score,
                role_assigned,
                ts,
            )
        return

    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            """
            INSERT INTO verification_history (discord_id, discord_username, guild_id, project, score, role_assigned, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                discord_id,
                discord_username,
                guild_id,
                project,
                score,
                role_assigned,
                ts,
            ),
        )
        await db.execute(
            """
            INSERT INTO user_metrics (discord_id, discord_username, last_verify_timestamp, last_score, role_assigned, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                discord_username = excluded.discord_username,
                last_verify_timestamp = excluded.last_verify_timestamp,
                last_score = excluded.last_score,
                role_assigned = excluded.role_assigned,
                updated_at = excluded.updated_at
            """,
            (discord_id, discord_username, ts, score, role_assigned, ts),
        )
        await db.commit()


async def get_user_metrics(discord_id: str):
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM user_metrics WHERE discord_id = $1", discord_id)
            return dict(row) if row else None

    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM user_metrics WHERE discord_id = ?", (discord_id,)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def upsert_user_identity(discord_id: str, discord_username: str):
    now_ts = _now()
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO user_metrics (discord_id, discord_username, verified, updated_at)
                VALUES ($1, $2, FALSE, $3)
                ON CONFLICT (discord_id) DO UPDATE SET
                    discord_username = EXCLUDED.discord_username,
                    updated_at = EXCLUDED.updated_at
                """,
                discord_id,
                discord_username,
                now_ts,
            )
        return

    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            """
            INSERT INTO user_metrics (discord_id, discord_username, verified, updated_at)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                discord_username = excluded.discord_username,
                updated_at = excluded.updated_at
            """,
            (discord_id, discord_username, now_ts),
        )
        await db.commit()
