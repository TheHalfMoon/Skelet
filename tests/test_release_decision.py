"""Release-decision record conformance tests.

Machine-checks `docs/qualification/V1_LOCAL_RELEASE_DECISION.md`
offline: all 15 mandated fields present, CONDITIONAL (never final) GO,
original coverage preserved, no published digest, signing unsigned,
#62 open-pending-OD-03, all five owner decisions named, no Windows
claim, and runtime-identity with RERUN_4 code.
"""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "V1_LOCAL_RELEASE_DECISION.md"


class ReleaseDecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")

    def test_candidate_and_base(self) -> None:
        for token in ("v1.0.0-local-rc.1", "d49ceb8", "0.1.0",
                      "no git tag exists or is created here"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_platforms_and_install(self) -> None:
        for token in ("ubuntu-24.04", "Windows is NOT claimed",
                      "storage-windows-latest", "CLEAN_INSTALL.md",
                      "build_release_candidate.mjs"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_supported_absent_split(self) -> None:
        for token in ("Features intentionally absent", "Live browser recording",
                      "CLOUD_COMMERCIAL_BACKLOG.md", "CB-01"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_qualification_pointer(self) -> None:
        for token in ("AF-12_FINAL_RERUN_4.md", "CLEAN_INSTALL_PROOF.md",
                      "byte-identical", "70da1ba", "PRs #142"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_ux_audit_present(self) -> None:
        for token in ("aria-live", "SMOKE_OK", "STARTER_CONSUMER_OK",
                      "REGISTRY_INSTALL_PROOF_OK", "coming soon",
                      "replay-only honesty"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_security_and_dependencies(self) -> None:
        for token in ("Zero unresolved blocking findings", "AF-14c",
                      "braces 3.0.3", "accepted risk", "380 components",
                      "DEPENDENCY_SCAN.md"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_hashes_signing_and_62(self) -> None:
        for token in ("No release digest is published", "Never reuse a digest across commits",
                      "explicitly UNSIGNED", "OD-02",
                      "ISSUE_62_CLOSEOUT_REPORT.md", "is OPEN"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_all_five_owner_decisions(self) -> None:
        for token in ("OD-01", "OD-02", "OD-03", "OD-04", "OD-05"):
            self.assertIn(token, self.doc, msg=f"decision missing: {token}")

    def test_conditional_go_not_final(self) -> None:
        self.assertIn("CONDITIONAL GO", self.doc)
        self.assertIn("14/25 VERIFIED = 56.0%", self.doc)
        self.assertNotRegex(self.doc, r"(?i)final recommendation: GO[^_]")


if __name__ == "__main__":
    unittest.main()
