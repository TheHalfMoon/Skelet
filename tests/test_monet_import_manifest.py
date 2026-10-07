from __future__ import annotations

import hashlib
import json
import re
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IMPORT_DIR = ROOT / "imports" / "monet-registry"
MANIFEST_PATH = IMPORT_DIR / "manifest.json"
SOURCE_TREE_PATH = IMPORT_DIR / "source-tree.tsv"
LOCK_PATH = ROOT / "UPSTREAMS.lock.yml"
AUTHORIZATION_PATH = ROOT / "docs" / "provenance" / "authorizations" / "monet-registry-2026-10-04.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_source_tree(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != "mode\tsha\tsize\tpath":
        raise ValueError("invalid source-tree TSV header")
    entries: list[dict] = []
    for line_number, line in enumerate(lines[1:], start=2):
        parts = line.split("\t", 3)
        if len(parts) != 4:
            raise ValueError(f"invalid source-tree TSV row {line_number}")
        mode, sha, size, source_path = parts
        entries.append(
            {
                "mode": mode,
                "sha": sha,
                "size": int(size),
                "path": source_path,
            }
        )
    return entries


def classify(path: str, policy: dict) -> str:
    if path in policy["include_exact"] or any(path.startswith(prefix) for prefix in policy["include_prefixes"]):
        return "include"
    if path in policy["exclude_exact"] or any(path.startswith(prefix) for prefix in policy["exclude_prefixes"]):
        return "exclude"
    return "unclassified"


def inventory_digest(entries: list[dict]) -> str:
    canonical = "".join(
        f'{entry["mode"]} blob {entry["sha"]} {entry["size"]} {entry["path"]}\n'
        for entry in sorted(entries, key=lambda item: item["path"])
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class MonetImportManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = load_json(MANIFEST_PATH)
        cls.source_tree = load_source_tree(SOURCE_TREE_PATH)
        cls.lock = load_json(LOCK_PATH)
        cls.authorization = load_json(AUTHORIZATION_PATH)
        cls.lock_entry = next(
            source for source in cls.lock["sources"] if source["id"] == "monet-registry"
        )

    def test_source_identity_is_immutable_and_consistent(self) -> None:
        manifest = self.manifest
        inventory = manifest["source_inventory"]
        self.assertEqual("monet-registry", manifest["source_id"])
        self.assertEqual("https://github.com/monet-design/monet-registry", manifest["source_url"])
        self.assertRegex(manifest["observed_commit"], r"^[0-9a-f]{40}$")
        self.assertRegex(manifest["observed_tree"], r"^[0-9a-f]{40}$")
        self.assertEqual("2026-10-06", manifest["verification_date"])
        self.assertLessEqual(date.fromisoformat(manifest["verification_date"]), date.today())
        self.assertEqual("imports/monet-registry/source-tree.tsv", inventory["path"])
        self.assertEqual("tsv", inventory["format"])
        self.assertEqual(["mode", "sha", "size", "path"], inventory["columns"])

    def test_source_tree_summary_matches_captured_inventory(self) -> None:
        inventory = self.manifest["source_inventory"]
        self.assertEqual(5453, inventory["upstream_tree_entries"])
        self.assertEqual(4064, inventory["upstream_blobs"])
        self.assertEqual(1389, inventory["upstream_trees"])
        self.assertEqual(inventory["upstream_blobs"], len(self.source_tree))
        self.assertEqual(
            len(self.source_tree),
            len({entry["path"] for entry in self.source_tree}),
        )

    def test_every_blob_is_classified_exactly_once_by_precedence(self) -> None:
        policy = self.manifest["classification_policy"]
        groups = {"include": [], "exclude": [], "unclassified": []}
        for entry in self.source_tree:
            groups[classify(entry["path"], policy)].append(entry)

        proof = self.manifest["classification_proof"]
        self.assertEqual(proof["included_blobs"], len(groups["include"]))
        self.assertEqual(proof["excluded_blobs"], len(groups["exclude"]))
        self.assertEqual(proof["unclassified_blobs"], len(groups["unclassified"]))
        self.assertEqual([], groups["unclassified"])
        self.assertEqual(proof["included_bytes"], sum(item["size"] for item in groups["include"]))
        self.assertEqual(proof["excluded_bytes"], sum(item["size"] for item in groups["exclude"]))
        self.assertEqual(proof["included_inventory_sha256"], inventory_digest(groups["include"]))
        self.assertEqual(proof["excluded_inventory_sha256"], inventory_digest(groups["exclude"]))

    def test_high_risk_corpus_paths_are_quarantined(self) -> None:
        policy = self.manifest["classification_policy"]
        quarantined = tuple(self.manifest["rights_quarantine"]["prefixes"])
        matched = 0
        for entry in self.source_tree:
            if entry["path"].startswith(quarantined):
                matched += 1
                self.assertEqual("exclude", classify(entry["path"], policy), entry["path"])
        self.assertGreater(matched, 0)

    def test_generated_screenshot_state_is_not_selected(self) -> None:
        policy = self.manifest["classification_policy"]
        self.assertEqual(
            "exclude",
            classify("scripts/screenshot/screenshot-state.json", policy),
        )

    def test_no_repository_license_file_was_captured(self) -> None:
        license_name = re.compile(
            r"(^|/)(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)(\.|$)",
            re.IGNORECASE,
        )
        matches = [
            entry["path"]
            for entry in self.source_tree
            if license_name.search(entry["path"])
        ]
        self.assertEqual([], matches)
        self.assertEqual(
            [],
            self.manifest["notices_and_licenses_to_preserve"]["detected_repository_license_files"],
        )

    def test_rights_gate_allows_snapshot_but_not_runtime_activation(self) -> None:
        self.assertEqual("ready-code-snapshot", self.manifest["state"])
        self.assertFalse(self.manifest["activation_allowed"])
        self.assertTrue(self.manifest["next_grain_allowed"])
        gate = self.manifest["rights_gate"]
        self.assertEqual("resolved-code-only", gate["status"])
        self.assertEqual("user_authorization", gate["resolution"])
        self.assertEqual(
            "docs/provenance/authorizations/monet-registry-2026-10-04.json",
            gate["authorization_record"],
        )
        self.assertIn("datasets", gate["restricted_scope"])
        self.assertIn("brands/trademarks", gate["restricted_scope"])

    def test_authorization_record_is_repository_scoped_and_code_only(self) -> None:
        auth = self.authorization
        self.assertEqual("Skelet", auth["project"])
        self.assertEqual("monet-registry", auth["source_id"])
        self.assertEqual("https://github.com/monet-design/monet-registry", auth["repository"])
        self.assertEqual(self.manifest["observed_commit"], auth["authorized_commit"])
        self.assertEqual("user_authorization", auth["basis"])
        scope = auth["authorized_scope"]
        self.assertEqual("authorized", scope["code"])
        self.assertEqual("restricted", scope["data"])
        self.assertEqual("restricted", scope["assets"])
        self.assertEqual("restricted", scope["models"])
        self.assertEqual("restricted", scope["trademarks"])

    def test_canonical_upstream_lock_is_ready_for_code_only_import(self) -> None:
        entry = self.lock_entry
        self.assertEqual("ready", entry["status"])
        self.assertEqual(self.manifest["observed_commit"], entry["exact_commit_or_release"])
        self.assertEqual("2026-10-06", entry["verification_date"])
        self.assertEqual("user_authorization", entry["permission_basis"]["type"])
        self.assertTrue(entry["license"].startswith("USER_AUTHORIZATION:"))
        self.assertEqual(
            {
                "code": "authorized",
                "data": "restricted",
                "assets": "restricted",
                "models": "restricted",
                "services": "not-applicable",
                "trademarks": "restricted",
            },
            entry["rights_scope"],
        )

    def test_known_dependency_edges_to_quarantined_corpus_are_recorded(self) -> None:
        edges = self.manifest["known_dependency_edges"]
        by_source = {edge["from"]: edge for edge in edges}
        self.assertIn("src/app/api/_common/services/code-reader.service.ts", by_source)
        self.assertEqual(
            "src/components/registry/",
            by_source["src/app/api/_common/services/code-reader.service.ts"]["to_excluded_prefix"],
        )

    def test_no_monet_donor_snapshot_exists_before_g01_02(self) -> None:
        forbidden = [
            ROOT / "vendor" / "monet-registry",
            ROOT / "upstreams" / "monet-registry",
            ROOT / "src" / "vendor" / "monet-registry",
        ]
        self.assertTrue(all(not path.exists() for path in forbidden))


if __name__ == "__main__":
    unittest.main()
