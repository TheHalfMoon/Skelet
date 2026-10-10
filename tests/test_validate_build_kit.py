"""Fixture tests for the frozen P09b Build Kit manifest contract."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from scripts.validate_build_kit import validate_manifest

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "fixtures" / "build-kit" / "manifest.valid.json"


def load() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


class BuildKitContractTest(unittest.TestCase):
    def test_valid_fixture_passes(self) -> None:
        self.assertEqual(validate_manifest(load()), [])

    def test_schema_file_is_valid_json(self) -> None:
        schema = json.loads((ROOT / "schemas" / "lens-build-kit.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["properties"]["schema_version"], {"const": "skelet.lens.build-kit.v1"})

    def test_rejects(self) -> None:
        cases = []
        bad = load()
        bad["schema_version"] = "skelet.lens.build-kit.v2"
        cases.append(bad)
        bad = load()
        bad["status"] = "done"
        cases.append(bad)
        bad = load()
        bad["lens_report"]["analysis_id"] = "0" * 64
        cases.append(bad)
        bad = load()
        bad["capture_scope"]["max_pages"] = 26
        cases.append(bad)
        bad = load()
        bad["pages"] = []
        cases.append(bad)
        bad = load()
        bad["pages"][0]["url"] = "http://example.org/"
        cases.append(bad)
        bad = load()
        bad["artifacts"] = [a for a in bad["artifacts"] if a["path"] != "AGENT.md"]
        cases.append(bad)
        bad = load()
        bad["artifacts"][0]["path"] = "../evil.json"
        cases.append(bad)
        bad = load()
        bad["artifacts"][0]["path"] = "/abs/evil.json"
        cases.append(bad)
        bad = load()
        bad["artifacts"][1]["kind"] = "manifest"
        cases.append(bad)
        bad = load()
        bad["artifacts"][-1]["rights"] = {"classification": "unknown", "redistributable": True}
        cases.append(bad)
        bad = load()
        bad["artifacts"][-1]["rights"] = {"classification": "restricted", "redistributable": True}
        cases.append(bad)
        bad = load()
        bad["provenance"]["heuristic"] = ["guess"]
        cases.append(bad)
        bad = load()
        bad["provenance"]["generated_label"] = "official-clone"
        cases.append(bad)
        bad = load()
        bad["rights_policy"]["default_classification"] = "permitted"
        cases.append(bad)
        bad = load()
        bad["artifacts"][0]["path"] = "starter/../../evil.tsx"
        cases.append(bad)
        for i, case in enumerate(cases):
            with self.subTest(i=i):
                self.assertTrue(validate_manifest(case), f"case {i} must fail")

    def test_non_object_fails(self) -> None:
        self.assertTrue(validate_manifest([]))
        self.assertTrue(validate_manifest(None))
        bad = load()
        bad["pages"] = [{"url": "https://example.org/", "sha256": "x", "viewport": "desktop", "section_refs": []}]
        self.assertTrue(validate_manifest(bad))


if __name__ == "__main__":
    unittest.main()
