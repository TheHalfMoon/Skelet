"""P12 MCP Apps views disposition conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/P12_APPS_DISPOSITION.md directly from repo
sources (dependency manifest + MCP dispatch + plan + blueprint),
offline. Apps views must be absent by explicit design (no SDK,
unsupported methods degrade to -32601 with REST fallback), while the
qualified core (boards, packs, gallery, parity) must exist — so the
deferral is scoped, not silent.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "P12_APPS_DISPOSITION.md"
WEB_PKG_PATH = ROOT / "apps" / "web" / "package.json"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class P12AppsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")

    def test_no_apps_sdk_in_the_dependency_tree(self) -> None:
        pkg = load_json(WEB_PKG_PATH)
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        self.assertFalse(any("modelcontextprotocol" in name for name in deps))
        self.assertNotIn("ui://", self.mcp, "no Apps resource surface may exist unannounced")
        self.assertIn("no MCP SDK", self.doc)

    def test_qualified_core_exists_without_apps(self) -> None:
        for tool in ("board_handoff", "create_reference_pack", "list_products", "get_changes", "list_flows"):
            self.assertIn(f'name: "{tool}"', self.mcp)
        self.assertIn("agent parity without Apps", self.doc)

    def test_plan_and_blueprint_authorize_progressive_enhancement(self) -> None:
        plan = (ROOT / "docs" / "IMPLEMENTATION_PLAN.md").read_text(encoding="utf-8")
        self.assertIn("Never assume MCP Apps or Tasks exist in every client", plan)
        blueprint = (ROOT / "docs" / "architecture" / "AGENT_FIRST_ZERO_FOUNDER_COST_BLUEPRINT_2026-10-11.md").read_text(
            encoding="utf-8"
        )
        self.assertIn("progressive enhancement", blueprint.lower())
        for token in ("progressive enhancement", "23.3"):
            self.assertIn(token, self.doc)

    def test_deferral_has_a_trigger(self) -> None:
        self.assertIn("Trigger to re-evaluate", self.doc)
        self.assertIn("sandbox", self.doc.lower())
        self.assertIn("-32601", self.doc)
        self.assertIn("DEFERRED", self.doc.upper())


if __name__ == "__main__":
    unittest.main()
