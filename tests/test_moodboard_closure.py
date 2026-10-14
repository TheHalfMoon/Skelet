"""AC-00-i moodboard dependency-closure inventory conformance tests.

Validates the committed imports/craft-suite/moodboard-closure.json
statically (no network): frozen pin, file inventory, per-file import
classification, exclusion of SmartSearchBar, and capability flags that
any future transplant grain must resolve. Regenerating the inventory
requires scripts/audit_moodboard_closure.py against the pinned commit.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLOSURE_PATH = ROOT / "imports" / "craft-suite" / "moodboard-closure.json"
MANIFEST_PATH = ROOT / "imports" / "craft-suite" / "manifest.json"

GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PINNED_COMMIT = "28a39a0de4a2fc2eccc237df2046c24245bd12ab"
SMART_SEARCH = "frontend/libs/components/moodboard/src/lib/grid/SmartSearchBar.tsx"

EXPECTED_EXTERNAL = {
    "konva",
    "lucide-react",
    "react-colorful",
    "react-hot-toast",
    "react-konva",
    "uuid",
    "vitest",
    "zustand",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class MoodboardClosureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.closure = load_json(CLOSURE_PATH)
        cls.by_path = {entry["path"]: entry for entry in cls.closure["files"]}

    def test_frozen_pin_and_file_count(self) -> None:
        self.assertEqual(self.closure["schema_version"], "1")
        self.assertEqual(self.closure["grain"], "AC-00-i")
        self.assertEqual(self.closure["donor"], "artcraft")
        self.assertEqual(self.closure["pinned_commit"], PINNED_COMMIT)
        self.assertTrue(GIT_SHA_RE.match(PINNED_COMMIT))
        self.assertEqual(self.closure["file_count"], 70)
        self.assertEqual(len(self.closure["files"]), 70)

    def test_every_file_has_verified_sha_and_imports(self) -> None:
        for entry in self.closure["files"]:
            with self.subTest(path=entry["path"]):
                self.assertTrue(GIT_SHA_RE.match(entry["sha"]), "git blob SHA required")
                self.assertGreater(entry["size"], 0)
                self.assertIn("imports", entry)
                self.assertIn("flags", entry)
                for group in ("relative", "alias", "external", "runtime"):
                    self.assertIsInstance(entry["imports"][group], list)
                    self.assertEqual(sorted(entry["imports"][group]), entry["imports"][group])

    def test_external_package_surface_is_frozen(self) -> None:
        self.assertEqual(set(self.closure["external_packages"]), EXPECTED_EXTERNAL)
        self.assertEqual(sorted(self.closure["external_packages"]), self.closure["external_packages"])

    def test_no_css_wasm_tauri_or_worker_payloads(self) -> None:
        for entry in self.closure["files"]:
            with self.subTest(path=entry["path"]):
                for flag in ("css_import", "wasm", "tauri", "worker"):
                    self.assertFalse(entry["flags"][flag], f"{flag} must be absent")

    def test_smart_search_bar_is_listed_but_excluded(self) -> None:
        entry = self.by_path[SMART_SEARCH]
        self.assertTrue(entry["excluded"])
        included = [path for path, item in self.by_path.items() if not item["excluded"]]
        self.assertEqual(len(included), 69)
        self.assertNotIn(SMART_SEARCH, included)

    def test_manifest_exclude_prefixes_cover_smart_search(self) -> None:
        manifest = load_json(MANIFEST_PATH)
        board = manifest["import_manifests"]["P12-reference-board-core"]
        excludes = board["exclude_prefixes"]
        self.assertTrue(
            any("SmartSearchBar" in prefix for prefix in excludes),
            "manifest must keep rejecting SmartSearchBar",
        )

    def test_cloud_sync_paths_are_flagged_for_replacement(self) -> None:
        flagged = {
            path
            for path, entry in self.by_path.items()
            if entry["flags"]["network_fetch"] or entry["flags"]["storage"]
        }
        self.assertIn("frontend/libs/components/moodboard/src/lib/adapter.ts", flagged)
        self.assertIn(
            "frontend/libs/components/moodboard/src/lib/persistence/moodboardSync.ts", flagged
        )
        self.assertGreater(len(flagged), 0)

    def test_alias_imports_require_skelet_mapping(self) -> None:
        alias_users = [
            path for path, entry in self.by_path.items() if entry["imports"]["alias"]
        ]
        self.assertEqual(len(alias_users), 11)
        total_specs = sum(len(self.by_path[path]["imports"]["alias"]) for path in alias_users)
        self.assertEqual(total_specs, 20)
        for path in alias_users:
            with self.subTest(path=path):
                self.assertTrue(
                    all(spec.startswith("@storyteller/") for spec in self.by_path[path]["imports"]["alias"])
                )


if __name__ == "__main__":
    unittest.main()
