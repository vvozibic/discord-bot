"""Helpers for campaign X proof link export reports."""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterable


X_STATUS_PROOF_RE = re.compile(
    r"(?:https?://)?(?:www\.)?x\.com/([A-Za-z0-9_]{1,15})/status/(\d+)",
    re.IGNORECASE,
)
URL_RE = re.compile(
    r"https?://[^\s<>\"]+|(?:www\.)?x\.com/[^\s<>\"]+",
    re.IGNORECASE,
)
TRAILING_LINK_PUNCTUATION = ".,!?;:)]}'\""


def extract_x_status_proofs(content: str) -> list[tuple[str, str]]:
    """Return (handle, status_id) pairs from X status links in content."""
    return [
        (match.group(1).lower(), match.group(2))
        for match in X_STATUS_PROOF_RE.finditer(content or "")
    ]


def extract_links(content: str) -> list[str]:
    """Return cleaned HTTP(S) and X links from content."""
    links = []
    for match in URL_RE.finditer(content or ""):
        link = match.group(0).rstrip(TRAILING_LINK_PUNCTUATION)
        if link.lower().startswith(("x.com/", "www.x.com/")):
            link = f"https://{link}"
        if link:
            links.append(link)
    return links


def find_no_duplicate_x_proof_user_ids(
    messages: Iterable[tuple[int | str, str]],
) -> tuple[list[str], dict[str, int]]:
    """Return users who never posted another user's previously seen X status.

    Messages must be supplied in chronological order. The first author of a
    status ID is its owner. Reposting your own status is allowed; posting a
    status first seen from another Discord user disqualifies the later user.
    """
    status_owners: dict[str, str] = {}
    users_with_proofs: set[str] = set()
    disqualified_users: set[str] = set()

    for author_id, content in messages:
        author_id = str(author_id)
        status_ids = {
            status_id
            for _, status_id in extract_x_status_proofs(content)
        }
        if not status_ids:
            continue

        users_with_proofs.add(author_id)
        for status_id in status_ids:
            owner_id = status_owners.setdefault(status_id, author_id)
            if owner_id != author_id:
                disqualified_users.add(author_id)

    eligible_users = users_with_proofs - disqualified_users
    sorted_user_ids = sorted(
        eligible_users,
        key=lambda value: (not value.isdigit(), int(value) if value.isdigit() else value),
    )
    stats = {
        "proof_user_count": len(users_with_proofs),
        "disqualified_user_count": len(disqualified_users),
        "eligible_user_count": len(sorted_user_ids),
        "unique_status_count": len(status_owners),
    }
    return sorted_user_ids, stats


def find_no_duplicate_x_proof_user_link_rows(
    messages: Iterable[tuple[int | str, str]],
) -> tuple[list[dict[str, str | int]], dict[str, int]]:
    """Return eligible users with all links they posted."""
    status_owners: dict[str, str] = {}
    user_links: dict[str, list[str]] = {}
    user_seen_links: dict[str, set[str]] = {}
    users_with_proofs: set[str] = set()
    disqualified_users: set[str] = set()

    for author_id, content in messages:
        author_id = str(author_id)
        for link in extract_links(content):
            user_seen_links.setdefault(author_id, set())
            if link in user_seen_links[author_id]:
                continue
            user_seen_links[author_id].add(link)
            user_links.setdefault(author_id, []).append(link)

        proofs = extract_x_status_proofs(content)
        if not proofs:
            continue

        users_with_proofs.add(author_id)
        for _, status_id in proofs:
            owner_id = status_owners.setdefault(status_id, author_id)
            if owner_id != author_id:
                disqualified_users.add(author_id)

    eligible_users = users_with_proofs - disqualified_users
    sorted_user_ids = sorted(
        eligible_users,
        key=lambda value: (not value.isdigit(), int(value) if value.isdigit() else value),
    )
    rows = []
    for user_id in sorted_user_ids:
        links = user_links.get(user_id, [])
        rows.append(
            {
                "user_id": user_id,
                "link_count": len(links),
                "links": " ".join(links),
            }
        )

    stats = {
        "proof_user_count": len(users_with_proofs),
        "disqualified_user_count": len(disqualified_users),
        "eligible_user_count": len(rows),
        "unique_status_count": len(status_owners),
    }
    return rows, stats


def build_user_id_csv(user_ids: Iterable[int | str]) -> bytes:
    """Build a CSV with one user_id column."""
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["user_id"])
    for user_id in user_ids:
        writer.writerow([str(user_id)])
    return output.getvalue().encode("utf-8-sig")


def build_user_link_csv(rows: Iterable[dict[str, str | int]]) -> bytes:
    """Build a CSV with user IDs and all links they posted."""
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["user_id", "link_count", "links"],
        lineterminator="\n",
    )
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue().encode("utf-8-sig")
