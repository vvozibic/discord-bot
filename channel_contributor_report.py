"""Helpers for per-channel contributor nickname exports."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable, MutableMapping
from datetime import datetime
from typing import Any


CHANNEL_CONTRIBUTOR_FIELDNAMES = [
    "channel_id",
    "channel_name",
    "user_id",
    "mention",
    "nickname",
    "username",
    "message_count",
    "currently_in_guild",
    "member_fetch_status",
    "first_message_at_utc",
    "last_message_at_utc",
]


def _display_name(author: Any) -> str:
    return (
        getattr(author, "display_name", None)
        or getattr(author, "name", None)
        or str(author)
    )


def _username(author: Any) -> str:
    return getattr(author, "name", None) or str(author)


def _isoformat(value: Any) -> str:
    return value.isoformat() if isinstance(value, datetime) else ""


def update_contributor_from_message(
    users: MutableMapping[int, dict[str, Any]],
    message: Any,
    *,
    channel_id: int,
    channel_name: str,
) -> bool:
    """Update contributor rows from a Discord-like message object.

    Returns True when a non-bot author was recorded.
    """
    author = getattr(message, "author", None)
    if author is None or getattr(author, "bot", False):
        return False

    user_id = int(getattr(author, "id"))
    created_at = getattr(message, "created_at", None)
    user = users.setdefault(
        user_id,
        {
            "channel_id": int(channel_id),
            "channel_name": str(channel_name),
            "user_id": user_id,
            "mention": f"<@{user_id}>",
            "nickname": _display_name(author),
            "username": _username(author),
            "message_count": 0,
            "currently_in_guild": "unknown",
            "member_fetch_status": "pending",
            "first_message_at": created_at,
            "last_message_at": created_at,
        },
    )
    user["message_count"] = int(user["message_count"]) + 1

    first_message_at = user.get("first_message_at")
    if (
        isinstance(created_at, datetime)
        and isinstance(first_message_at, datetime)
        and created_at < first_message_at
    ):
        user["first_message_at"] = created_at
    elif first_message_at is None:
        user["first_message_at"] = created_at

    user["last_message_at"] = created_at
    return True


def apply_member_identity(
    user: MutableMapping[str, Any],
    member: Any,
    fetch_status: str,
) -> None:
    user["nickname"] = _display_name(member)
    user["username"] = _username(member)
    user["currently_in_guild"] = True
    user["member_fetch_status"] = fetch_status


def collect_channel_contributors(
    messages: Iterable[Any],
    *,
    channel_id: int,
    channel_name: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    users: dict[int, dict[str, Any]] = {}
    scanned_messages = 0
    for message in messages:
        scanned_messages += 1
        update_contributor_from_message(
            users,
            message,
            channel_id=channel_id,
            channel_name=channel_name,
        )

    rows = list(users.values())
    return rows, build_channel_contributor_stats(rows, scanned_messages)


def sort_channel_contributor_rows(
    rows: Iterable[dict[str, Any]],
) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            -int(row.get("message_count") or 0),
            str(row.get("nickname") or "").casefold(),
            int(row.get("user_id") or 0),
        ),
    )


def build_channel_contributor_stats(
    rows: Iterable[dict[str, Any]],
    scanned_messages: int,
) -> dict[str, int]:
    rows = list(rows)
    return {
        "scanned_messages": scanned_messages,
        "total_users": len(rows),
        "in_guild": sum(1 for row in rows if row.get("currently_in_guild") is True),
        "left_guild": sum(
            1 for row in rows if row.get("member_fetch_status") == "not_found"
        ),
        "lookup_failed": sum(
            1
            for row in rows
            if str(row.get("member_fetch_status", "")).startswith("http_")
        ),
    }


def build_channel_contributor_csv(rows: Iterable[dict[str, Any]]) -> bytes:
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=CHANNEL_CONTRIBUTOR_FIELDNAMES,
        lineterminator="\n",
    )
    writer.writeheader()
    for row in sort_channel_contributor_rows(rows):
        writer.writerow(
            {
                "channel_id": row.get("channel_id", ""),
                "channel_name": row.get("channel_name", ""),
                "user_id": row.get("user_id", ""),
                "mention": row.get("mention", ""),
                "nickname": row.get("nickname", ""),
                "username": row.get("username", ""),
                "message_count": row.get("message_count", 0),
                "currently_in_guild": row.get("currently_in_guild", ""),
                "member_fetch_status": row.get("member_fetch_status", ""),
                "first_message_at_utc": _isoformat(row.get("first_message_at")),
                "last_message_at_utc": _isoformat(row.get("last_message_at")),
            }
        )
    return output.getvalue().encode("utf-8-sig")
