"""Consistency tests for the G01-02c Monet dependency closure record."""
from __future__ import annotations

import csv
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLOSURE_PATH = ROOT / "imports/monet-registry/dependency-closure.json"
AUDIT_PATH = ROOT / "docs/provenance/monet-code-snapshot-audit.json"
TSV_PATH = ROOT / "imports/monet-registry/source-tree.tsv"
MANIFEST_PATH = ROOT / "imports/monet-registry/manifest.json"

PINNED_COMMIT = "85c966f8d94572431bcbb4439f9fd7ea2a893321"
ALLOWED_DECISIONS = {"transplanted", "selected-next", "reference-only", "rejected"}
QUARANTINE_PREFIXES = ("agent-input/", "data/", "public/",
                       "src/components/registry/")


class DependencyClosureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.closure = json.loads(CLOSURE_PATH.read_text(encoding="utf-8"))
        cls.audit = json.loads(AUDIT_PATH.read_text(encoding="utf-8"))
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        with TSV_PATH.open(encoding="utf-8", newline="") as stream:
            cls.blobs = {r["path"]: r
                         for r in csv.DictReader(stream, delimiter="\t")}

    def test_closure_covers_exactly_the_candidate_set(self) -> None:
        candidates = [c["path"] for c in self.audit["code_candidates"]]
        closed = [f["path"] for f in self.closure["files"]]
        self.assertEqual(len(candidates), 45)
        self.assertEqual(sorted(closed), sorted(candidates))

    def test_all_blobs_verified_at_pinned_commit(self) -> None:
        self.assertEqual(self.closure["source"]["commit"], PINNED_COMMIT)
        for entry in self.closure["files"]:
            self.assertTrue(entry["blob_verified"], entry["path"])
            row = self.blobs[entry["path"]]
            self.assertEqual(row["sha"], entry["blob_sha1"])
            self.assertEqual(int(row["size"]), entry["byte_length"])

    def test_no_quarantined_path_selected(self) -> None:
        quarantined = {q["path"] if isinstance(q, dict) else q
                       for q in self.audit["quarantined"]}
        self.assertEqual(len(quarantined), 45)
        self.assertEqual(self.closure["quarantine_decision"]["unquarantined"], [])
        selected = {f["path"] for f in self.closure["files"]
                    if f["decision"] in ("transplanted", "selected-next")}
        self.assertFalse(selected & quarantined)
        for prefix in QUARANTINE_PREFIXES:
            self.assertNotIn(prefix, str(selected))

    def test_minimum_module_selection_is_exact(self) -> None:
        selection = self.closure["minimum_module_selection"]
        self.assertEqual(selection["transplanted_now"],
                         ["scripts/screenshot/queue.ts"])
        self.assertEqual(selection["selected_next_G01_03b"],
                         ["src/lib/utils.ts"])

    def test_transplanted_path_is_dependency_closed(self) -> None:
        by_path = {f["path"]: f for f in self.closure["files"]}
        queue = by_path["scripts/screenshot/queue.ts"]
        self.assertEqual(queue["direct_imports"], [])
        self.assertEqual(queue["decision"], "transplanted")

    def test_selected_next_has_no_excluded_coupling(self) -> None:
        by_path = {f["path"]: f for f in self.closure["files"]}
        utils = by_path["src/lib/utils.ts"]
        self.assertEqual(utils["decision"], "selected-next")
        self.assertNotIn("non-candidate-internal", utils["edge_classes"])
        self.assertNotIn("relative-sibling", utils["edge_classes"])

    def test_decisions_use_known_vocabulary(self) -> None:
        for entry in self.closure["files"]:
            self.assertIn(entry["decision"], ALLOWED_DECISIONS, entry["path"])
            self.assertTrue(entry["reason"].strip(), entry["path"])

    def test_excluded_refs_recorded(self) -> None:
        by_path = {f["path"]: f for f in self.closure["files"]}
        for entry in self.closure["files"]:
            self.assertIn("excluded_refs", entry, entry["path"])
        reset = by_path["scripts/screenshot/reset.ts"]
        self.assertTrue(any("public/registry/preview" in r
                            for r in reset["excluded_refs"]))
        state = by_path["scripts/screenshot/state.ts"]
        self.assertTrue(any("screenshot-state.json" in r
                            for r in state["excluded_refs"]))
        queue = by_path["scripts/screenshot/queue.ts"]
        self.assertEqual(queue["excluded_refs"], [])

    def test_external_pins_record_g01_03b_baseline(self) -> None:
        pins = self.closure["external_pins"]
        self.assertEqual(pins["clsx"], "2.1.1")
        self.assertEqual(pins["tailwind-merge"], "2.6.0")
        self.assertIsNone(pins["playwright"])

    def test_transitive_context_confirms_route_verdict(self) -> None:
        context = self.closure["non_candidate_context"]
        self.assertEqual(len(context["files"]), 14)
        self.assertTrue(context["all_blob_verified"])
        by_path = {f["path"]: f for f in context["files"]}
        reader = by_path["src/app/api/_common/services/code-reader.service.ts"]
        self.assertTrue(any("components/registry" in imp
                            for imp in reader["imports"]))
        search = by_path["src/app/api/_common/services/search.service.ts"]
        self.assertIn("@orama/orama", search["imports"])

    def test_manifest_rights_gate_still_closed(self) -> None:
        self.assertIs(self.manifest["activation_allowed"], False)
        self.assertEqual(self.manifest["observed_commit"], PINNED_COMMIT)

    def test_license_basis_recorded_per_file(self) -> None:
        self.assertIn("license_basis", self.closure)
        for entry in self.closure["files"]:
            self.assertEqual(entry["license_header"], "none", entry["path"])

    def test_runtime_surface_spot_checks(self) -> None:
        by_path = {f["path"]: f["runtime_surface"]
                   for f in self.closure["files"]}
        middleware = by_path["src/middleware.ts"]
        self.assertIn("API_BASIC_AUTH_USER", middleware["env_reads"])
        reset = by_path["scripts/screenshot/reset.ts"]
        self.assertIn("unlinkSync", reset["fs_writes"])
        state = by_path["scripts/screenshot/state.ts"]
        self.assertIn("writeFileSync", state["fs_writes"])
        client = by_path["e2e/helpers/api-client.ts"]
        self.assertIn("http://localhost:4413", client["network_refs"])
        queue = by_path["scripts/screenshot/queue.ts"]
        self.assertFalse(any(queue.values()))


if __name__ == "__main__":
    unittest.main()
