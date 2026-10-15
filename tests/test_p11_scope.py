"""P11 scope disposition conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/P11_SCOPE_DISPOSITION.md directly from repo
sources (similarity baseline + implementation plan + blueprint),
offline. The lexical baseline must exist with full-kinds coverage on
the agent contract; the embedding future must resolve to explicit
opt-in plan language; no vector migration may exist unannounced.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "P11_SCOPE_DISPOSITION.md"
PLAN_PATH = ROOT / "docs" / "IMPLEMENTATION_PLAN.md"
BLUEPRINT_PATH = ROOT / "docs" / "architecture" / "AGENT_FIRST_ZERO_FOUNDER_COST_BLUEPRINT_2026-10-11.md"
SIMILARITY_PATH = ROOT / "packages" / "assets" / "src" / "similarity.ts"
GRAPH_PATH = ROOT / "packages" / "db" / "src" / "graph.ts"
MCP_PATH = ROOT / "apps" / "web" / "lib" / "mcp.ts"
MIGRATIONS_DIR = ROOT / "packages" / "db" / "migrations"


class P11ScopeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.plan = PLAN_PATH.read_text(encoding="utf-8")
        cls.blueprint = BLUEPRINT_PATH.read_text(encoding="utf-8")
        cls.similarity = SIMILARITY_PATH.read_text(encoding="utf-8")
        cls.mcp = MCP_PATH.read_text(encoding="utf-8")

    def test_lexical_baseline_covers_all_kinds_on_the_contract(self) -> None:
        self.assertIn("[...ARTIFACT_KINDS]", self.similarity)
        graph = GRAPH_PATH.read_text(encoding="utf-8")
        for kind in (
            "screen", "page", "section", "component", "icon", "logo",
            "font", "illustration", "resource", "brief", "design",
        ):
            self.assertIn(f'"{kind}"', graph)
        self.assertIn("jaccardSimilarity", self.similarity)
        self.assertIn('name: "find_similar"', self.mcp)
        for token in ("lexical baseline", "All 11", "`find_similar`"):
            self.assertIn(token, self.doc)

    def test_plan_and_blueprint_authorize_the_opt_in_future(self) -> None:
        self.assertIn("future opt-in enhancement", self.plan)
        self.assertIn("never falsely advertise", self.plan.lower())
        self.assertIn("mandatory semantic embeddings are not required", self.blueprint.lower())
        self.assertIn("no mandatory pgvector population or gpu", self.blueprint.lower())
        for token in ("opt-in", "24.2"):
            self.assertIn(token, self.doc)

    def test_no_vector_migration_exists_unannounced(self) -> None:
        vector = [
            path.name
            for path in MIGRATIONS_DIR.glob("*.sql")
            if "vector" in path.name.lower() or "pgvector" in path.name.lower()
        ]
        self.assertEqual(vector, [], "a vector migration would contradict the disposition")
        self.assertIn("No pgvector migration exists", self.doc)

    def test_every_deferred_item_has_a_trigger(self) -> None:
        lowered = self.doc.lower()
        for item in ("semantic text embeddings", "visual/perceptual embeddings", "hybrid ranker", "human-judged relevance"):
            self.assertIn(item, lowered)
        self.assertIn("Trigger to re-evaluate", self.doc)


if __name__ == "__main__":
    unittest.main()
