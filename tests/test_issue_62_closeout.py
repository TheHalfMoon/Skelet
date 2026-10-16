"""Issue #62 closeout-report conformance tests.

Machine-checks `docs/qualification/ISSUE_62_CLOSEOUT_REPORT.md`
offline: every AC (AC-00..AC-04) dispositioned with evidence pointers,
all 7 global gates addressed, all 3 journeys graded, deferrals named
with backlog pointers, limitations and rights decisions recorded, the
single OD-03 disposition presented, and no close action claimed.
"""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "ISSUE_62_CLOSEOUT_REPORT.md"


class Issue62CloseoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")

    def test_all_conditions_dispositioned(self) -> None:
        for token in ("AC-00", "AC-01", "AC-02", "AC-03", "AC-04",
                      "AF-01", "PR #67", "PR #95", "PR #108", "PR #114",
                      "PR #136", "PR #109", "PR #110", "PR #89", "PR #90",
                      "PR #97", "PR #112", "PR #121", "PR #111",
                      "PR #117", "KEEP", "DEFERRED", "DISPOSITIONED"):
            self.assertIn(token, self.doc, msg=f"report missing: {token}")

    def test_evidence_files_cited(self) -> None:
        for token in ("AC-01_VIDEO_FRAME_DECISION.md",
                      "AC-02_BOARD_DECISION.md",
                      "AC-04_POST_LAUNCH_DISPOSITION.md",
                      "VECTORCRAFT_BINARY_QUALIFICATION.md",
                      "PHOTOCRAFT_BINARY_QUALIFICATION.md",
                      "OPENPENCIL_BINARY_QUALIFICATION.md",
                      "BUNDLE_BASELINE.md"):
            self.assertIn(token, self.doc, msg=f"report missing: {token}")

    def test_global_gates_and_journeys(self) -> None:
        for token in ("No architectural inversion", "Rights fail closed",
                      "Agent parity", "Performance", "Tests/reviews",
                      "No launch disruption", "Identity",
                      "PARTIAL-PASS", "PASS for VectorCraft/PhotoCraft"):
            self.assertIn(token, self.doc, msg=f"report missing: {token}")

    def test_deferrals_limitations_rights(self) -> None:
        for token in ("CLOUD_COMMERCIAL_BACKLOG.md", "CB-18", "CB-10",
                      "per-document", "OD-05", "Fair Source",
                      "No proprietary third-party resources"):
            self.assertIn(token, self.doc, msg=f"report missing: {token}")

    def test_single_disposition_no_close_action(self) -> None:
        self.assertIn("OD-03", self.doc)
        self.assertIn("will not close this issue without that explicit authorization", self.doc)
        self.assertNotRegex(self.doc, r"(?i)issue #?62 (is now|has been) closed")


if __name__ == "__main__":
    unittest.main()
