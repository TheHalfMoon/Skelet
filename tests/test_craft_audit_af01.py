"""AF-01 craft-suite immutable donor audit conformance tests."""
from __future__ import annotations

import json
import re
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "UPSTREAMS.lock.yml"
PINS_PATH = ROOT / "imports" / "craft-suite" / "donor-pins.json"
MANIFEST_PATH = ROOT / "imports" / "craft-suite" / "manifest.json"
AUTH_PATH = ROOT / "docs" / "provenance" / "authorizations" / "craft-suite-2026-10-11.json"
AUDIT_PATH = ROOT / "docs" / "provenance" / "CRAFT_SUITE_AUDIT_AF01_2026-10-11.md"

GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
EXPECTED = {
    "artcraft": "28a39a0de4a2fc2eccc237df2046c24245bd12ab",
    "artcraft-services": "02a3de2509662cfc7c12f51c09e7f4322618029a",
    "vectorcraft": "6c3f9f60aa69ac151f9908b94cf00a387746eea4",
    "photocraft": "97136485f0743251ab330d096ca6c9d0f0f6f54c",
    "designcraft": "16a7365701f9ce8f93ca77a27a8dc2fffb807869",
    "effectcraft": "9a7d3e76991d5372448033b473dc12c2480a6a04",
    "filmcraft": "4e2d0bc2d3646f9cf27ef7aa8b2095c6858c7efe",
    "lightcraft": "0ba118de92a81f7463ca0e6d79e1323137b1adae",
}
TREES = {
    "artcraft": "fea600155ae05c6a4c367b8fc98ce152e0c30196",
    "artcraft-services": "514284a65233a28620cfaf8eb69fdf45ce2a5de8",
    "vectorcraft": "35f2a36fe76bef9a810bf77cd66f5738a516a693",
    "photocraft": "484b12daeb9e99b38d37545737dbeccb6ff127cc",
    "designcraft": "f102022e5ed9c6f9bb990731d8346d4b08fdeb8f",
    "effectcraft": "8271189ed4c16fdccc1cecbe556b77ee99b3ebfa",
    "filmcraft": "d951dfcfdc344f0e7f78aeb54df380e29d56001b",
    "lightcraft": "7657bd036f8eaa7c7e94268b2846dca4ae90a961",
}


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class CraftAuditAf01Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.lock = load_json(LOCK_PATH)
        cls.pins = load_json(PINS_PATH)
        cls.manifest = load_json(MANIFEST_PATH)
        cls.auth = load_json(AUTH_PATH)
        cls.audit = AUDIT_PATH.read_text(encoding="utf-8")
        cls.by_id = {s["id"]: s for s in cls.lock["sources"]}
        cls.pin_by_id = {d["id"]: d for d in cls.pins["donors"]}

    def test_all_eight_donors_pinned_immutably(self) -> None:
        self.assertEqual(set(EXPECTED), set(self.pin_by_id))
        for donor_id, commit in EXPECTED.items():
            with self.subTest(donor=donor_id):
                donor = self.pin_by_id[donor_id]
                self.assertEqual(commit, donor["observed_commit"])
                self.assertRegex(donor["observed_commit"], r"^[0-9a-f]{40}$")
                self.assertEqual(TREES[donor_id], donor["observed_tree"])
                self.assertRegex(donor["observed_tree"], r"^[0-9a-f]{40}$")
        self.assertEqual("d07a8ea0b5073a4dda205a797084d2af3f730ba8", self.pins["base_sha"])
        self.assertEqual("2026-10-11", self.pins["verification_date"])
        self.assertTrue(self.pins["no_runtime_import"])
        self.assertTrue(self.pins["no_paid_dependency"])

    def test_lock_entries_are_ready_with_resolved_rights(self) -> None:
        for donor_id, commit in EXPECTED.items():
            with self.subTest(donor=donor_id):
                entry = self.by_id[donor_id]
                self.assertEqual("ready", entry["status"])
                self.assertEqual(commit, entry["exact_commit_or_release"])
                self.assertRegex(entry["exact_commit_or_release"], r"^[0-9a-f]{40}$")
                self.assertEqual("2026-10-11", entry["verification_date"])
                self.assertLessEqual(date.fromisoformat(entry["verification_date"]), date.today())
                self.assertEqual("git_commit_required", entry["pin_policy"])
                self.assertNotEqual("VERIFY_AT_IMPORT", entry["license"])
                self.assertTrue(entry["license"].strip())
                rights = entry["rights_scope"]
                self.assertNotIn("verify-at-import", set(rights.values()))
                self.assertEqual("restricted", rights["trademarks"])
                self.assertIn(rights["code"], {"authorized", "license-governed"})
                self.assertEqual([], entry["imported_paths"])
                self.assertEqual([], entry["modifications"])

    def test_artcraft_services_uses_founder_authorization_not_open_license(self) -> None:
        entry = self.by_id["artcraft-services"]
        self.assertEqual("user_authorization", entry["permission_basis"]["type"])
        self.assertTrue(entry["license"].startswith("USER_AUTHORIZATION:"))
        self.assertIn("Fair-Source", self.pin_by_id["artcraft-services"]["license_spdx"])

    def test_open_rust_donors_record_dual_license(self) -> None:
        for donor_id in ("artcraft", "vectorcraft", "photocraft", "designcraft", "effectcraft", "filmcraft", "lightcraft"):
            with self.subTest(donor=donor_id):
                entry = self.by_id[donor_id]
                self.assertIn(entry["permission_basis"]["type"], {"both", "upstream_license", "user_authorization"})
                self.assertIn("Apache-2.0", entry["license"])
        self.assertIn("Apache-2.0-only", self.pin_by_id["lightcraft"]["license_spdx"])

    def test_manifest_is_audit_only_with_quarantine(self) -> None:
        manifest = self.manifest
        self.assertEqual("AF-01", manifest["grain"])
        self.assertEqual("ready-audit-only", manifest["state"])
        self.assertFalse(manifest["activation_allowed"])
        self.assertTrue(manifest["next_grain_allowed"])
        self.assertEqual("resolved-code-only", manifest["rights_gate"]["status"])
        quarantine = manifest["rights_quarantine"]["prefixes"]
        for prefix in (
            "frontend/apps/artcraft/app/public/resources/sound/",
            "frontend/apps/artcraft/app/public/resources/memes/",
            "docs/brand/",
            "assets/fonts/",
        ):
            self.assertIn(prefix, quarantine)
        manifests = manifest["import_manifests"]
        for key in ("P10-video-frame-capture", "P12-reference-board-core", "P14-pagedraw-primitives", "P14-vectorcraft-headless", "P14-photocraft-headless"):
            self.assertIn(key, manifests)
        self.assertIn("extract-frames.ts", str(manifests["P10-video-frame-capture"]))
        self.assertIn("moodboard", str(manifests["P12-reference-board-core"]))
        self.assertIn("vectorcraft-cli", str(manifests["P14-vectorcraft-headless"]))
        self.assertIn("photocraft-cli", str(manifests["P14-photocraft-headless"]))
        self.assertIn("rejected-from-core", manifests)
        caps = manifest["performance_baseline"]["caps"]
        self.assertEqual(524288, caps["board_layout_json_bytes"])
        self.assertEqual(24, caps["video_frames_per_job"])
        self.assertIn("No OpenAI", manifest["cve_and_dependency_notes"]["no_paid_services"])
        blob = json.dumps(manifest)
        self.assertIn("No OpenAI", blob)
        self.assertTrue(manifest["skelet_authoritative"]["collections_canonical"])
        self.assertTrue(manifest["skelet_authoritative"]["no_second_database"])

    def test_no_runtime_donor_code_is_imported(self) -> None:
        craft_dir = ROOT / "imports" / "craft-suite"
        files = sorted(p.name for p in craft_dir.iterdir() if p.is_file())
        self.assertEqual(["donor-pins.json", "manifest.json"], files)
        for path in craft_dir.rglob("*"):
            self.assertNotIn(path.suffix, {".ts", ".tsx", ".rs", ".wasm", ".onnx", ".pt", ".bin"})

    def test_authorization_is_code_only_with_paid_prohibition(self) -> None:
        auth = self.auth
        self.assertEqual("Skelet", auth["project"])
        self.assertEqual(set(EXPECTED), set(auth["source_ids"]))
        self.assertEqual("user_authorization", auth["basis"])
        scope = auth["authorized_scope"]
        self.assertEqual("authorized", scope["code"])
        self.assertEqual("restricted", scope["data"])
        self.assertEqual("restricted", scope["assets"])
        self.assertEqual("restricted", scope["models"])
        self.assertEqual("restricted", scope["services"])
        self.assertEqual("restricted", scope["trademarks"])
        blob = json.dumps(auth)
        self.assertIn("paid AI API", blob)
        self.assertIn("NOTICE", blob.upper())

    def test_audit_document_covers_required_evidence(self) -> None:
        audit = self.audit
        for token in (
            "28a39a0de4a2fc2eccc237df2046c24245bd12ab",
            "02a3de2509662cfc7c12f51c09e7f4322618029a",
            "6c3f9f60aa69ac151f9908b94cf00a387746eea4",
            "97136485f0743251ab330d096ca6c9d0f0f6f54c",
            "LICENSE-MIT",
            "LICENSE-APACHE",
            "NOTICE",
            "extract-frames.ts",
            "BoardLibraryStore",
            "moodboardSync",
            "vectorcraft-cli",
            "photocraft-cli",
            "No mandatory paid AI API",
            "Collection",
            "AF-02",
        ):
            self.assertIn(token, audit)

    def test_lock_pins_match_frozen_fixture(self) -> None:
        for donor_id, commit in EXPECTED.items():
            with self.subTest(donor=donor_id):
                self.assertEqual(commit, self.by_id[donor_id]["exact_commit_or_release"])
                self.assertEqual(commit, self.pin_by_id[donor_id]["observed_commit"])


if __name__ == "__main__":
    unittest.main()
