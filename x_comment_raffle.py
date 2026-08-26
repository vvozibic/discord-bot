"""Fetch and securely select direct replies to an X post.

The module deliberately keeps Discord and database concerns out of the X API
client so the pagination and raffle rules can be tested without a bot process.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import secrets
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from urllib.parse import urlsplit

import aiohttp

X_API_BASE_URL = "https://api.x.com"
X_SEARCH_PAGE_SIZE = 500
X_SEARCH_PAGE_DELAY_SECONDS = 1.05
X_HTTP_ATTEMPTS = 3
X_POST_ID_RE = re.compile(r"^[0-9]{1,19}$")
X_POST_HOSTS = {
    "x.com",
    "www.x.com",
    "mobile.x.com",
    "twitter.com",
    "www.twitter.com",
    "mobile.twitter.com",
}


class XCommentRaffleError(RuntimeError):
    """Base class for safe, user-facing raffle failures."""


class XApiError(XCommentRaffleError):
    """The X API request or response was unsuccessful."""


class XReplyLimitError(XCommentRaffleError):
    """The complete candidate set exceeds the configured safety limit."""


class XInsufficientCandidatesError(XCommentRaffleError):
    """The post does not have enough eligible candidates for the draw."""


@dataclass(frozen=True)
class XPost:
    id: str
    author_id: str
    created_at: str


@dataclass(frozen=True)
class XReply:
    id: str
    author_id: str
    text: str
    created_at: str | None = None


@dataclass(frozen=True)
class XWinner:
    comment_id: str
    author_id: str
    text: str
    created_at: str | None
    username: str | None
    name: str | None


@dataclass(frozen=True)
class XCommentDraw:
    draw_id: str
    post_id: str
    original_author_id: str
    original_post_created_at: str
    eligible_comment_count: int
    unique_author_count: int
    winner_count: int
    unique_authors: bool
    candidate_comment_ids: tuple[str, ...]
    selected_comment_ids: tuple[str, ...]
    candidate_hash: str
    winners: tuple[XWinner, ...]
    drawn_at_utc: str

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": 1,
            "draw_id": self.draw_id,
            "post_id": self.post_id,
            "original_author_id": self.original_author_id,
            "original_post_created_at": self.original_post_created_at,
            "eligible_comment_count": self.eligible_comment_count,
            "unique_author_count": self.unique_author_count,
            "winner_count": self.winner_count,
            "unique_authors": self.unique_authors,
            "candidate_comment_ids": list(self.candidate_comment_ids),
            "selected_comment_ids": list(self.selected_comment_ids),
            "candidate_hash": self.candidate_hash,
            "winners": [asdict(winner) for winner in self.winners],
            "drawn_at_utc": self.drawn_at_utc,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, object]) -> XCommentDraw:
        winners_value = value.get("winners")
        if not isinstance(winners_value, list):
            raise ValueError("Stored X draw has no valid winners list.")

        winners = []
        for winner in winners_value:
            if not isinstance(winner, Mapping):
                raise ValueError("Stored X draw contains an invalid winner.")
            winners.append(
                XWinner(
                    comment_id=str(winner["comment_id"]),
                    author_id=str(winner["author_id"]),
                    text=str(winner.get("text") or ""),
                    created_at=(
                        str(winner["created_at"])
                        if winner.get("created_at") is not None
                        else None
                    ),
                    username=(
                        str(winner["username"])
                        if winner.get("username") is not None
                        else None
                    ),
                    name=(
                        str(winner["name"])
                        if winner.get("name") is not None
                        else None
                    ),
                )
            )

        candidate_ids = value.get("candidate_comment_ids")
        selected_ids = value.get("selected_comment_ids")
        if not isinstance(candidate_ids, list) or not isinstance(selected_ids, list):
            raise ValueError("Stored X draw has invalid candidate data.")

        return cls(
            draw_id=str(value["draw_id"]),
            post_id=str(value["post_id"]),
            original_author_id=str(value["original_author_id"]),
            original_post_created_at=str(value["original_post_created_at"]),
            eligible_comment_count=int(value["eligible_comment_count"]),
            unique_author_count=int(value["unique_author_count"]),
            winner_count=int(value["winner_count"]),
            unique_authors=bool(value["unique_authors"]),
            candidate_comment_ids=tuple(str(item) for item in candidate_ids),
            selected_comment_ids=tuple(str(item) for item in selected_ids),
            candidate_hash=str(value["candidate_hash"]),
            winners=tuple(winners),
            drawn_at_utc=str(value["drawn_at_utc"]),
        )


def parse_x_post_id(value: str) -> str:
    """Return a post ID from a bare ID or an x.com/twitter.com status URL."""
    candidate = (value or "").strip().strip("<>")
    if X_POST_ID_RE.fullmatch(candidate):
        return candidate

    if "://" not in candidate:
        candidate = f"https://{candidate}"

    try:
        parsed = urlsplit(candidate)
    except ValueError as exc:
        raise ValueError("Enter a valid X post ID or full X post URL.") from exc

    hostname = (parsed.hostname or "").lower().rstrip(".")
    if parsed.scheme.lower() not in {"http", "https"} or hostname not in X_POST_HOSTS:
        raise ValueError("Enter a valid x.com post URL or its numeric post ID.")

    path_parts = [part for part in parsed.path.split("/") if part]
    for index, part in enumerate(path_parts[:-1]):
        if part.lower() == "status" and X_POST_ID_RE.fullmatch(path_parts[index + 1]):
            return path_parts[index + 1]

    raise ValueError("The X URL must contain `/status/<numeric post ID>`.")


def _format_utc(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _normalize_x_time(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError) as exc:
        raise XApiError("X did not return a valid creation time for the original post.") from exc
    return _format_utc(parsed)


def _payload_error(payload: Mapping[str, object], fallback: str) -> str:
    errors = payload.get("errors")
    if isinstance(errors, list):
        details = []
        for error in errors[:3]:
            if not isinstance(error, Mapping):
                continue
            detail = error.get("detail") or error.get("title")
            if detail:
                details.append(str(detail))
        if details:
            return "; ".join(details)
    return fallback


class XApiClient:
    """Minimal app-only X API client for the reply raffle."""

    def __init__(
        self,
        session: aiohttp.ClientSession,
        bearer_token: str,
        *,
        base_url: str = X_API_BASE_URL,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self._session = session
        self._bearer_token = bearer_token
        self._base_url = base_url.rstrip("/")
        self._sleep = sleep

    async def _get_json(
        self,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
    ) -> dict[str, object]:
        url = f"{self._base_url}{path}"
        headers = {
            "Authorization": f"Bearer {self._bearer_token}",
            "User-Agent": "MindoAI-Discord-X-Comment-Raffle/1.0",
        }

        for attempt in range(X_HTTP_ATTEMPTS):
            try:
                async with self._session.get(url, params=params, headers=headers) as response:
                    status = response.status
                    retry_after = response.headers.get("Retry-After")
                    raw_body = await response.text()
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                if attempt + 1 < X_HTTP_ATTEMPTS:
                    await self._sleep(2**attempt)
                    continue
                raise XApiError(f"Could not reach the X API: {exc}") from exc

            try:
                payload = json.loads(raw_body) if raw_body else {}
            except json.JSONDecodeError:
                payload = {}

            if 200 <= status < 300:
                if not isinstance(payload, dict):
                    raise XApiError("X returned an unexpected response format.")
                return payload

            retryable = status == 429 or status >= 500
            if retryable and attempt + 1 < X_HTTP_ATTEMPTS:
                try:
                    delay = float(retry_after) if retry_after else float(2**attempt)
                except (TypeError, ValueError):
                    delay = float(2**attempt)
                if delay <= 30:
                    await self._sleep(max(0.0, delay))
                    continue

            message = (
                _payload_error(payload, "X rejected the request")
                if isinstance(payload, Mapping)
                else "X rejected the request"
            )
            if status == 403 and path == "/2/tweets/search/all":
                message = (
                    f"{message}. Full-archive search must be enabled for this X app"
                )
            if status == 429:
                message = f"{message}. The X API rate limit was reached"
            raise XApiError(f"{message} (HTTP {status}).")

        raise XApiError("The X API request failed after multiple attempts.")

    async def get_post(self, post_id: str) -> XPost:
        payload = await self._get_json(
            f"/2/tweets/{post_id}",
            params={"tweet.fields": "author_id,created_at"},
        )
        data = payload.get("data")
        if not isinstance(data, Mapping):
            raise XApiError(_payload_error(payload, "The original X post was not found."))

        author_id = data.get("author_id")
        created_at = data.get("created_at")
        if not author_id or not created_at:
            raise XApiError("X did not return the original post author and creation time.")

        return XPost(
            id=str(data.get("id") or post_id),
            author_id=str(author_id),
            created_at=_normalize_x_time(str(created_at)),
        )

    async def get_direct_replies(
        self,
        post_id: str,
        *,
        start_time: str,
        max_replies: int,
    ) -> list[XReply]:
        """Retrieve every available direct reply, or fail before a partial draw."""
        if max_replies < 1:
            raise ValueError("max_replies must be at least 1.")

        replies: list[XReply] = []
        seen_reply_ids: set[str] = set()
        seen_tokens: set[str] = set()
        next_token: str | None = None

        while True:
            remaining_capacity = max_replies - len(replies)
            page_size = min(
                X_SEARCH_PAGE_SIZE,
                max(10, remaining_capacity + 1),
            )
            params = {
                "query": f"in_reply_to_tweet_id:{post_id}",
                "start_time": _normalize_x_time(start_time),
                "max_results": str(page_size),
                "tweet.fields": "author_id,created_at",
            }
            if next_token:
                params["next_token"] = next_token

            payload = await self._get_json("/2/tweets/search/all", params=params)
            if payload.get("errors"):
                raise XApiError(
                    _payload_error(
                        payload,
                        "X returned an incomplete page of direct replies.",
                    )
                )

            page_data = payload.get("data") or []
            if not isinstance(page_data, list):
                raise XApiError("X returned an invalid direct-reply page.")

            for item in page_data:
                if not isinstance(item, Mapping):
                    raise XApiError("X returned an invalid direct reply.")
                reply_id = str(item.get("id") or "")
                author_id = str(item.get("author_id") or "")
                if not X_POST_ID_RE.fullmatch(reply_id) or not author_id:
                    raise XApiError("X returned a direct reply without an ID or author.")
                if reply_id in seen_reply_ids:
                    continue
                seen_reply_ids.add(reply_id)
                replies.append(
                    XReply(
                        id=reply_id,
                        author_id=author_id,
                        text=str(item.get("text") or ""),
                        created_at=(
                            str(item["created_at"])
                            if item.get("created_at") is not None
                            else None
                        ),
                    )
                )

            meta = payload.get("meta") or {}
            if not isinstance(meta, Mapping):
                raise XApiError("X returned invalid pagination metadata.")
            token_value = meta.get("next_token")
            following_token = str(token_value) if token_value else None

            if len(replies) > max_replies or (
                len(replies) >= max_replies and following_token
            ):
                raise XReplyLimitError(
                    f"The post has more than the configured {max_replies:,} replies. "
                    "No partial draw was performed. Raise `X_RAFFLE_MAX_REPLIES` "
                    "only if the additional X API cost is acceptable."
                )

            if not following_token:
                return replies
            if following_token in seen_tokens:
                raise XApiError("X repeated a pagination token; no draw was performed.")

            seen_tokens.add(following_token)
            next_token = following_token
            await self._sleep(X_SEARCH_PAGE_DELAY_SECONDS)

    async def get_users_by_ids(
        self,
        user_ids: Sequence[str],
    ) -> dict[str, dict[str, object]]:
        unique_ids = list(dict.fromkeys(str(user_id) for user_id in user_ids))
        if not unique_ids:
            return {}
        if len(unique_ids) > 100:
            raise ValueError("X user lookup accepts at most 100 IDs.")

        payload = await self._get_json(
            "/2/users",
            params={
                "ids": ",".join(unique_ids),
                "user.fields": "username,name",
            },
        )
        data = payload.get("data") or []
        if not isinstance(data, list):
            raise XApiError("X returned an invalid winner profile response.")

        return {
            str(user["id"]): dict(user)
            for user in data
            if isinstance(user, Mapping) and user.get("id")
        }


def select_winning_replies(
    replies: Sequence[XReply],
    winner_count: int,
    *,
    unique_authors: bool,
    rng=None,
) -> list[XReply]:
    """Securely select replies, optionally giving each author one entry."""
    if winner_count < 1:
        raise ValueError("winner_count must be at least 1.")
    random_source = rng or secrets.SystemRandom()

    if unique_authors:
        replies_by_author: dict[str, list[XReply]] = {}
        for reply in replies:
            replies_by_author.setdefault(reply.author_id, []).append(reply)
        if len(replies_by_author) < winner_count:
            raise XInsufficientCandidatesError(
                f"Only {len(replies_by_author):,} unique eligible X author(s) were found; "
                f"{winner_count:,} winner(s) were requested."
            )
        selected_authors = random_source.sample(
            list(replies_by_author),
            winner_count,
        )
        return [
            random_source.choice(replies_by_author[author_id])
            for author_id in selected_authors
        ]

    if len(replies) < winner_count:
        raise XInsufficientCandidatesError(
            f"Only {len(replies):,} eligible X comment(s) were found; "
            f"{winner_count:,} winner(s) were requested."
        )
    return list(random_source.sample(list(replies), winner_count))


def candidate_list_hash(replies: Sequence[XReply]) -> str:
    candidate_ids = sorted({reply.id for reply in replies}, key=int)
    canonical = "\n".join(candidate_ids).encode("ascii")
    return hashlib.sha256(canonical).hexdigest()


async def run_x_comment_draw(
    *,
    bearer_token: str,
    post_id: str,
    winner_count: int,
    unique_authors: bool,
    max_replies: int,
    rng=None,
    now: datetime | None = None,
    session: aiohttp.ClientSession | None = None,
) -> XCommentDraw:
    """Fetch the complete candidate set and perform one secure draw."""
    token = (bearer_token or "").strip()
    if not token:
        raise XCommentRaffleError(
            "`X_BEARER_TOKEN` is not configured for the bot."
        )
    if not X_POST_ID_RE.fullmatch(post_id):
        raise ValueError("post_id must be a numeric X post ID.")

    owns_session = session is None
    if session is None:
        timeout = aiohttp.ClientTimeout(total=45, connect=10, sock_read=30)
        session = aiohttp.ClientSession(timeout=timeout)

    try:
        api = XApiClient(session, token)
        original_post = await api.get_post(post_id)
        direct_replies = await api.get_direct_replies(
            post_id,
            start_time=original_post.created_at,
            max_replies=max_replies,
        )
        eligible_replies = [
            reply
            for reply in direct_replies
            if reply.author_id != original_post.author_id
        ]
        selected_replies = select_winning_replies(
            eligible_replies,
            winner_count,
            unique_authors=unique_authors,
            rng=rng,
        )

        try:
            selected_users = await api.get_users_by_ids(
                [reply.author_id for reply in selected_replies]
            )
        except XApiError:
            # Winner IDs and comment links remain valid even if a profile was
            # deleted or the optional handle lookup is temporarily unavailable.
            # Complete and persist this selection instead of silently rerolling.
            selected_users = {}
    finally:
        if owns_session and session is not None:
            await session.close()

    drawn_at = now or datetime.now(timezone.utc)
    if drawn_at.tzinfo is None:
        drawn_at = drawn_at.replace(tzinfo=timezone.utc)
    drawn_at = drawn_at.astimezone(timezone.utc)
    drawn_at_text = _format_utc(drawn_at)
    draw_id = f"{post_id}-{drawn_at.strftime('%Y%m%dT%H%M%S%fZ')}"

    winners = []
    for reply in selected_replies:
        user = selected_users.get(reply.author_id, {})
        winners.append(
            XWinner(
                comment_id=reply.id,
                author_id=reply.author_id,
                text=reply.text,
                created_at=reply.created_at,
                username=str(user["username"]) if user.get("username") else None,
                name=str(user["name"]) if user.get("name") else None,
            )
        )

    candidate_ids = tuple(
        sorted({reply.id for reply in eligible_replies}, key=int)
    )
    return XCommentDraw(
        draw_id=draw_id,
        post_id=post_id,
        original_author_id=original_post.author_id,
        original_post_created_at=original_post.created_at,
        eligible_comment_count=len(eligible_replies),
        unique_author_count=len({reply.author_id for reply in eligible_replies}),
        winner_count=winner_count,
        unique_authors=unique_authors,
        candidate_comment_ids=candidate_ids,
        selected_comment_ids=tuple(reply.id for reply in selected_replies),
        candidate_hash=candidate_list_hash(eligible_replies),
        winners=tuple(winners),
        drawn_at_utc=drawn_at_text,
    )
