import csv
import io
import unittest
from datetime import datetime, timezone

import channel_contributor_report


class FakeAuthor:
    def __init__(self, user_id, name, display_name=None, bot=False):
        self.id = user_id
        self.name = name
        self.display_name = display_name or name
        self.bot = bot


class FakeMessage:
    def __init__(self, author, created_at):
        self.author = author
        self.created_at = created_at


def decode_csv_rows(csv_bytes):
    decoded = csv_bytes.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(decoded)))


class ChannelContributorReportTests(unittest.TestCase):
    def test_collects_unique_non_bot_authors_and_exports_mentions(self):
        first_seen = datetime(2026, 6, 1, 10, 0, tzinfo=timezone.utc)
        last_seen = datetime(2026, 6, 1, 12, 30, tzinfo=timezone.utc)
        other_seen = datetime(2026, 6, 1, 11, 15, tzinfo=timezone.utc)
        messages = [
            FakeMessage(FakeAuthor(100, "alice", "Alice Region"), first_seen),
            FakeMessage(FakeAuthor(999, "helper", "Helper Bot", bot=True), other_seen),
            FakeMessage(FakeAuthor(200, "bob", "Bob Region"), other_seen),
            FakeMessage(FakeAuthor(100, "alice", "Alice Region"), last_seen),
        ]

        rows, stats = channel_contributor_report.collect_channel_contributors(
            messages,
            channel_id=12345,
            channel_name="europe-chat",
        )
        csv_rows = decode_csv_rows(
            channel_contributor_report.build_channel_contributor_csv(rows)
        )

        self.assertEqual(stats["scanned_messages"], 4)
        self.assertEqual(stats["total_users"], 2)
        self.assertEqual([row["user_id"] for row in csv_rows], ["100", "200"])

        alice = csv_rows[0]
        self.assertEqual(alice["channel_id"], "12345")
        self.assertEqual(alice["channel_name"], "europe-chat")
        self.assertEqual(alice["mention"], "<@100>")
        self.assertEqual(alice["nickname"], "Alice Region")
        self.assertEqual(alice["username"], "alice")
        self.assertEqual(alice["message_count"], "2")
        self.assertEqual(alice["currently_in_guild"], "unknown")
        self.assertEqual(alice["member_fetch_status"], "pending")
        self.assertEqual(alice["first_message_at_utc"], first_seen.isoformat())
        self.assertEqual(alice["last_message_at_utc"], last_seen.isoformat())

    def test_sorting_uses_message_count_then_nickname_then_user_id(self):
        rows = [
            {"user_id": 300, "nickname": "Charlie", "message_count": 3},
            {"user_id": 200, "nickname": "Bravo", "message_count": 1},
            {"user_id": 100, "nickname": "Alpha", "message_count": 3},
            {"user_id": 50, "nickname": "Alpha", "message_count": 3},
        ]

        sorted_rows = channel_contributor_report.sort_channel_contributor_rows(rows)

        self.assertEqual(
            [row["user_id"] for row in sorted_rows],
            [50, 100, 300, 200],
        )

    def test_apply_member_identity_refreshes_current_discord_names(self):
        user = {
            "nickname": "Old Nick",
            "username": "old_username",
            "currently_in_guild": "unknown",
            "member_fetch_status": "pending",
        }
        member = FakeAuthor(100, "fresh_username", "Fresh Nick")

        channel_contributor_report.apply_member_identity(user, member, "ok")

        self.assertEqual(user["nickname"], "Fresh Nick")
        self.assertEqual(user["username"], "fresh_username")
        self.assertIs(user["currently_in_guild"], True)
        self.assertEqual(user["member_fetch_status"], "ok")


if __name__ == "__main__":
    unittest.main()
