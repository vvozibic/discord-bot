import json
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
                profile_image_url TEXT,
                verified BOOLEAN,
                verified_type TEXT,
                linked_at BIGINT
            )
            """
        )
        await conn.execute(
            "ALTER TABLE x_accounts ADD COLUMN IF NOT EXISTS profile_image_url TEXT"
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
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS x_comment_draws (
                draw_id TEXT PRIMARY KEY,
                post_id TEXT NOT NULL,
                is_redraw BOOLEAN NOT NULL DEFAULT FALSE,
                winner_count INTEGER NOT NULL,
                unique_authors BOOLEAN NOT NULL,
                original_author_id TEXT NOT NULL,
                eligible_comment_count INTEGER NOT NULL,
                unique_author_count INTEGER NOT NULL,
                candidate_comment_ids_json TEXT NOT NULL,
                selected_comment_ids_json TEXT NOT NULL,
                candidate_hash TEXT NOT NULL,
                result_json TEXT NOT NULL,
                requested_by_discord_id TEXT NOT NULL,
                requested_by_discord_username TEXT,
                guild_id TEXT NOT NULL,
                redraw_reason TEXT,
                created_at BIGINT NOT NULL
            )
            """
        )
        await conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_x_comment_draws_initial_post
            ON x_comment_draws (post_id)
            WHERE is_redraw = FALSE
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_x_comment_draws_post_created
            ON x_comment_draws (post_id, created_at DESC)
            """
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
                profile_image_url TEXT,
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
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS x_comment_draws (
                draw_id TEXT PRIMARY KEY,
                post_id TEXT NOT NULL,
                is_redraw INTEGER NOT NULL DEFAULT 0,
                winner_count INTEGER NOT NULL,
                unique_authors INTEGER NOT NULL,
                original_author_id TEXT NOT NULL,
                eligible_comment_count INTEGER NOT NULL,
                unique_author_count INTEGER NOT NULL,
                candidate_comment_ids_json TEXT NOT NULL,
                selected_comment_ids_json TEXT NOT NULL,
                candidate_hash TEXT NOT NULL,
                result_json TEXT NOT NULL,
                requested_by_discord_id TEXT NOT NULL,
                requested_by_discord_username TEXT,
                guild_id TEXT NOT NULL,
                redraw_reason TEXT,
                created_at INTEGER NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_x_comment_draws_initial_post
            ON x_comment_draws (post_id)
            WHERE is_redraw = 0
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_x_comment_draws_post_created
            ON x_comment_draws (post_id, created_at DESC)
            """
        )
        async with db.execute("PRAGMA table_info(x_accounts)") as cursor:
            columns = {row[1] for row in await cursor.fetchall()}
        if "profile_image_url" not in columns:
            await db.execute("ALTER TABLE x_accounts ADD COLUMN profile_image_url TEXT")
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
    # data expects keys: x_user_id, x_username, x_name, profile_image_url, verified, verified_type, linked_at
    linked_at = data.get("linked_at", _now())
    verified = bool(data.get("verified"))
    x_username = data.get("x_username")
    profile_image_url = data.get("profile_image_url")

    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO x_accounts (discord_id, x_user_id, x_username, x_name, profile_image_url, verified, verified_type, linked_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (discord_id) DO UPDATE SET
                    x_user_id = EXCLUDED.x_user_id,
                    x_username = EXCLUDED.x_username,
                    x_name = EXCLUDED.x_name,
                    profile_image_url = EXCLUDED.profile_image_url,
                    verified = EXCLUDED.verified,
                    verified_type = EXCLUDED.verified_type,
                    linked_at = EXCLUDED.linked_at
                """,
                discord_id,
                data.get("x_user_id"),
                x_username,
                data.get("x_name"),
                profile_image_url,
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
            INSERT INTO x_accounts (discord_id, x_user_id, x_username, x_name, profile_image_url, verified, verified_type, linked_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE SET
                x_user_id = excluded.x_user_id,
                x_username = excluded.x_username,
                x_name = excluded.x_name,
                profile_image_url = excluded.profile_image_url,
                verified = excluded.verified,
                verified_type = excluded.verified_type,
                linked_at = excluded.linked_at
            """,
            (
                discord_id,
                data.get("x_user_id"),
                x_username,
                data.get("x_name"),
                profile_image_url,
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


def _decode_x_comment_draw(row):
    if not row:
        return None
    value = dict(row)
    value["is_redraw"] = bool(value["is_redraw"])
    value["unique_authors"] = bool(value["unique_authors"])
    value["candidate_comment_ids"] = json.loads(
        value.pop("candidate_comment_ids_json")
    )
    value["selected_comment_ids"] = json.loads(
        value.pop("selected_comment_ids_json")
    )
    value["result"] = json.loads(value.pop("result_json"))
    return value


async def get_initial_x_comment_draw(post_id: str):
    """Return the immutable first draw for a post, if one exists."""
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM x_comment_draws
                WHERE post_id = $1 AND is_redraw = FALSE
                LIMIT 1
                """,
                post_id,
            )
            return _decode_x_comment_draw(row)

    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM x_comment_draws
            WHERE post_id = ? AND is_redraw = 0
            LIMIT 1
            """,
            (post_id,),
        ) as cursor:
            return _decode_x_comment_draw(await cursor.fetchone())


async def get_latest_x_comment_draw(post_id: str):
    """Return the currently effective draw, including an authorized redraw."""
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT * FROM x_comment_draws
                WHERE post_id = $1
                ORDER BY created_at DESC, draw_id DESC
                LIMIT 1
                """,
                post_id,
            )
            return _decode_x_comment_draw(row)

    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM x_comment_draws
            WHERE post_id = ?
            ORDER BY created_at DESC, draw_id DESC
            LIMIT 1
            """,
            (post_id,),
        ) as cursor:
            return _decode_x_comment_draw(await cursor.fetchone())


async def get_x_comment_draw(draw_id: str):
    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM x_comment_draws WHERE draw_id = $1",
                draw_id,
            )
            return _decode_x_comment_draw(row)

    async with aiosqlite.connect(DB_FILE) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM x_comment_draws WHERE draw_id = ?",
            (draw_id,),
        ) as cursor:
            return _decode_x_comment_draw(await cursor.fetchone())


async def save_x_comment_draw(data: dict):
    """Persist a draw and return the canonical stored row.

    Initial draws use a unique post constraint. If two commands race, only the
    first result is retained and both callers receive that same stored result.
    Redraws always receive their own audit row.
    """
    result = data["result"]
    values = (
        data["draw_id"],
        data["post_id"],
        bool(data.get("is_redraw")),
        int(data["winner_count"]),
        bool(data["unique_authors"]),
        data["original_author_id"],
        int(data["eligible_comment_count"]),
        int(data["unique_author_count"]),
        json.dumps(data["candidate_comment_ids"], separators=(",", ":")),
        json.dumps(data["selected_comment_ids"], separators=(",", ":")),
        data["candidate_hash"],
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        data["requested_by_discord_id"],
        data.get("requested_by_discord_username"),
        data["guild_id"],
        data.get("redraw_reason"),
        int(data.get("created_at", _now())),
    )

    if USE_POSTGRES:
        pool = await _ensure_pg_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO x_comment_draws (
                    draw_id, post_id, is_redraw, winner_count, unique_authors,
                    original_author_id, eligible_comment_count, unique_author_count,
                    candidate_comment_ids_json, selected_comment_ids_json,
                    candidate_hash, result_json, requested_by_discord_id,
                    requested_by_discord_username, guild_id, redraw_reason, created_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                    $13, $14, $15, $16, $17
                )
                ON CONFLICT DO NOTHING
                """,
                *values,
            )
        if data.get("is_redraw"):
            return await get_x_comment_draw(data["draw_id"])
        return await get_initial_x_comment_draw(data["post_id"])

    sqlite_values = list(values)
    sqlite_values[2] = int(sqlite_values[2])
    sqlite_values[4] = int(sqlite_values[4])
    async with aiosqlite.connect(DB_FILE) as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO x_comment_draws (
                draw_id, post_id, is_redraw, winner_count, unique_authors,
                original_author_id, eligible_comment_count, unique_author_count,
                candidate_comment_ids_json, selected_comment_ids_json,
                candidate_hash, result_json, requested_by_discord_id,
                requested_by_discord_username, guild_id, redraw_reason, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            tuple(sqlite_values),
        )
        await db.commit()

    if data.get("is_redraw"):
        return await get_x_comment_draw(data["draw_id"])
    return await get_initial_x_comment_draw(data["post_id"])
