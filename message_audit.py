"""Pure helpers for configurable Discord message audits and raffles."""

from __future__ import annotations

import csv
import io
import json
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from random import Random
from typing import Any, Callable, Iterable, Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


_INPUT_FORMATS = (
    ("%Y-%m-%d", timedelta(days=1)),
    ("%d/%m/%Y", timedelta(days=1)),
    ("%Y-%m-%d %H:%M", timedelta(minutes=1)),
    ("%Y-%m-%dT%H:%M", timedelta(minutes=1)),
    ("%d/%m/%Y %H:%M", timedelta(minutes=1)),
    ("%Y-%m-%d %H:%M:%S", timedelta(seconds=1)),
    ("%Y-%m-%dT%H:%M:%S", timedelta(seconds=1)),
    ("%d/%m/%Y %H:%M:%S", timedelta(seconds=1)),
)


class _Sampler(Protocol):
    def sample(self, population: list[dict[str, Any]], k: int) -> list[dict[str, Any]]:
        ...


@dataclass(frozen=True)
class AuditWindow:
    """A local-time request represented as a half-open UTC interval."""

    requested_start: str
    requested_end: str
    timezone_name: str
    start_local: datetime
    end_exclusive_local: datetime
    start_utc: datetime
    end_exclusive_utc: datetime
    zone: ZoneInfo = field(repr=False, compare=False)

    def contains(self, timestamp: datetime) -> bool:
        """Return whether an aware timestamp falls inside the requested range."""
        if timestamp.tzinfo is None:
            raise ValueError("Message timestamps must include a timezone.")
        timestamp_utc = timestamp.astimezone(timezone.utc)
        return self.start_utc <= timestamp_utc < self.end_exclusive_utc

    def metadata(self) -> dict[str, str]:
        """Return JSON-safe range metadata."""
        return {
            "requested_start": self.requested_start,
            "requested_end": self.requested_end,
            "timezone": self.timezone_name,
            "start_local_inclusive": self.start_local.isoformat(),
            "end_local_exclusive": self.end_exclusive_local.isoformat(),
            "start_utc_inclusive": _iso_utc(self.start_utc),
            "end_utc_exclusive": _iso_utc(self.end_exclusive_utc),
            "range_semantics": (
                "The start is inclusive. The end is inclusive at the precision "
                "entered by the user and stored here as an exclusive boundary."
            ),
        }


@dataclass
class AuditScanResult:
    """Rows and counters produced by one bounded channel-history scan."""

    rows: list[dict[str, Any]]
    fetched_messages: int
    excluded_bot_messages: int
    excluded_filtered_messages: int
    buffered_row_bytes: int
    safety_limit_reason: str | None


def _parse_local_value(raw_value: str, label: str) -> tuple[datetime, timedelta]:
    value = (raw_value or "").strip()
    for format_string, resolution in _INPUT_FORMATS:
        try:
            return datetime.strptime(value, format_string), resolution
        except ValueError:
            continue
    raise ValueError(
        f"{label} must use YYYY-MM-DD, YYYY-MM-DD HH:MM, "
        "DD/MM/YYYY, or DD/MM/YYYY HH:MM (seconds are optional)."
    )


def _localize_strict(value: datetime, zone: ZoneInfo, label: str) -> datetime:
    candidates = [value.replace(tzinfo=zone, fold=fold) for fold in (0, 1)]
    valid_candidates = [
        candidate
        for candidate in candidates
        if candidate.astimezone(timezone.utc).astimezone(zone).replace(tzinfo=None)
        == value
    ]
    if not valid_candidates:
        raise ValueError(
            f"{label} falls in a skipped daylight-saving-time period for {zone.key}."
        )
    if len({candidate.utcoffset() for candidate in valid_candidates}) > 1:
        raise ValueError(
            f"{label} is ambiguous during a daylight-saving-time change for "
            f"{zone.key}. Use UTC or choose an unambiguous boundary."
        )
    return valid_candidates[0]


def parse_audit_window(start: str, end: str, timezone_name: str) -> AuditWindow:
    """Parse editable user input into exact UTC history bounds.

    A date-only end includes that entire local date. An end containing minutes or
    seconds includes the complete final minute or second respectively.
    """
    zone_name = (timezone_name or "").strip()
    try:
        zone = ZoneInfo(zone_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(
            f"Unknown timezone '{zone_name}'. Use an IANA name such as Europe/Warsaw."
        ) from None

    start_naive, _ = _parse_local_value(start, "Start")
    end_naive, end_resolution = _parse_local_value(end, "End")

    start_local = _localize_strict(start_naive, zone, "Start")
    end_local = _localize_strict(end_naive, zone, "End")
    start_utc = start_local.astimezone(timezone.utc)
    if end_resolution == timedelta(days=1):
        # Calendar days can be 23 or 25 hours across DST transitions.
        end_exclusive_local = _localize_strict(
            end_naive + end_resolution,
            zone,
            "End boundary",
        )
        end_exclusive_utc = end_exclusive_local.astimezone(timezone.utc)
    else:
        # Include the final entered minute/second in absolute time. This also
        # handles a clock jump immediately after an otherwise valid end value.
        end_exclusive_utc = end_local.astimezone(timezone.utc) + end_resolution
        end_exclusive_local = end_exclusive_utc.astimezone(zone)

    if end_exclusive_utc <= start_utc:
        raise ValueError("End must be at or after start.")

    return AuditWindow(
        requested_start=(start or "").strip(),
        requested_end=(end or "").strip(),
        timezone_name=zone_name,
        start_local=start_local,
        end_exclusive_local=end_exclusive_local,
        start_utc=start_utc,
        end_exclusive_utc=end_exclusive_utc,
        zone=zone,
    )


def _iso_utc(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def content_piece(row: dict[str, Any], limit: int = 240) -> str:
    """Return a compact human-readable sample without discarding attachment posts."""
    content = " ".join(str(row.get("content") or "").split())
    if content:
        return content if len(content) <= limit else content[: limit - 1] + "…"

    attachments = row.get("attachments") or []
    if attachments:
        filenames = ", ".join(
            str(attachment.get("filename") or "attachment")
            for attachment in attachments[:3]
        )
        if len(attachments) > 3:
            filenames += f", +{len(attachments) - 3} more"
        return f"[attachment only: {filenames}]"

    sticker_count = int(row.get("sticker_count") or 0)
    if sticker_count:
        return f"[sticker-only message: {sticker_count} sticker(s)]"

    embed_count = int(row.get("embed_count") or 0)
    if embed_count:
        return f"[embed-only message: {embed_count} embed(s)]"

    return "[no visible text body]"


def unique_users(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return one raffle candidate per stable Discord user ID."""
    candidates: list[dict[str, Any]] = []
    indexes: dict[str, int] = {}
    has_text: dict[str, bool] = {}

    for row in rows:
        author_id = str(row.get("author_id") or "").strip()
        if not author_id:
            continue

        row_has_text = bool(str(row.get("content") or "").strip())
        candidate = {
            "author_id": author_id,
            "nickname": str(row.get("nickname") or ""),
            "username": str(row.get("username") or ""),
            "global_name": str(row.get("global_name") or ""),
            "content_piece": content_piece(row),
            "representative_message_id": str(row.get("message_id") or ""),
            "message_count": 1,
            "attachment_only_message_count": int(
                not row_has_text and bool(row.get("attachments"))
            ),
        }

        if author_id not in indexes:
            indexes[author_id] = len(candidates)
            has_text[author_id] = row_has_text
            candidates.append(candidate)
        else:
            existing = candidates[indexes[author_id]]
            existing["message_count"] += 1
            existing["attachment_only_message_count"] += candidate[
                "attachment_only_message_count"
            ]
            if row_has_text and not has_text[author_id]:
                # Prefer actual text when the user's first row was an image.
                existing["content_piece"] = candidate["content_piece"]
                existing["representative_message_id"] = candidate[
                    "representative_message_id"
                ]
                has_text[author_id] = True

    return candidates


def select_winners(
    rows: Iterable[dict[str, Any]],
    winner_count: int,
    rng: _Sampler | Random | None = None,
) -> list[dict[str, Any]]:
    """Select unique users without weighting prolific senders more heavily."""
    if winner_count < 0:
        raise ValueError("winner_count cannot be negative.")

    candidates = unique_users(rows)
    sample_size = min(winner_count, len(candidates))
    if sample_size == 0:
        return []

    sampler = rng or secrets.SystemRandom()
    return sampler.sample(candidates, sample_size)


_IMAGE_FILENAME_EXTENSIONS = (
    ".apng",
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".heif",
    ".ico",
    ".jpe",
    ".jpeg",
    ".jfif",
    ".jpg",
    ".png",
    ".svg",
    ".tif",
    ".tiff",
    ".webp",
)


def attachment_is_image(attachment: Any) -> bool:
    """Return whether a Discord-like attachment represents an image file."""
    content_type = str(getattr(attachment, "content_type", "") or "")
    normalized_content_type = content_type.partition(";")[0].strip().lower()
    if normalized_content_type and normalized_content_type != "application/octet-stream":
        return normalized_content_type.startswith("image/")

    filename = str(getattr(attachment, "filename", "") or "").strip().lower()
    return filename.endswith(_IMAGE_FILENAME_EXTENSIONS)


def message_has_image_attachment(message: Any) -> bool:
    """Return whether a Discord-like message contains an image attachment."""
    attachments = getattr(message, "attachments", None) or []
    return any(attachment_is_image(attachment) for attachment in attachments)


async def scan_channel_messages(
    channel: Any,
    audit_window: AuditWindow,
    row_builder: Callable[[Any, AuditWindow], dict[str, Any]],
    *,
    max_messages: int,
    max_buffer_bytes: int,
    message_filter: Callable[[Any], bool] | None = None,
) -> AuditScanResult:
    """Collect a bounded snapshot while preserving exact history semantics."""
    if max_messages < 1 or max_buffer_bytes < 1:
        raise ValueError("Audit scan limits must be positive.")

    rows: list[dict[str, Any]] = []
    fetched_messages = 0
    excluded_bot_messages = 0
    excluded_filtered_messages = 0
    buffered_row_bytes = 0
    safety_limit_reason = None

    # Discord's history bounds are exclusive. Fetch one harmless extra second
    # before the requested start, then enforce the exact range below.
    scan_after = audit_window.start_utc - timedelta(seconds=1)
    async for message in channel.history(
        limit=None,
        after=scan_after,
        before=audit_window.end_exclusive_utc,
        oldest_first=True,
    ):
        fetched_messages += 1
        if fetched_messages > max_messages:
            safety_limit_reason = f"more than {max_messages} messages to scan"
            break

        author = getattr(message, "author", None)
        if author is None or getattr(author, "bot", False):
            excluded_bot_messages += 1
            continue
        if not audit_window.contains(message.created_at):
            continue
        if message_filter is not None and not message_filter(message):
            excluded_filtered_messages += 1
            continue

        row = row_builder(message, audit_window)
        row_bytes = len(
            json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )
        if buffered_row_bytes + row_bytes > max_buffer_bytes:
            safety_limit_reason = (
                f"more than {max_buffer_bytes // (1024 * 1024)} MB of message data"
            )
            break
        rows.append(row)
        buffered_row_bytes += row_bytes

    return AuditScanResult(
        rows=rows,
        fetched_messages=fetched_messages,
        excluded_bot_messages=excluded_bot_messages,
        excluded_filtered_messages=excluded_filtered_messages,
        buffered_row_bytes=buffered_row_bytes,
        safety_limit_reason=safety_limit_reason,
    )


_CSV_COLUMNS = (
    "message_id",
    "timestamp_local",
    "timestamp_utc",
    "author_id",
    "nickname",
    "username",
    "global_name",
    "content",
    "content_piece",
    "attachment_count",
    "attachment_filenames",
    "attachment_urls",
    "sticker_count",
    "embed_count",
    "edited_timestamp_utc",
    "jump_url",
)


def _spreadsheet_safe(value: Any) -> str:
    text = "" if value is None else str(value)
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text
    return text


def build_message_csv(rows: Iterable[dict[str, Any]]) -> bytes:
    """Build an Excel-friendly UTF-8 CSV with formula-injection protection."""
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=_CSV_COLUMNS, lineterminator="\n")
    writer.writeheader()

    for row in rows:
        attachments = row.get("attachments") or []
        flat_row = {
            "message_id": row.get("message_id"),
            "timestamp_local": row.get("timestamp_local"),
            "timestamp_utc": row.get("timestamp_utc"),
            "author_id": row.get("author_id"),
            "nickname": row.get("nickname"),
            "username": row.get("username"),
            "global_name": row.get("global_name"),
            "content": row.get("content"),
            "content_piece": content_piece(row),
            "attachment_count": len(attachments),
            "attachment_filenames": " | ".join(
                str(attachment.get("filename") or "") for attachment in attachments
            ),
            "attachment_urls": " | ".join(
                str(attachment.get("url") or "") for attachment in attachments
            ),
            "sticker_count": row.get("sticker_count") or 0,
            "embed_count": row.get("embed_count") or 0,
            "edited_timestamp_utc": row.get("edited_timestamp_utc"),
            "jump_url": row.get("jump_url"),
        }
        writer.writerow({key: _spreadsheet_safe(value) for key, value in flat_row.items()})

    # The BOM makes Unicode nicknames display correctly in common spreadsheet apps.
    return output.getvalue().encode("utf-8-sig")


def build_json_export(
    metadata: dict[str, Any],
    rows: Iterable[dict[str, Any]],
    winners: Iterable[dict[str, Any]],
) -> bytes:
    """Build the canonical JSON export; message content remains unchanged."""
    rows_list = list(rows)
    winners_list = list(winners)
    users_list = unique_users(rows_list)
    document = {
        "metadata": {
            **metadata,
            "message_count": len(rows_list),
            "unique_user_count": len(users_list),
            "selected_winner_count": len(winners_list),
        },
        "winners": winners_list,
        "users": users_list,
        "messages": rows_list,
    }
    return (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
