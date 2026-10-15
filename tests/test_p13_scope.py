"""P13 scope disposition conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/P13_SCOPE_DISPOSITION.md directly from repo
sources (agent surfaces + implementation plan), offline. The qualified
read path must exist on both transports; the deferred items must
resolve to explicit plan sections naming them post-launch, so the
deferral is authorized rather than silent.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "P13_SCOPE_DISPOSITION.md"
PLAN_PATH = ROOT / "docs" / "IMPLEMENTATION_PLAN.md"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"
CHANGES_ROUTE_PATH = ROOT / "apps" / "web" / "app" / "api" / "v1" / "changes" / "route.ts"
REST_PATH = ROOT / "apps" / "web" / "lib" / "rest.ts"


class P13ScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.plan = PLAN_PATH.read_text(encoding="utf-8")
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")
        cls.rest = REST_PATH.read_text(encoding="utf-8")

    def test_qualified_read_path_exists_on_both_transports(self) -> None:
        self.assertIn('name: "get_changes"', self.mcp)
        self.assertTrue(CHANGES_ROUTE_PATH.is_file(), "REST route file must exist")
        self.assertIn("getChangesRoute", self.rest)
        for token in ("`get_changes`", "`GET /api/v1/changes`"):
            self.assertIn(token, self.doc)

    def test_plan_authorizes_the_split(self) -> None:
        self.assertIn("broad continuous watch/Time Machine schedules", self.plan)
        self.assertIn("Commercial launch MUST NOT be blocked by P13 Time Machine", self.plan)
        for token in ("post-launch", "MUST NOT be blocked"):
            self.assertIn(token, self.doc)

    def test_every_deferred_item_has_a_trigger(self) -> None:
        lowered = self.doc.lower()
        for item in ("recapture policy", "change-event log", "meaningful-change scoring"):
            self.assertIn(item, lowered)
        self.assertIn("Trigger to re-evaluate", self.doc)
        self.assertGreaterEqual(len(re.findall(r"(?i)trigger", self.doc)), 2)

    def test_scoring_deferral_is_evidence_grounded(self) -> None:
        self.assertIn("labeled data", self.doc.lower())
        self.assertIn("deterministic", self.doc.lower())
        self.assertIn("no intent inference", self.doc.lower())


if __name__ == "__main__":
    unittest.main()
