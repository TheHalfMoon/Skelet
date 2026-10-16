"""P10 normalization-note conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/P10_NORMALIZATION_NOTE.md directly from repo
sources (taxonomy/flows model + mobbin-mcp lock entry + plan lines),
offline. The Skilit-owned normalization vehicle must exist on the
agent contract; the Mobbin reference must resolve to an unpinned,
unimported, reference-only lock entry; no Mobbin code dependency may
exist in product paths.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "P10_NORMALIZATION_NOTE.md"
PLAN_PATH = ROOT / "docs" / "IMPLEMENTATION_PLAN.md"
LOCK_PATH = ROOT / "UPSTREAMS.lock.yml"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"


def _mobbin_entry() -> dict:
    lock = yaml.safe_load(LOCK_PATH.read_text(encoding="utf-8"))
    sources = lock.get("sources", lock if isinstance(lock, dict) else [])
    if isinstance(sources, dict):
        sources = list(sources.values())
    for entry in sources:
        if isinstance(entry, dict) and entry.get("id") == "mobbin-mcp":
            return entry
    raise AssertionError("mobbin-mcp lock entry is missing")


class P10NormalizationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.plan = PLAN_PATH.read_text(encoding="utf-8")
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")

    def test_normalization_vehicle_on_the_contract(self) -> None:
        for tool in ("list_flows", "get_flow_steps", "list_patterns",
                     "get_pattern", "list_products", "list_product_versions"):
            self.assertIn(tool, self.mcp)
        for token in ("Flow`/`FlowStep`/`Artifact`", "corpus importer",
                      "pattern taxonomy", "`skelet://`"):  # Historical note retains original URI scheme bytes.
            self.assertIn(token, self.doc)

    def test_mobbin_reference_only_never_imported(self) -> None:
        entry = _mobbin_entry()
        self.assertEqual(entry.get("role"), "reference")
        self.assertEqual(entry.get("status"), "planned")
        self.assertIsNone(entry.get("exact_commit_or_release"))
        self.assertEqual(entry.get("imported_paths"), [])
        for probe in (ROOT / "packages", ROOT / "apps", ROOT / "scripts"):
            for path in probe.rglob("*.ts"):
                if "node_modules" in path.parts:
                    continue
                text = path.read_text(encoding="utf-8")
                self.assertNotIn("mobbin", text.lower())
        for path in (ROOT / "packages").rglob("package.json"):
            if "node_modules" in path.parts:
                continue
            self.assertNotIn("mobbin", path.read_text(encoding="utf-8").lower())

    def test_plan_lines_authorize_the_reading(self) -> None:
        self.assertIn("without a runtime dependency on Mobbin services", self.plan)
        self.assertIn("Do not optimize for Mobbin feature parity", self.plan)
        for token in ("Screen gallery wording", "not a launch requirement",
                      "Trigger to re-evaluate"):
            self.assertIn(token, self.doc)


if __name__ == "__main__":
    unittest.main()
