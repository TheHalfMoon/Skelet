"""Cloud/Commercial backlog conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/CLOUD_COMMERCIAL_BACKLOG.md directly from repo
sources, offline. Guards against silent scope deletion (every Locally
deferred capability must appear here with its original ID and trigger)
and against completion claims (nothing here may be described as done).
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "CLOUD_COMMERCIAL_BACKLOG.md"
CONTRACT_PATH = ROOT / "docs" / "qualification" / "V1_LOCAL_ACCEPTANCE_CONTRACT.md"

REQUIRED_ROWS = [f"CB-{i:02d}" for i in range(1, 20)]
ORIGINAL_IDS = (["P04", "P08", "P10", "P11", "P12", "P13", "P14", "P15"]
                + ["R3", "R5", "R6", "R7"] + ["AC-04"])


class CloudBacklogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.contract = CONTRACT_PATH.read_text(encoding="utf-8")

    def test_all_19_rows_present(self) -> None:
        for row in REQUIRED_ROWS:
            self.assertIn(row, self.doc, msg=f"backlog missing row {row}")

    def test_original_ids_preserved(self) -> None:
        for rid in ORIGINAL_IDS:
            self.assertIn(rid, self.doc, msg=f"backlog missing original ID {rid}")

    def test_triggers_and_gates_present(self) -> None:
        for token in ("Entry trigger / gate", "OD-02", "OD-04",
                      "AF-00 deployment contract", "not offered"):
            self.assertIn(token, self.doc)

    def test_nothing_claimed_complete(self) -> None:
        self.assertIn("Nothing here is claimed implemented", self.doc)
        self.assertNotRegex(self.doc, r"(?i)\bVERIFIED\b.*CB-")
        self.assertNotRegex(self.doc, r"(?i)CB-\d\d.*\bcomplete\b.*proof")

    def test_no_paid_provisioning_authorized(self) -> None:
        self.assertIn("No paid infrastructure is provisioned without explicit owner permission", self.doc)

    def test_contract_pointer_consistent(self) -> None:
        self.assertIn("CLOUD_COMMERCIAL_BACKLOG", self.contract)
        self.assertIn("V1_LOCAL_ACCEPTANCE_CONTRACT", self.doc)
        # Every Cloud row's trigger family must exist in the contract.
        for token in ("OD-01", "OD-02", "OD-04", "P11_SCOPE_DISPOSITION",
                      "P12_APPS_DISPOSITION", "P13_SCOPE_DISPOSITION",
                      "AC-04_POST_LAUNCH_DISPOSITION"):
            self.assertIn(token, self.contract, msg=f"contract missing {token}")

    def test_table_shape(self) -> None:
        rows = re.findall(r"^\| CB-\d\d \|", self.doc, flags=re.MULTILINE)
        self.assertEqual(len(rows), 19)


if __name__ == "__main__":
    unittest.main()
