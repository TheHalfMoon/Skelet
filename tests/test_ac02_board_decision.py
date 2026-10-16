"""AC-02 reference-board adopt-vs-keep decision conformance tests.

Machine-checks every static fact cited in
docs/qualification/AC-02_BOARD_DECISION.md directly from repo sources
(Skilit board surfaces + AC-00-i closure JSON), offline. Donor-side
figures come from the SHA-verified moodboard closure; Skilit-side
figures from migrations, route files, tool schemas, package manifests,
and test sources. The keep verdict and both revisit triggers are
asserted verbatim so the decision cannot drift from its evidence.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "AC-02_BOARD_DECISION.md"
CLOSURE_PATH = ROOT / "imports" / "craft-suite" / "moodboard-closure.json"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"
WEB_PKG_PATH = ROOT / "apps" / "web" / "package.json"
MIGRATION_014 = ROOT / "packages" / "db" / "migrations" / "014_collection_item_order.up.sql"
MIGRATION_015 = ROOT / "packages" / "db" / "migrations" / "015_collection_handoffs.up.sql"
BOARDS_UI_TEST = ROOT / "apps" / "web" / "tests" / "boards-ui.test.mjs"

EXPECTED_EXTERNALS = [
    "konva",
    "lucide-react",
    "react-colorful",
    "react-hot-toast",
    "react-konva",
    "uuid",
    "vitest",
    "zustand",
]
EXPECTED_TOOLS = ("board_handoff", "board_list_handoffs", "board_validate_items")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class Ac02DecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.closure = load_json(CLOSURE_PATH)
        cls.files = cls.closure["files"]
        cls.by_path = {entry["path"]: entry for entry in cls.files}
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")

    def test_donor_inventory_figures_match_closure(self) -> None:
        self.assertEqual(self.closure["file_count"], 70)
        self.assertEqual(len(self.files), 70)
        self.assertEqual(self.closure["external_packages"], EXPECTED_EXTERNALS)
        for token in ("70 files", "8 (`konva`"):
            self.assertIn(token, self.doc)

    def test_donor_sync_core_is_flagged_for_replacement(self) -> None:
        flagged = {
            path
            for path, entry in self.by_path.items()
            if entry["flags"]["network_fetch"] or entry["flags"]["storage"]
        }
        self.assertEqual(
            flagged,
            {
                "frontend/libs/components/moodboard/src/lib/adapter.ts",
                "frontend/libs/components/moodboard/src/lib/boards/BoardLibraryStore.ts",
                "frontend/libs/components/moodboard/src/lib/boards/boardTypes.ts",
                "frontend/libs/components/moodboard/src/lib/persistence/canvasBridge.ts",
                "frontend/libs/components/moodboard/src/lib/persistence/moodboardSync.ts",
            },
        )
        self.assertIn("moodboardSync", self.doc)

    def test_donor_canvas_grid_and_keybind_figures(self) -> None:
        paths = list(self.by_path)
        canvas = [p for p in paths if "/canvas/" in p]
        grid = [p for p in paths if "/grid/" in p]
        self.assertEqual(len(canvas), 38)
        self.assertEqual(len(grid), 15)
        self.assertTrue(any("BoardGridView" in p for p in grid))
        self.assertTrue(any("PresentationView" in p for p in grid))
        self.assertTrue(any("eybind" in p for p in paths), "donor keyboard support must exist to claim parity")
        self.assertTrue(any("napping" in p for p in paths))
        for token in ("38-file", "15-file", "BoardGridView", "useMoodboardKeybinds"):
            self.assertIn(token, self.doc)

    def test_donor_has_no_handoff_or_rights_paths(self) -> None:
        paths = list(self.by_path)
        self.assertEqual([p for p in paths if "handoff" in p.lower()], [])
        self.assertEqual([p for p in paths if "right" in p.lower() or "provenance" in p.lower()], [])
        self.assertIn("no handoff path in inventory", self.doc)
        self.assertIn("no rights/provenance path in inventory", self.doc)

    def test_skilit_surfaces_match_sources(self) -> None:
        routes = sorted(
            str(p) for p in (ROOT / "apps" / "web" / "app").rglob("route.ts") if "/boards" in str(p).replace("\\", "/")
        )
        self.assertEqual(len(routes), 8)
        page = ROOT / "apps" / "web" / "app" / "boards" / "page.tsx"
        self.assertTrue(page.is_file())
        for tool in EXPECTED_TOOLS:
            self.assertIn(f'name: "{tool}"', self.mcp)
        self.assertIn("014_collection_item_order", MIGRATION_014.name)
        self.assertIn("dense", MIGRATION_014.read_text(encoding="utf-8"))
        self.assertIn("collection_handoffs", MIGRATION_015.read_text(encoding="utf-8"))
        for token in ("8 REST routes", "3 MCP tools", "014", "015"):
            self.assertIn(token, self.doc)

    def test_skilit_adds_no_canvas_dependencies(self) -> None:
        pkg = load_json(WEB_PKG_PATH)
        deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
        for banned in ("konva", "react-konva", "zustand"):
            self.assertNotIn(banned, deps)
        self.assertIn("0 new", self.doc)

    def test_keyboard_parity_and_virtualization_gap_are_honest(self) -> None:
        ui_test = BOARDS_UI_TEST.read_text(encoding="utf-8")
        self.assertIn("keyboard", ui_test.lower(), "Skilit keyboard coverage must exist to claim parity")
        self.assertNotIn("virtual", ui_test.lower(), "Skilit virtualization must stay unclaimed")
        self.assertIn("parity, not a differentiator", self.doc)
        self.assertIn("sole donor lead", self.doc)

    def test_verdict_is_keep_with_revisit_triggers(self) -> None:
        # Historical decision record retains original project bytes.
        self.assertIn("KEEP Skelet-owned", self.doc)
        self.assertIn("adopt nothing", self.doc.lower())
        self.assertIn("Revisit triggers", self.doc)
        self.assertIn("narrow grid-only transplant", self.doc)
        self.assertIn("freeform canvas", self.doc.lower())


if __name__ == "__main__":
    unittest.main()
