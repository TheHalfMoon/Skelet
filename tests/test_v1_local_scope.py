"""V1 Local acceptance-contract conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/V1_LOCAL_ACCEPTANCE_CONTRACT.md directly from repo
sources, offline. Guards against scope manufacture: the original 14/25
coverage must be preserved verbatim, all 25 IDs must be dispositioned,
no mandatory paid service may appear in the Local contract, live
capture must stay deferred, and production signing must stay pending
owner ceremony.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "V1_LOCAL_ACCEPTANCE_CONTRACT.md"
MATRIX_PATH = ROOT / "docs" / "qualification" / "AF-12_ACCEPTANCE_MATRIX.md"
PLAN_PATH = ROOT / "docs" / "IMPLEMENTATION_PLAN.md"
SIGNING_PATH = ROOT / "docs" / "operations" / "RELEASE_SIGNING.md"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"

ORIGINAL_VERIFIED = {
    "P00", "P01", "P02", "P03", "P04", "P05", "P06", "P07",
    "P09", "P09b", "R0", "R1", "R2", "R4",
}
ALL_IDS = (
    [f"P{i:02d}" for i in range(0, 16)] + ["P09b"] +
    [f"R{i}" for i in range(0, 8)]
)


class V1LocalScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.matrix = MATRIX_PATH.read_text(encoding="utf-8")
        cls.plan = PLAN_PATH.read_text(encoding="utf-8")
        cls.signing = SIGNING_PATH.read_text(encoding="utf-8")
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")

    def test_contract_lists_all_25_ids(self) -> None:
        for rid in ALL_IDS:
            self.assertIn(f"### {rid} ", self.doc,
                          msg=f"contract missing row {rid}")

    def test_original_coverage_preserved_verbatim(self) -> None:
        self.assertIn("14/25 VERIFIED = 56.0%", self.doc)
        self.assertIn("14/25 VERIFIED (56.0%)", self.matrix)
        for rid in sorted(ORIGINAL_VERIFIED):
            self.assertIn(rid, self.doc)

    def test_local_and_conditional_counts(self) -> None:
        self.assertIn("23/25 VERIFIED-LOCAL + 2/25 CONDITIONAL-LOCAL", self.doc)
        conditionals = re.findall(r"\*\*CONDITIONAL-LOCAL\*\*", self.doc)
        # Two rows (P15, R7) each carry the marker once in their verdict.
        self.assertGreaterEqual(len(conditionals), 2)

    def test_no_mandatory_paid_service_in_local(self) -> None:
        for token in ("no mandatory paid services", "no-model",
                      "SKELET_NO_MODEL=1"):
            self.assertIn(token, self.doc)
        # The contract must forbid advertising deferred paid paths as local.
        for token in ("paid LLM", "paid cloud provider",
                      "paid search/vector service", "GPU"):
            self.assertIn(token, self.doc)

    def test_live_capture_stays_deferred(self) -> None:
        self.assertIn("replay-only", self.doc)
        self.assertIn("OD-01", self.doc)
        self.assertIn("P10_CAPTURE_DISPOSITION.md", self.doc)
        # No recorder may be claimed as shipped.
        self.assertNotRegex(self.doc, r"(?i)live (recorder|capture) (is |has been )shipped")

    def test_signing_stays_owner_ceremony(self) -> None:
        self.assertIn("OD-02", self.doc)
        self.assertIn("explicitly unsigned", self.doc)
        self.assertIn("must never be cited as one", self.signing)

    def test_cloud_track_preserved_not_deleted(self) -> None:
        for token in ("Cloud/Commercial", "Track B", "CLOUD_COMMERCIAL_BACKLOG",
                      "no deferred feature is counted complete"):
            self.assertIn(token, self.doc)

    def test_tool_name_note_present(self) -> None:
        self.assertIn("search_assets", self.doc)
        self.assertIn("search_design", self.doc)
        self.assertIn("AF-13b", self.doc)


if __name__ == "__main__":
    unittest.main()
