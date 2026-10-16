"""Release-candidate document completeness tests.

Machine-checks `docs/operations/RELEASE_CANDIDATE.md` offline: the RC
format decision, the version proposal without a premature tag claim,
the builder + digest procedure, the archive exclusion control, the
SBOM/provenance pointers, the license gap with its owner decision, and
the no-publication rule.
"""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "operations" / "RELEASE_CANDIDATE.md"
BUILDER_PATH = ROOT / "scripts" / "build_release_candidate.mjs"


class ReleaseCandidateDocTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.builder = BUILDER_PATH.read_text(encoding="utf-8")

    def test_format_and_version_proposal(self) -> None:
        for token in ("reproducible source release", "v1.0.0-local-rc.1",
                      "proposal only", "no git tag is created until OD-03"):
            self.assertIn(token, self.doc, msg=f"doc missing: {token}")

    def test_build_and_digest_procedure(self) -> None:
        for token in ("build_release_candidate.mjs", "manifest.json",
                      "SHA256SUMS", "sha256sum -c"):
            self.assertIn(token, self.doc, msg=f"doc missing: {token}")
        for token in ("git archive", "manifest.json", "SHA256SUMS"):
            self.assertIn(token, self.builder, msg=f"builder missing: {token}")

    def test_exclusion_control(self) -> None:
        for token in (".env", "credentials.json", "node_modules/",
                      ".ignore", "256 MB", "sbom.json"):
            self.assertIn(token, self.doc, msg=f"doc missing: {token}")
        self.assertIn("FORBIDDEN_SEGMENTS", self.builder)

    def test_license_resolution_with_owner_decision(self) -> None:
        for token in ("OD-05", "OD-05 (license, RESOLVED)",
                      "root `LICENSE`", "root `NOTICE`",
                      "no blocking conflict"):
            self.assertIn(token, self.doc, msg=f"doc missing: {token}")
        self.assertNotIn("no root `LICENSE` file and no consolidated `NOTICE` file exist",
                         self.doc, msg="doc still claims the OD-05 gap")

    def test_signing_and_publication_gates(self) -> None:
        for token in ("OD-02", "explicitly unsigned", "OD-03",
                      "nothing is published"):
            self.assertIn(token, self.doc, msg=f"doc missing: {token}")

    def test_no_final_release_claim(self) -> None:
        self.assertNotRegex(self.doc, r"(?i)final release.*(shipped|published|complete)")


if __name__ == "__main__":
    unittest.main()
