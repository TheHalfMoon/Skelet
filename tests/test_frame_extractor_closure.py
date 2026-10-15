"""AC-00-ii frame-extractor dependency-closure inventory conformance tests.

Validates the committed imports/craft-suite/frame-extractor-closure.json
statically (no network): frozen pin, file inventory, per-file import
classification, exclusion of frame-actions.ts, and capability flags that
any future transplant grain must resolve. Regenerating the inventory
requires scripts/audit_frame_extractor_closure.py against the pinned commit.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLOSURE_PATH = ROOT / "imports" / "craft-suite" / "frame-extractor-closure.json"
MANIFEST_PATH = ROOT / "imports" / "craft-suite" / "manifest.json"
DONOR_PINS_PATH = ROOT / "imports" / "craft-suite" / "donor-pins.json"

GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PINNED_COMMIT = "02a3de2509662cfc7c12f51c09e7f4322618029a"
EXTRACT_FRAMES = "frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/extract-frames.ts"
FRAME_ACTIONS = "frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/frame-actions.ts"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class FrameExtractorClosureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.closure = load_json(CLOSURE_PATH)
        cls.by_path = {entry["path"]: entry for entry in cls.closure["files"]}

    def test_frozen_pin_and_file_count(self) -> None:
        self.assertEqual(self.closure["schema_version"], "1")
        self.assertEqual(self.closure["grain"], "AC-00-ii")
        self.assertEqual(self.closure["donor"], "artcraft-services")
        self.assertEqual(self.closure["pinned_commit"], PINNED_COMMIT)
        self.assertTrue(GIT_SHA_RE.match(PINNED_COMMIT))
        self.assertEqual(self.closure["file_count"], 2)
        self.assertEqual(len(self.closure["files"]), 2)

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

    def test_extract_frames_is_dependency_free(self) -> None:
        entry = self.by_path[EXTRACT_FRAMES]
        self.assertFalse(entry["excluded"])
        self.assertEqual(entry["imports"]["relative"], [])
        self.assertEqual(entry["imports"]["alias"], [])
        self.assertEqual(entry["imports"]["external"], [])
        self.assertEqual(entry["imports"]["runtime"], [])

    def test_extract_frames_media_flag_without_banned_payloads(self) -> None:
        entry = self.by_path[EXTRACT_FRAMES]
        self.assertTrue(entry["flags"]["media_api"], "canvas/video media APIs expected")
        for flag in ("css_import", "wasm", "tauri", "worker", "network_fetch", "storage"):
            self.assertFalse(entry["flags"][flag], f"{flag} must be absent")

    def test_frame_actions_is_listed_but_excluded(self) -> None:
        entry = self.by_path[FRAME_ACTIONS]
        self.assertTrue(entry["excluded"])
        included = [path for path, item in self.by_path.items() if not item["excluded"]]
        self.assertEqual(included, [EXTRACT_FRAMES])

    def test_frame_actions_provider_coupling_is_recorded(self) -> None:
        entry = self.by_path[FRAME_ACTIONS]
        self.assertIn("@storyteller/api", entry["imports"]["alias"])
        self.assertIn("react-router-dom", entry["imports"]["external"])
        self.assertIn("./extract-frames", entry["imports"]["relative"])
        self.assertTrue(
            any("create-image" in spec or "create-video" in spec for spec in entry["imports"]["relative"]),
            "create-page store coupling must be recorded",
        )
        self.assertEqual(self.closure["external_packages"], ["react-router-dom"])

    def test_manifest_scope_covers_only_extract_frames(self) -> None:
        manifest = load_json(MANIFEST_PATH)
        video = manifest["import_manifests"]["P10-video-frame-capture"]
        self.assertIn(EXTRACT_FRAMES, video["include_exact"])
        self.assertNotIn(FRAME_ACTIONS, video["include_exact"])
        self.assertIn(FRAME_ACTIONS, video["include_optional"])

    def test_blob_shas_match_donor_pins(self) -> None:
        pins = load_json(DONOR_PINS_PATH)
        services = next(donor for donor in pins["donors"] if donor["id"] == "artcraft-services")
        keyed = {item["path"]: item["sha"] for item in services["key_files"]}
        for path in (EXTRACT_FRAMES, FRAME_ACTIONS):
            with self.subTest(path=path):
                self.assertEqual(self.by_path[path]["sha"], keyed[path])


if __name__ == "__main__":
    unittest.main()
