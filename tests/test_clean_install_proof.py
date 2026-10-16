"""Clean-install proof conformance tests.

Machine-checks the procedure (`docs/operations/CLEAN_INSTALL.md`) and
its measured proof (`docs/qualification/CLEAN_INSTALL_PROOF.md`)
directly from repo sources, offline. Guards against claiming an
unexecuted install: every one of the 15 mandate steps must be present
with a measured PASS pointer, the proof must bind to the release
candidate, the platform boundary must be honest (no Windows install
claim), and cleanup must be recorded.
"""

from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROC_PATH = ROOT / "docs" / "operations" / "CLEAN_INSTALL.md"
PROOF_PATH = ROOT / "docs" / "qualification" / "CLEAN_INSTALL_PROOF.md"

RC_SHORT = "9d73f79"


class CleanInstallProofTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.proc = PROC_PATH.read_text(encoding="utf-8")
        cls.proof = PROOF_PATH.read_text(encoding="utf-8")

    def test_procedure_covers_all_15_steps(self) -> None:
        for token in ("Isolate", "Record OS + versions",
                      "PostgreSQL probe", "Storage config", "Env:",
                      "Clean dependency installation", "Validators",
                      "Database setup + migrations", "Real PostgreSQL suites",
                      "Worker startup + health", "No-model gate",
                      "Web production build + startup + health",
                      "Research workflow", "Agent workflow",
                      "Graceful shutdown/restart"):
            self.assertIn(token, self.proc, msg=f"procedure missing: {token}")

    def test_proof_binds_to_rc_and_reports_zero_failures(self) -> None:
        self.assertIn(RC_SHORT, self.proof)
        self.assertIn("detached HEAD", self.proof)
        self.assertIn("Zero failures", self.proof)
        for token in ("SMOKE_OK", "STARTER_CONSUMER_OK",
                      "REGISTRY_INSTALL_PROOF_OK", "NO_MODEL_GATE_PASSED",
                      "15/15", "verified: true"):
            self.assertIn(token, self.proof, msg=f"proof missing: {token}")

    def test_frozen_install_and_versions_recorded(self) -> None:
        for token in ("pnpm install --frozen-lockfile", "9.12.0",
                      "v26.0.0", "17.9", "macOS 26.6.2"):
            self.assertIn(token, self.proof, msg=f"proof missing: {token}")

    def test_platform_boundary_honest(self) -> None:
        self.assertIn("no claim", self.proof)
        self.assertIn("storage-windows-latest", self.proof)
        self.assertNotRegex(self.proof, r"(?i)windows.*clean.install.*(pass|ok|verified)")

    def test_signing_not_misrepresented(self) -> None:
        self.assertIn("never a release identity", self.proof)

    def test_cleanup_recorded(self) -> None:
        self.assertIn("worktree remove", self.proof)
        self.assertIn("canonical tree untouched", self.proof)
        self.assertIn(".ignore", self.proof)


if __name__ == "__main__":
    unittest.main()
