"""Exact upstream and code-only provenance checks for the isolated screenshot queue."""
from __future__ import annotations

import csv
import json
import unittest
from pathlib import Path

from scripts.audit_monet_code import source_blob_hash


ROOT = Path(__file__).resolve().parents[1]
RECORD_PATH = ROOT / "imports/monet-registry/accepted-code/screenshot-queue.json"


class MonetScreenshotQueueProvenanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.record = json.loads(RECORD_PATH.read_text(encoding="utf-8"))
        cls.manifest = json.loads(
            (ROOT / "imports/monet-registry/manifest.json").read_text(encoding="utf-8")
        )
        cls.preflight = json.loads(
            (ROOT / "docs/provenance/monet-code-snapshot-audit.json").read_text(
                encoding="utf-8"
            )
        )
        with (ROOT / "imports/monet-registry/source-tree.tsv").open(
            encoding="utf-8", newline=""
        ) as stream:
            cls.upstream_blobs = {r["path"]: r for r in csv.DictReader(stream, delimiter="\t")}

    def test_immutable_upstream_identity(self) -> None:
        source = self.record["source"]
        self.assertEqual("G01-02b", self.record["grain"])
        self.assertEqual(self.manifest["observed_commit"], source["commit"])
        self.assertEqual(self.manifest["observed_tree"], source["tree"])
        self.assertEqual(self.manifest["source_url"], source["repository"])

    def test_imported_file_is_byte_identical_to_pinned_source(self) -> None:
        source = self.record["source"]
        destination = self.record["destination"]
        entry = self.upstream_blobs[source["path"]]
        self.assertEqual("100644", entry["mode"])
        self.assertEqual(entry["sha"], source["git_blob_sha1"])
        self.assertEqual(entry["sha"], destination["git_blob_sha1"])
        self.assertEqual(int(entry["size"]), source["byte_length"])
        self.assertEqual("verbatim", destination["modifications"])
        path = ROOT / destination["path"]
        payload = path.read_bytes()
        self.assertEqual(source["byte_length"], len(payload))
        self.assertEqual(entry["sha"], source_blob_hash(payload))

    def test_upstream_path_was_preflight_code_candidate(self) -> None:
        allowed = {entry["path"] for entry in self.preflight["code_candidates"]}
        self.assertIn(self.record["source"]["path"], allowed)
        self.assertNotIn(
            self.record["source"]["path"],
            {entry["path"] for entry in self.preflight["quarantined"]},
        )

    def test_reuse_authorization_is_only_for_code(self) -> None:
        permission = self.record["permission"]
        self.assertEqual("user_authorization", permission["type"])
        self.assertEqual("source_code_only", permission["scope"])
        self.assertEqual("not_verified", permission["upstream_license_status"])
        self.assertEqual(
            "docs/provenance/authorizations/monet-registry-2026-10-04.json",
            permission["record"],
        )
        self.assertTrue((ROOT / permission["record"]).is_file())
        self.assertIn("brands_and_trademarks", self.record["exclusions"])
        self.assertIn("media_assets", self.record["exclusions"])

    def test_public_runtime_stays_disabled(self) -> None:
        activation = self.record["activation"]
        self.assertIs(activation["included_in_public_product"], False)
        self.assertIs(activation["persistent_queue"], False)
        self.assertIs(self.manifest["activation_allowed"], False)

    def test_no_unreviewed_donor_content_in_transplant(self) -> None:
        content = (ROOT / self.record["destination"]["path"]).read_text(
            encoding="utf-8"
        )
        self.assertTrue(content.isascii())
        for term in ("vooster", "landing-mon", "monet-registry", "saaspo"):
            self.assertNotIn(term, content.lower())


if __name__ == "__main__":
    unittest.main()
