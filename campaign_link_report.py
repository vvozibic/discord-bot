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


def extract_x_status_proofs(content: str) -> list[tuple[str, str]]:
    """Return (handle, status_id) pairs from X status links in content."""
    return [
        (match.group(1).lower(), match.group(2))
        for match in X_STATUS_PROOF_RE.finditer(content or "")
    ]


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


def build_user_id_csv(user_ids: Iterable[int | str]) -> bytes:
    """Build a CSV with one user_id column."""
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["user_id"])
    for user_id in user_ids:
        writer.writerow([str(user_id)])
    return output.getvalue().encode("utf-8-sig")
