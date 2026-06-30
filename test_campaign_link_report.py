import unittest

import campaign_link_report


class CampaignLinkReportTests(unittest.TestCase):
    def test_unique_x_status_links_export_both_users(self):
        user_ids, stats = campaign_link_report.find_no_duplicate_x_proof_user_ids(
            [
                ("100", "https://x.com/alice/status/111"),
                ("200", "https://x.com/bob/status/222"),
            ]
        )

        self.assertEqual(user_ids, ["100", "200"])
        self.assertEqual(stats["eligible_user_count"], 2)
        self.assertEqual(stats["disqualified_user_count"], 0)

    def test_later_user_copying_someone_elses_status_is_excluded(self):
        user_ids, stats = campaign_link_report.find_no_duplicate_x_proof_user_ids(
            [
                ("100", "https://x.com/alice/status/111"),
                ("200", "https://x.com/alice/status/111"),
                ("300", "https://x.com/charlie/status/333"),
            ]
        )

        self.assertEqual(user_ids, ["100", "300"])
        self.assertEqual(stats["disqualified_user_count"], 1)

    def test_original_owner_remains_eligible_when_copied(self):
        user_ids, _ = campaign_link_report.find_no_duplicate_x_proof_user_ids(
            [
                ("100", "https://x.com/alice/status/111"),
                ("200", "https://x.com/alice/status/111"),
            ]
        )

        self.assertIn("100", user_ids)
        self.assertNotIn("200", user_ids)

    def test_same_user_reposting_own_status_stays_eligible(self):
        user_ids, stats = campaign_link_report.find_no_duplicate_x_proof_user_ids(
            [
                ("100", "https://x.com/alice/status/111"),
                ("100", "again https://x.com/alice/status/111?s=20"),
            ]
        )

        self.assertEqual(user_ids, ["100"])
        self.assertEqual(stats["unique_status_count"], 1)

    def test_query_params_do_not_create_separate_status_identity(self):
        user_ids, stats = campaign_link_report.find_no_duplicate_x_proof_user_ids(
            [
                ("100", "https://x.com/alice/status/111?s=20"),
                ("200", "https://x.com/alice/status/111?ref=test"),
            ]
        )

        self.assertEqual(user_ids, ["100"])
        self.assertEqual(stats["disqualified_user_count"], 1)

    def test_case_www_and_trailing_slash_match_same_status(self):
        proofs = campaign_link_report.extract_x_status_proofs(
            "HTTP://WWW.X.COM/Alice/status/111/ and https://x.com/bob/status/222?s=20"
        )

        self.assertEqual(proofs, [("alice", "111"), ("bob", "222")])

    def test_extract_links_includes_http_urls_and_bare_x_links(self):
        links = campaign_link_report.extract_links(
            "Links: x.com/alice/status/111, https://example.com/a?b=1 and <https://t.me/MindoAI>"
        )

        self.assertEqual(
            links,
            [
                "https://x.com/alice/status/111",
                "https://example.com/a?b=1",
                "https://t.me/MindoAI",
            ],
        )

    def test_csv_contains_only_user_id_column(self):
        csv_bytes = campaign_link_report.build_user_id_csv(["100", "200"])

        self.assertEqual(csv_bytes.decode("utf-8-sig"), "user_id\n100\n200\n")

    def test_link_rows_include_eligible_users_and_all_their_links(self):
        rows, stats = campaign_link_report.find_no_duplicate_x_proof_user_link_rows(
            [
                ("100", "https://x.com/alice/status/111?s=20 https://example.com/one"),
                ("100", "https://www.x.com/Alice/status/222/"),
                ("200", "https://x.com/alice/status/111?ref=test"),
                ("300", "https://x.com/charlie/status/333 https://t.me/MindoAI"),
            ]
        )

        self.assertEqual(
            rows,
            [
                {
                    "user_id": "100",
                    "link_count": 3,
                    "links": "https://x.com/alice/status/111?s=20 https://example.com/one https://www.x.com/Alice/status/222/",
                },
                {
                    "user_id": "300",
                    "link_count": 2,
                    "links": "https://x.com/charlie/status/333 https://t.me/MindoAI",
                },
            ],
        )
        self.assertEqual(stats["disqualified_user_count"], 1)

    def test_link_csv_contains_user_id_count_and_links_columns(self):
        csv_bytes = campaign_link_report.build_user_link_csv(
            [
                {
                    "user_id": "100",
                    "link_count": 1,
                    "links": "https://x.com/alice/status/111",
                }
            ]
        )

        self.assertEqual(
            csv_bytes.decode("utf-8-sig"),
            "user_id,link_count,links\n"
            "100,1,https://x.com/alice/status/111\n",
        )


if __name__ == "__main__":
    unittest.main()
