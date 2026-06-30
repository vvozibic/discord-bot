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

    def test_csv_contains_only_user_id_column(self):
        csv_bytes = campaign_link_report.build_user_id_csv(["100", "200"])

        self.assertEqual(csv_bytes.decode("utf-8-sig"), "user_id\n100\n200\n")


if __name__ == "__main__":
    unittest.main()
