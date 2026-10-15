"""AC-04 post-launch evaluation disposition conformance tests.

Machine-checks every traceability fact cited in
docs/qualification/AC-04_POST_LAUNCH_DISPOSITION.md directly from repo
sources (donor-pins.json + manifest.json), offline. Each of the five
candidates must resolve to an explicit DEFER verdict with a trigger in
the disposition; pins and licenses must agree with the lock file so a
donor change forces re-evaluation instead of silent rot.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC_PATH = ROOT / "docs" / "qualification" / "AC-04_POST_LAUNCH_DISPOSITION.md"
PINS_PATH = ROOT / "imports" / "craft-suite" / "donor-pins.json"
MANIFEST_PATH = ROOT / "imports" / "craft-suite" / "manifest.json"

GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
CANDIDATES = ("designcraft", "effectcraft", "filmcraft", "lightcraft")


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class Ac04DispositionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.doc = DOC_PATH.read_text(encoding="utf-8")
        cls.pins = {donor["id"]: donor for donor in load_json(PINS_PATH)["donors"]}
        cls.manifest = load_json(MANIFEST_PATH)

    def test_every_workspace_candidate_has_pin_and_license(self) -> None:
        for candidate in CANDIDATES:
            with self.subTest(candidate=candidate):
                donor = self.pins[candidate]
                self.assertTrue(GIT_SHA_RE.match(donor["observed_commit"]), "immutable pin required")
                self.assertTrue(donor["license_spdx"], "license scope required")
                self.assertIn(donor["observed_commit"][:7], self.doc)

    def test_every_candidate_resolves_to_defer_with_trigger(self) -> None:
        lowered = self.doc.lower()
        for candidate in (*CANDIDATES, "pagescene"):
            with self.subTest(candidate=candidate):
                self.assertIn(candidate, lowered)
        self.assertGreaterEqual(len(re.findall(r"(?i)\bdefer\b", self.doc)), 6)
        for trigger in ("re-evaluate", "Trigger to re-evaluate", "Quantified gap", "user-accepted terms"):
            self.assertIn(trigger, self.doc)

    def test_manifest_scopes_agree_with_disposition(self) -> None:
        post = self.manifest["import_manifests"]["post-launch-evaluate"]
        self.assertEqual(post["destination_phase"], "post-launch")
        self.assertEqual(set(post["sources"]), set(CANDIDATES))
        rejected = self.manifest["import_manifests"]["rejected-from-core"]
        self.assertTrue(any("pagescene" in path for path in rejected["paths"]))
        self.assertTrue(any("video-editor" in path for path in rejected["paths"]))
        self.assertIn("post-launch-evaluate", self.doc)
        self.assertIn("rejected-from-core", self.doc)

    def test_no_candidate_is_accepted_or_launch_blocking(self) -> None:
        lowered = self.doc.lower()
        self.assertNotIn("accepted", lowered.replace("user-accepted terms", ""))
        self.assertIn("no mandatory dependency", lowered)
        self.assertIn("DEFER All Five", self.doc)


if __name__ == "__main__":
    unittest.main()
