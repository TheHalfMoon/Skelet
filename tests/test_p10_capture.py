"""P10 live capture disposition conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/P10_CAPTURE_DISPOSITION.md directly from repo
sources (replay ledger + web dependency tree + implementation plan),
offline. The rrweb-compatible representation must exist with
redaction/budgets on the agent contract; the live capture client must
resolve to an explicit absence (no dependency, no recorder call);
the plan must name the rrweb representation deliverable.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "P10_CAPTURE_DISPOSITION.md"
PLAN_PATH = ROOT / "docs" / "IMPLEMENTATION_PLAN.md"
REPLAY_PATH = ROOT / "packages" / "db" / "src" / "replay.ts"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"
WEB_PKG_PATH = ROOT / "apps" / "web" / "package.json"


class P10CaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.plan = PLAN_PATH.read_text(encoding="utf-8")
        cls.replay = REPLAY_PATH.read_text(encoding="utf-8")
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")
        cls.web_pkg = json.loads(WEB_PKG_PATH.read_text(encoding="utf-8"))

    def test_representation_ledger_exists_with_redaction_budgets(self) -> None:
        for token in ("rrweb", "REPLAY_EVENT_TYPES", "MAX_EVENTS_PER_SESSION",
                      "MAX_BYTES_PER_SESSION"):
            self.assertIn(token, self.replay)
        for verb in ("replay_open_session", "replay_record_events",
                     "replay_close_session", "replay_get_events"):
            self.assertIn(verb, self.mcp)
        for token in ("rrweb-compatible", "redaction", "budgets"):
            self.assertIn(token, self.doc)

    def test_no_live_capture_client_in_tree(self) -> None:
        deps = self.web_pkg.get("dependencies", {})
        dev_deps = self.web_pkg.get("devDependencies", {})
        self.assertNotIn("rrweb", deps)
        self.assertNotIn("rrweb", dev_deps)
        for probe in (ROOT / "apps" / "web" / "app",
                      ROOT / "apps" / "web" / "lib"):
            for path in probe.rglob("*.tsx"):
                text = path.read_text(encoding="utf-8")
                self.assertNotIn("from \"rrweb\"", text)
                self.assertNotIn("from 'rrweb'", text)
            for path in probe.rglob("*.ts"):
                if path.name.endswith(".test.ts"):
                    continue
                text = path.read_text(encoding="utf-8")
                self.assertNotIn("from \"rrweb\"", text)
                self.assertNotIn("from 'rrweb'", text)

    def test_plan_names_rrweb_representation(self) -> None:
        self.assertIn("rrweb representation for newly captured web flows", self.plan)
        self.assertIn("rrweb: compact web-flow recording/replay", self.plan)
        for token in ("Trigger to re-evaluate", "consent", "redaction proof",
                      "round-trip"):
            self.assertIn(token, self.doc)


if __name__ == "__main__":
    unittest.main()
