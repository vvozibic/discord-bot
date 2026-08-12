import csv
import io
import json
import random
import unittest
from datetime import datetime, timedelta, timezone

import message_audit


def make_row(
    message_id: str,
    author_id: str,
    content: str = "",
    nickname: str = "User",
    attachments=None,
):
    return {
        "message_id": message_id,
        "timestamp_local": "2026-08-04T12:26:00+02:00",
        "timestamp_utc": "2026-08-04T10:26:00Z",
        "author_id": author_id,
        "nickname": nickname,
        "username": f"user{author_id}",
        "global_name": nickname,
        "content": content,
        "attachments": list(attachments or []),
        "sticker_count": 0,
        "embed_count": 0,
        "edited_timestamp_utc": "",
        "jump_url": f"https://discord.com/channels/1/2/{message_id}",
    }


class AuditWindowTests(unittest.TestCase):
    def test_parses_requested_warsaw_minute_range(self):
        window = message_audit.parse_audit_window(
            "04/08/2026 12:26",
            "05/08/2026 13:00",
            "Europe/Warsaw",
        )

        self.assertEqual(window.start_utc.isoformat(), "2026-08-04T10:26:00+00:00")
        self.assertEqual(
            window.end_exclusive_utc.isoformat(),
            "2026-08-05T11:01:00+00:00",
        )
        self.assertTrue(
            window.contains(datetime(2026, 8, 5, 11, 0, 59, tzinfo=timezone.utc))
        )
        self.assertFalse(
            window.contains(datetime(2026, 8, 5, 11, 1, tzinfo=timezone.utc))
        )

    def test_date_only_end_includes_entire_dst_transition_day(self):
        window = message_audit.parse_audit_window(
            "2026-03-29",
            "2026-03-29",
            "Europe/Warsaw",
        )
        self.assertEqual(
            window.end_exclusive_utc - window.start_utc,
            timedelta(hours=23),
        )

    def test_rejects_nonexistent_dst_time(self):
        with self.assertRaisesRegex(ValueError, "skipped daylight-saving-time"):
            message_audit.parse_audit_window(
                "2026-03-29 02:30",
                "2026-03-29 03:30",
                "Europe/Warsaw",
            )

    def test_rejects_ambiguous_dst_time(self):
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            message_audit.parse_audit_window(
                "2026-10-25 02:30",
                "2026-10-25 03:30",
                "Europe/Warsaw",
            )

    def test_final_minute_can_end_at_spring_clock_jump(self):
        window = message_audit.parse_audit_window(
            "2026-03-29 01:59",
            "2026-03-29 01:59",
            "Europe/Warsaw",
        )
        self.assertEqual(
            window.end_exclusive_local.isoformat(),
            "2026-03-29T03:00:00+02:00",
        )
        self.assertEqual(
            window.end_exclusive_utc - window.start_utc,
            timedelta(minutes=1),
        )

    def test_rejects_unknown_timezone_and_backwards_range(self):
        with self.assertRaisesRegex(ValueError, "Unknown timezone"):
            message_audit.parse_audit_window(
                "2026-08-04", "2026-08-05", "Mars/Olympus"
            )
        with self.assertRaisesRegex(ValueError, "End must be"):
            message_audit.parse_audit_window(
                "2026-08-05 13:00",
                "2026-08-05 12:59",
                "Europe/Warsaw",
            )


class CandidateTests(unittest.TestCase):
    def test_attachment_only_user_is_eligible(self):
        row = make_row(
            "10",
            "100",
            attachments=[{"filename": "proof.png", "url": "https://cdn.test/proof.png"}],
        )
        candidates = message_audit.unique_users([row])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["author_id"], "100")
        self.assertEqual(candidates[0]["content_piece"], "[attachment only: proof.png]")

    def test_user_has_one_entry_and_prefers_a_later_text_sample(self):
        rows = [
            make_row("10", "100", attachments=[{"filename": "image.png"}]),
            make_row("11", "100", "A useful message"),
            make_row("12", "200", "Another user", nickname="Same nickname"),
        ]
        candidates = message_audit.unique_users(rows)
        self.assertEqual([candidate["author_id"] for candidate in candidates], ["100", "200"])
        self.assertEqual(candidates[0]["content_piece"], "A useful message")
        self.assertEqual(candidates[0]["representative_message_id"], "11")
        self.assertEqual(candidates[0]["message_count"], 2)
        self.assertEqual(candidates[0]["attachment_only_message_count"], 1)

    def test_sampling_is_unique_and_not_weighted_by_message_count(self):
        rows = [make_row(str(index), "100", f"message {index}") for index in range(10)]
        rows += [make_row("20", "200", "second"), make_row("30", "300", "third")]

        winners = message_audit.select_winners(rows, 5, rng=random.Random(7))
        winner_ids = [winner["author_id"] for winner in winners]
        self.assertEqual(len(winner_ids), 3)
        self.assertEqual(set(winner_ids), {"100", "200", "300"})


class SerializationTests(unittest.TestCase):
    def test_csv_is_unicode_safe_and_protects_spreadsheet_formulas(self):
        row = make_row("10", "100", "=DANGEROUS()", nickname="Beta🦊")
        csv_bytes = message_audit.build_message_csv([row])
        self.assertTrue(csv_bytes.startswith(b"\xef\xbb\xbf"))

        records = list(csv.DictReader(io.StringIO(csv_bytes.decode("utf-8-sig"))))
        self.assertEqual(records[0]["nickname"], "Beta🦊")
        self.assertEqual(records[0]["content"], "'=DANGEROUS()")

    def test_json_preserves_exact_empty_content_and_attachment_metadata(self):
        row = make_row(
            "10",
            "100",
            attachments=[
                {
                    "id": "500",
                    "filename": "proof.png",
                    "content_type": "image/png",
                    "size": 123,
                    "url": "https://cdn.test/proof.png",
                }
            ],
        )
        winners = message_audit.select_winners([row], 5, rng=random.Random(1))
        payload = json.loads(
            message_audit.build_json_export(
                {"channel_id": "2", "requested_winner_count": 5},
                [row],
                winners,
            )
        )

        self.assertEqual(payload["messages"][0]["content"], "")
        self.assertEqual(payload["messages"][0]["attachments"][0]["filename"], "proof.png")
        self.assertEqual(payload["metadata"]["message_count"], 1)
        self.assertEqual(payload["metadata"]["unique_user_count"], 1)
        self.assertEqual(payload["winners"][0]["author_id"], "100")
        self.assertEqual(payload["users"][0]["content_piece"], "[attachment only: proof.png]")


class FakeAuthor:
    def __init__(self, user_id: int, *, bot: bool = False):
        self.id = user_id
        self.bot = bot


class FakeMessage:
    def __init__(self, message_id: int, created_at: datetime, *, bot: bool = False):
        self.id = message_id
        self.created_at = created_at
        self.author = FakeAuthor(message_id, bot=bot)


class FakeChannel:
    def __init__(self, messages):
        self.messages = list(messages)
        self.history_kwargs = None

    def history(self, **kwargs):
        self.history_kwargs = kwargs

        async def iterator():
            for message in self.messages:
                yield message

        return iterator()


def build_fake_row(message, _window):
    return {
        "message_id": str(message.id),
        "author_id": str(message.author.id),
        "content": "test",
        "attachments": [],
    }


class AuditScanTests(unittest.IsolatedAsyncioTestCase):
    async def test_uses_exact_history_bounds_and_filters_extra_start_second(self):
        window = message_audit.parse_audit_window(
            "04/08/2026 12:26",
            "04/08/2026 12:27",
            "Europe/Warsaw",
        )
        channel = FakeChannel(
            [
                FakeMessage(1, window.start_utc - timedelta(milliseconds=500)),
                FakeMessage(2, window.start_utc),
                FakeMessage(3, window.end_exclusive_utc - timedelta(microseconds=1)),
            ]
        )

        result = await message_audit.scan_channel_messages(
            channel,
            window,
            build_fake_row,
            max_messages=10,
            max_buffer_bytes=10_000,
        )

        self.assertEqual([row["message_id"] for row in result.rows], ["2", "3"])
        self.assertEqual(channel.history_kwargs["limit"], None)
        self.assertTrue(channel.history_kwargs["oldest_first"])
        self.assertEqual(
            channel.history_kwargs["after"],
            window.start_utc - timedelta(seconds=1),
        )
        self.assertEqual(
            channel.history_kwargs["before"],
            window.end_exclusive_utc,
        )

    async def test_scan_cap_counts_bots_before_filtering(self):
        window = message_audit.parse_audit_window(
            "2026-08-04",
            "2026-08-04",
            "UTC",
        )
        messages = [
            FakeMessage(index, window.start_utc + timedelta(minutes=index), bot=True)
            for index in range(1, 4)
        ]

        result = await message_audit.scan_channel_messages(
            FakeChannel(messages),
            window,
            build_fake_row,
            max_messages=2,
            max_buffer_bytes=10_000,
        )

        self.assertEqual(result.fetched_messages, 3)
        self.assertEqual(result.excluded_bot_messages, 2)
        self.assertEqual(result.rows, [])
        self.assertEqual(result.safety_limit_reason, "more than 2 messages to scan")

    async def test_buffer_cap_checks_before_appending_partial_row(self):
        window = message_audit.parse_audit_window(
            "2026-08-04",
            "2026-08-04",
            "UTC",
        )
        message = FakeMessage(1, window.start_utc)

        result = await message_audit.scan_channel_messages(
            FakeChannel([message]),
            window,
            build_fake_row,
            max_messages=10,
            max_buffer_bytes=1,
        )

        self.assertEqual(result.rows, [])
        self.assertIsNotNone(result.safety_limit_reason)


if __name__ == "__main__":
    unittest.main()
