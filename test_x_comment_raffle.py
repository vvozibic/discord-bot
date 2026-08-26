import random
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import database
import x_comment_raffle


def make_reply(comment_id: int, author_id: str, text: str | None = None):
    return x_comment_raffle.XReply(
        id=str(comment_id),
        author_id=author_id,
        text=text or f"comment {comment_id}",
        created_at="2026-07-17T00:00:00.000Z",
    )


async def no_sleep(_seconds: float):
    return None


class PostIdParsingTests(unittest.TestCase):
    def test_accepts_bare_id_and_x_status_urls(self):
        post_id = "2077814191163924565"
        self.assertEqual(x_comment_raffle.parse_x_post_id(post_id), post_id)
        self.assertEqual(
            x_comment_raffle.parse_x_post_id(
                f"https://x.com/mindo_ai/status/{post_id}?s=20"
            ),
            post_id,
        )
        self.assertEqual(
            x_comment_raffle.parse_x_post_id(
                f"twitter.com/i/web/status/{post_id}"
            ),
            post_id,
        )

    def test_rejects_other_hosts_and_non_status_urls(self):
        with self.assertRaisesRegex(ValueError, "valid x.com"):
            x_comment_raffle.parse_x_post_id(
                "https://example.com/user/status/2077814191163924565"
            )
        with self.assertRaisesRegex(ValueError, "must contain"):
            x_comment_raffle.parse_x_post_id("https://x.com/mindo_ai")


class WinnerSelectionTests(unittest.TestCase):
    def test_unique_author_mode_gives_each_author_one_entry(self):
        replies = [make_reply(index, "spam") for index in range(1, 21)]
        replies += [make_reply(30, "second"), make_reply(40, "third")]

        winners = x_comment_raffle.select_winning_replies(
            replies,
            3,
            unique_authors=True,
            rng=random.Random(7),
        )

        self.assertEqual({winner.author_id for winner in winners}, {"spam", "second", "third"})
        self.assertEqual(len(winners), 3)

    def test_comment_mode_can_select_multiple_comments_from_one_author(self):
        replies = [
            make_reply(1, "same"),
            make_reply(2, "same"),
        ]
        winners = x_comment_raffle.select_winning_replies(
            replies,
            2,
            unique_authors=False,
            rng=random.Random(1),
        )
        self.assertEqual([winner.author_id for winner in winners], ["same", "same"])
        self.assertEqual({winner.id for winner in winners}, {"1", "2"})

    def test_insufficient_pool_fails_instead_of_returning_fewer_winners(self):
        with self.assertRaisesRegex(
            x_comment_raffle.XInsufficientCandidatesError,
            "Only 1 unique",
        ):
            x_comment_raffle.select_winning_replies(
                [make_reply(1, "one"), make_reply(2, "one")],
                2,
                unique_authors=True,
                rng=random.Random(1),
            )

    def test_candidate_hash_is_order_independent(self):
        first = [make_reply(20, "a"), make_reply(10, "b")]
        second = list(reversed(first))
        self.assertEqual(
            x_comment_raffle.candidate_list_hash(first),
            x_comment_raffle.candidate_list_hash(second),
        )


class XApiPaginationTests(unittest.IsolatedAsyncioTestCase):
    def make_client(self):
        return x_comment_raffle.XApiClient(
            object(),
            "secret-token",
            sleep=no_sleep,
        )

    async def test_follows_next_token_and_requests_only_reply_fields(self):
        client = self.make_client()
        client._get_json = AsyncMock(
            side_effect=[
                {
                    "data": [
                        {
                            "id": "101",
                            "author_id": "a",
                            "text": "first",
                            "created_at": "2026-07-17T00:00:00.000Z",
                        }
                    ],
                    "meta": {"next_token": "page-2"},
                },
                {
                    "data": [
                        {
                            "id": "102",
                            "author_id": "b",
                            "text": "second",
                        }
                    ],
                    "meta": {},
                },
            ]
        )

        replies = await client.get_direct_replies(
            "2077814191163924565",
            start_time="2026-07-16T17:54:02.000Z",
            max_replies=5_000,
        )

        self.assertEqual([reply.id for reply in replies], ["101", "102"])
        self.assertEqual(client._get_json.await_count, 2)
        first_params = client._get_json.await_args_list[0].kwargs["params"]
        second_params = client._get_json.await_args_list[1].kwargs["params"]
        self.assertEqual(
            first_params["query"],
            "in_reply_to_tweet_id:2077814191163924565",
        )
        self.assertEqual(first_params["start_time"], "2026-07-16T17:54:02Z")
        self.assertEqual(first_params["max_results"], "500")
        self.assertEqual(first_params["tweet.fields"], "author_id,created_at")
        self.assertNotIn("expansions", first_params)
        self.assertEqual(second_params["next_token"], "page-2")

    async def test_stops_without_partial_draw_when_another_page_exceeds_cap(self):
        client = self.make_client()
        client._get_json = AsyncMock(
            return_value={
                "data": [
                    {"id": str(index + 1), "author_id": f"user-{index}", "text": "x"}
                    for index in range(500)
                ],
                "meta": {"next_token": "more"},
            }
        )

        with self.assertRaisesRegex(
            x_comment_raffle.XReplyLimitError,
            "No partial draw",
        ):
            await client.get_direct_replies(
                "2077814191163924565",
                start_time="2026-07-16T17:54:02Z",
                max_replies=500,
            )
        self.assertEqual(client._get_json.await_count, 1)

    async def test_partial_api_errors_abort_the_draw(self):
        client = self.make_client()
        client._get_json = AsyncMock(
            return_value={
                "data": [{"id": "1", "author_id": "a", "text": "visible"}],
                "errors": [{"detail": "Some results could not be returned"}],
                "meta": {},
            }
        )

        with self.assertRaisesRegex(x_comment_raffle.XApiError, "could not be returned"):
            await client.get_direct_replies(
                "2077814191163924565",
                start_time="2026-07-16T17:54:02Z",
                max_replies=500,
            )

    async def test_small_safety_cap_requests_only_one_extra_result(self):
        client = self.make_client()
        client._get_json = AsyncMock(return_value={"data": [], "meta": {}})

        await client.get_direct_replies(
            "2077814191163924565",
            start_time="2026-07-16T17:54:02Z",
            max_replies=25,
        )

        params = client._get_json.await_args.kwargs["params"]
        self.assertEqual(params["max_results"], "26")


class DrawIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_excludes_original_author_and_only_looks_up_winners(self):
        replies = [
            make_reply(101, "original", "owner reply"),
            make_reply(102, "alice", "alice first"),
            make_reply(103, "alice", "alice second"),
            make_reply(104, "bob", "bob reply"),
        ]
        get_post = AsyncMock(
            return_value=x_comment_raffle.XPost(
                id="2077814191163924565",
                author_id="original",
                created_at="2026-07-16T17:54:02Z",
            )
        )
        get_replies = AsyncMock(return_value=replies)
        get_users = AsyncMock(
            return_value={
                "alice": {"id": "alice", "username": "alice_handle", "name": "Alice"},
                "bob": {"id": "bob", "username": "bob_handle", "name": "Bob"},
            }
        )

        with (
            patch.object(x_comment_raffle.XApiClient, "get_post", get_post),
            patch.object(
                x_comment_raffle.XApiClient,
                "get_direct_replies",
                get_replies,
            ),
            patch.object(
                x_comment_raffle.XApiClient,
                "get_users_by_ids",
                get_users,
            ),
        ):
            draw = await x_comment_raffle.run_x_comment_draw(
                bearer_token="token",
                post_id="2077814191163924565",
                winner_count=2,
                unique_authors=True,
                max_replies=5_000,
                rng=random.Random(4),
                now=datetime(2026, 8, 26, 17, 14, 2, tzinfo=timezone.utc),
                session=object(),
            )

        self.assertEqual(draw.eligible_comment_count, 3)
        self.assertEqual(draw.unique_author_count, 2)
        self.assertEqual({winner.author_id for winner in draw.winners}, {"alice", "bob"})
        self.assertNotIn("101", draw.candidate_comment_ids)
        looked_up_ids = get_users.await_args.args[0]
        self.assertEqual(set(looked_up_ids), {"alice", "bob"})
        self.assertEqual(draw.drawn_at_utc, "2026-08-26T17:14:02Z")

        restored = x_comment_raffle.XCommentDraw.from_dict(draw.to_dict())
        self.assertEqual(restored, draw)

    async def test_profile_lookup_failure_does_not_discard_the_selection(self):
        with (
            patch.object(
                x_comment_raffle.XApiClient,
                "get_post",
                AsyncMock(
                    return_value=x_comment_raffle.XPost(
                        id="2077814191163924565",
                        author_id="original",
                        created_at="2026-07-16T17:54:02Z",
                    )
                ),
            ),
            patch.object(
                x_comment_raffle.XApiClient,
                "get_direct_replies",
                AsyncMock(return_value=[make_reply(102, "alice")]),
            ),
            patch.object(
                x_comment_raffle.XApiClient,
                "get_users_by_ids",
                AsyncMock(side_effect=x_comment_raffle.XApiError("lookup failed")),
            ),
        ):
            draw = await x_comment_raffle.run_x_comment_draw(
                bearer_token="token",
                post_id="2077814191163924565",
                winner_count=1,
                unique_authors=True,
                max_replies=5_000,
                rng=random.Random(4),
                session=object(),
            )

        self.assertEqual(draw.selected_comment_ids, ("102",))
        self.assertIsNone(draw.winners[0].username)


class DrawPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_db_file = database.DB_FILE
        self.old_use_postgres = database.USE_POSTGRES
        database.DB_FILE = str(Path(self.temp_dir.name) / "raffle-test.db")
        database.USE_POSTGRES = False
        await database.init_db()

    async def asyncTearDown(self):
        database.DB_FILE = self.old_db_file
        database.USE_POSTGRES = self.old_use_postgres
        self.temp_dir.cleanup()

    @staticmethod
    def record(draw_id: str, *, is_redraw: bool, created_at: int):
        result = {
            "schema_version": 1,
            "draw_id": draw_id,
            "post_id": "2077814191163924565",
            "original_author_id": "owner",
            "original_post_created_at": "2026-07-16T17:54:02Z",
            "eligible_comment_count": 2,
            "unique_author_count": 2,
            "winner_count": 1,
            "unique_authors": True,
            "candidate_comment_ids": ["101", "102"],
            "selected_comment_ids": ["101"],
            "candidate_hash": "hash",
            "winners": [
                {
                    "comment_id": "101",
                    "author_id": "alice",
                    "text": "winner",
                    "created_at": None,
                    "username": "alice",
                    "name": "Alice",
                }
            ],
            "drawn_at_utc": "2026-08-26T17:14:02Z",
        }
        return {
            "draw_id": draw_id,
            "post_id": result["post_id"],
            "is_redraw": is_redraw,
            "winner_count": 1,
            "unique_authors": True,
            "original_author_id": "owner",
            "eligible_comment_count": 2,
            "unique_author_count": 2,
            "candidate_comment_ids": ["101", "102"],
            "selected_comment_ids": ["101"],
            "candidate_hash": "hash",
            "result": result,
            "requested_by_discord_id": "123",
            "requested_by_discord_username": "staff",
            "guild_id": "456",
            "redraw_reason": "winner declined" if is_redraw else None,
            "created_at": created_at,
        }

    async def test_initial_draw_is_immutable_and_redraw_becomes_current(self):
        first = self.record("first", is_redraw=False, created_at=1)
        competing = self.record("competing", is_redraw=False, created_at=2)

        stored_first = await database.save_x_comment_draw(first)
        stored_competing = await database.save_x_comment_draw(competing)

        self.assertEqual(stored_first["draw_id"], "first")
        self.assertEqual(stored_competing["draw_id"], "first")

        redraw = self.record("redraw", is_redraw=True, created_at=3)
        await database.save_x_comment_draw(redraw)
        latest = await database.get_latest_x_comment_draw(first["post_id"])
        initial = await database.get_initial_x_comment_draw(first["post_id"])

        self.assertEqual(initial["draw_id"], "first")
        self.assertEqual(latest["draw_id"], "redraw")
        self.assertTrue(latest["is_redraw"])
        self.assertEqual(latest["redraw_reason"], "winner declined")


if __name__ == "__main__":
    unittest.main()
