"""AC-01 video-frame adopt-vs-keep decision conformance tests.

Machine-checks every Tier-1 static fact cited in
docs/qualification/AC-01_VIDEO_FRAME_DECISION.md directly from repo
sources (Skelet engine + AC-00-ii closure JSON), offline. Tier-2 facts
(donor timeout constants, error-kind names, PNG egress) were observed
at audit time from the SHA-verified blob; this file pins those observed
values and asserts the decision cites them verbatim, while
test_frame_extractor_closure.py proves the read blob is the pinned one
(SHA agreement with donor-pins). A donor pin change therefore forces a
re-audit instead of silently rotting the decision.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "AC-01_VIDEO_FRAME_DECISION.md"
ENGINE_PATH = ROOT / "packages" / "lens" / "src" / "video-frame-evidence.ts"
JPEG_PATH = ROOT / "packages" / "lens" / "src" / "jpeg-evidence.ts"
CLOSURE_PATH = ROOT / "imports" / "craft-suite" / "frame-extractor-closure.json"

PINNED_COMMIT = "02a3de2509662cfc7c12f51c09e7f4322618029a"
EXTRACT_FRAMES = "frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/extract-frames.ts"

# Tier-2 observed values, read at audit time from the blob whose SHA the
# AC-00-ii closure verifies against donor-pins. Must match the decision doc.
OBSERVED_TIMEOUTS = {"5000": "metadata", "3000": "seek", "300": "paint wait"}
OBSERVED_ERROR_KINDS = ("cors", "timeout", "decode", "aborted")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class Ac01DecisionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.engine = ENGINE_PATH.read_text(encoding="utf-8")
        cls.jpeg = JPEG_PATH.read_text(encoding="utf-8")
        cls.closure = load_json(CLOSURE_PATH)
        cls.by_path = {entry["path"]: entry for entry in cls.closure["files"]}

    def test_skelet_budgets_match_engine_and_decision(self) -> None:
        budgets = dict(re.findall(r"(max\w+):\s*([\d_]+)", self.engine))
        expected = {
            "maxFrames": "64",
            "maxSide": "4096",
            "maxPixels": "16_000_000",
            "maxFps": "120",
            "maxDurationMs": "600_000",
            "maxFrameBytes": "8_388_608",
        }
        self.assertEqual(budgets, expected)
        for raw in ("64", "4096", "16 Mpx", "120", "600 s", "8 MiB"):
            self.assertIn(raw, self.doc, f"decision must cite budget {raw}")

    def test_skelet_engine_is_dependency_free(self) -> None:
        imports = re.findall(r"""from\s+['"]([^'"]+)['"]""", self.engine)
        self.assertEqual(sorted(set(imports)), ["./jpeg-evidence.ts", "node:crypto"])
        self.assertIn("node:crypto", self.doc)

    def test_skelet_error_taxonomy_cited(self) -> None:
        for code in ("invalid-spec", "over-budget", "corrupt-frame"):
            self.assertIn(code, self.engine)
            self.assertIn(code, self.doc)

    def test_skelet_ingress_is_jpeg_only(self) -> None:
        self.assertIn("0xd8", self.jpeg, "JPEG SOI marker check must exist")
        combined = self.engine + self.jpeg
        self.assertNotIn("png", combined.lower(), "no PNG path may exist in the Skelet ingress")
        self.assertIn("JPEG-only", self.doc)

    def test_donor_candidate_facts_come_from_verified_closure(self) -> None:
        entry = self.by_path[EXTRACT_FRAMES]
        self.assertFalse(entry["excluded"])
        self.assertEqual(entry["size"], 8091)
        for group in ("relative", "alias", "external", "runtime"):
            self.assertEqual(entry["imports"][group], [], "candidate must stay dependency-free")
        self.assertTrue(entry["flags"]["media_api"])
        self.assertIn("8091", self.doc)
        self.assertIn("zero-import", self.doc)

    def test_donor_observed_values_are_cited_with_pin_traceability(self) -> None:
        self.assertIn("02a3de2", self.doc, "decision must cite the verified pin")
        self.assertEqual(self.closure["pinned_commit"], PINNED_COMMIT)
        for value in (*OBSERVED_TIMEOUTS, *OBSERVED_ERROR_KINDS, "image/png"):
            self.assertIn(value, self.doc, f"decision must cite observed value {value}")

    def test_verdict_is_keep_with_revisit_trigger(self) -> None:
        self.assertIn("KEEP Skelet-owned", self.doc)
        self.assertIn("adopt nothing", self.doc.lower())
        self.assertIn("Revisit trigger", self.doc)
        self.assertIn("PNG frame ingress", self.doc)


if __name__ == "__main__":
    unittest.main()
