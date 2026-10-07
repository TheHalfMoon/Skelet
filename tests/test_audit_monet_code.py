"""Regression tests for the pinned Monet source preflight.

All fixtures use synthetic source bytes. No donor code or private data is used.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.audit_monet_code import AuditError, audit_snapshot, source_blob_hash


class MonetCodePreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.path = "src/lib/example.ts"
        self.content = b"export const answer = 42;\n"
        self.manifest = {
            "state": "ready-code-snapshot",
            "activation_allowed": False,
            "rights_gate": {"status": "resolved-code-only"},
            "classification_policy": {
                "include_exact": [self.path],
                "include_prefixes": [],
                "exclude_exact": [],
                "exclude_prefixes": [],
            },
            "source_id": "monet-registry",
            "source_url": "https://github.com/monet-design/monet-registry",
            "observed_commit": "a" * 40,
            "observed_tree": "b" * 40,
        }
        self._write(self.path, self.content)

    def _write(self, path: str, content: bytes) -> None:
        target = self.root.joinpath(*path.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)

    def _row(self, path: str | None = None, content: bytes | None = None) -> dict[str, str]:
        path = self.path if path is None else path
        content = self.content if content is None else content
        return {
            "mode": "100644",
            "path": path,
            "sha": source_blob_hash(content),
            "size": str(len(content)),
        }

    def _audit(self, rows: list[dict[str, str]] | None = None) -> dict:
        return audit_snapshot(
            self.root,
            self.manifest,
            [self._row()] if rows is None else rows,
        )

    def test_safe_code_is_a_candidate_and_is_not_imported(self) -> None:
        report = self._audit()
        self.assertEqual("preflight_only_not_imported", report["state"])
        self.assertFalse(report["runtime_activation_allowed"])
        self.assertEqual(1, report["total_selected"])
        self.assertEqual(len(self.content), report["total_verified_bytes"])
        self.assertEqual([self.path], [x["path"] for x in report["code_candidates"]])
        self.assertEqual([], report["quarantined"])

    def test_non_english_unicode_is_quarantined(self) -> None:
        content = "export const label = '검색';\n".encode("utf-8")
        self._write(self.path, content)
        report = self._audit([self._row(content=content)])
        self.assertEqual([], report["code_candidates"])
        self.assertIn("non_english_or_unicode_content", report["quarantined"][0]["reasons"])

    def test_original_product_identity_is_quarantined(self) -> None:
        content = b"export const product = 'Vooster';\n"
        self._write(self.path, content)
        report = self._audit([self._row(content=content)])
        self.assertIn("donor_identity_reference", report["quarantined"][0]["reasons"])

    def test_identity_config_quarantined_even_without_brand(self) -> None:
        path = "src/config/site.tsx"
        content = b"export const site = {};\n"
        self._write(path, content)
        self.manifest["classification_policy"]["include_exact"] = [path]
        report = self._audit([self._row(path, content)])
        self.assertIn("donor_identity_configuration", report["quarantined"][0]["reasons"])

    def test_non_code_documents_are_quarantined(self) -> None:
        path = "docs/internal.md"
        content = b"# English guidance\n"
        self._write(path, content)
        self.manifest["classification_policy"]["include_exact"] = [path]
        report = self._audit([self._row(path, content)])
        self.assertIn("non_code_or_docs", report["quarantined"][0]["reasons"])

    def test_unselected_file_is_not_copied_or_published(self) -> None:
        excluded = "public/restricted.png"
        self._write(excluded, b"excluded")
        report = self._audit([self._row(), self._row(excluded, b"excluded")])
        self.assertEqual(1, report["total_selected"])

    def test_modified_selected_bytes_fail_closed(self) -> None:
        self._write(self.path, b"tampered data")
        with self.assertRaisesRegex(AuditError, "mismatch"):
            self._audit()

    def test_missing_selected_file_fails_closed(self) -> None:
        self.root.joinpath(*self.path.split("/")).unlink()
        with self.assertRaisesRegex(AuditError, "Missing"):
            self._audit()

    def test_duplicate_source_paths_fail_closed(self) -> None:
        with self.assertRaisesRegex(AuditError, "Duplicate"):
            self._audit([self._row(), self._row()])

    def test_parent_traversal_fails_closed(self) -> None:
        with self.assertRaisesRegex(AuditError, "Invalid source path"):
            self._audit([self._row("../outside.ts")])

    def test_relative_dot_segment_fails_closed(self) -> None:
        with self.assertRaisesRegex(AuditError, "Invalid source path"):
            self._audit([self._row("src/./lib/example.ts")])

    def test_windows_separator_fails_closed(self) -> None:
        with self.assertRaisesRegex(AuditError, "Invalid source path"):
            self._audit([self._row("src\\lib\\example.ts")])

    def test_git_symlink_mode_fails_closed(self) -> None:
        row = self._row()
        row["mode"] = "120000"
        with self.assertRaisesRegex(AuditError, "file mode"):
            self._audit([row])

    def test_git_submodule_mode_fails_closed(self) -> None:
        row = self._row()
        row["mode"] = "160000"
        with self.assertRaisesRegex(AuditError, "file mode"):
            self._audit([row])

    def test_source_rights_gate_stays_closed_until_resolved(self) -> None:
        self.manifest["state"] = "blocked-rights"
        with self.assertRaisesRegex(AuditError, "rights gate"):
            self._audit()

    def test_activation_true_fails_closed(self) -> None:
        self.manifest["activation_allowed"] = True
        with self.assertRaisesRegex(AuditError, "activation"):
            self._audit()

    def test_code_permission_not_resolved_fails_closed(self) -> None:
        self.manifest["rights_gate"]["status"] = "blocked"
        with self.assertRaisesRegex(AuditError, "authorization"):
            self._audit()

    def test_empty_selection_fails_closed(self) -> None:
        with self.assertRaisesRegex(AuditError, "selects no"):
            self._audit([])

    def test_non_utf8_bytes_are_quarantined(self) -> None:
        self.content = b"\xff\xfe"
        self._write(self.path, self.content)
        report = self._audit()
        self.assertIn("non_utf8_content", report["quarantined"][0]["reasons"])

    def test_missing_source_directory_fails_closed(self) -> None:
        with self.assertRaisesRegex(AuditError, "does not exist"):
            audit_snapshot(self.root / "absent", self.manifest, [self._row()])


if __name__ == "__main__":
    unittest.main()
