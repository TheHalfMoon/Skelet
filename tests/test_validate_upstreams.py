import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.validate_upstreams import (
    PERMISSION_TYPES,
    PIN_POLICIES,
    RIGHT_VALUES,
    ROLES,
    SOURCE_KEYS,
    SOURCE_KINDS,
    STATUSES,
    validate,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "provenance"


class UpstreamsValidatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.valid_payload = json.loads(
            (FIXTURES / "upstreams.valid-ready.yml").read_text(encoding="utf-8")
        )

    def validate_payload(self, payload: object) -> list[str]:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "upstreams.yml"
            path.write_text(json.dumps(payload), encoding="utf-8")
            return validate(path)

    def valid_source(self) -> dict[str, object]:
        return copy.deepcopy(self.valid_payload["sources"][0])

    def test_repository_lock_is_valid(self) -> None:
        self.assertEqual([], validate(ROOT / "UPSTREAMS.lock.yml"))

    def test_ready_fixture_is_valid(self) -> None:
        self.assertEqual([], validate(FIXTURES / "upstreams.valid-ready.yml"))

    def test_mutable_ref_is_rejected(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-mutable.yml")
        self.assertTrue(any("mutable branch/ref names are forbidden" in error for error in errors))

    def test_missing_required_field_is_rejected(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-missing.yml")
        self.assertTrue(any("missing required fields" in error for error in errors))

    def test_planned_source_cannot_claim_pin(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-planned-pin.yml")
        self.assertTrue(any("planned sources must remain unpinned" in error for error in errors))

    def test_unresolved_rights_are_rejected_for_ready_source(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-unresolved-rights.yml")
        self.assertTrue(any("cannot retain verify-at-import" in error for error in errors))

    def test_future_verification_date_is_rejected(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-future-date.yml")
        self.assertTrue(any("verification date cannot be in the future" in error for error in errors))

    def test_malformed_types_fail_without_crashing(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-types.yml")
        self.assertTrue(errors)
        self.assertTrue(any("source_kind" in error for error in errors))
        self.assertTrue(any("rights_scope.assets" in error for error in errors))

    def test_duplicate_source_ids_are_rejected(self) -> None:
        source = self.valid_source()
        errors = self.validate_payload({"schema_version": "1", "sources": [source, copy.deepcopy(source)]})
        self.assertTrue(any("duplicate source id" in error for error in errors))

    def test_git_source_requires_git_commit_policy(self) -> None:
        source = self.valid_source()
        source["pin_policy"] = "content_hash_required"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("git sources must use git_commit_required" in error for error in errors))

    def test_git_source_requires_full_commit_sha(self) -> None:
        source = self.valid_source()
        source["exact_commit_or_release"] = "deadbeef"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("full 40-hex commit SHA" in error for error in errors))

    def test_website_source_requires_content_hash_policy(self) -> None:
        source = self.valid_source()
        source["source_kind"] = "website"
        source["pin_policy"] = "git_commit_required"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("website sources must use content_hash_required" in error for error in errors))

    def test_package_source_requires_release_digest_policy(self) -> None:
        source = self.valid_source()
        source["source_kind"] = "package"
        source["pin_policy"] = "git_commit_required"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("package sources must use release_digest_required" in error for error in errors))

    def test_ready_source_cannot_retain_verify_at_import_license(self) -> None:
        source = self.valid_source()
        source["license"] = "VERIFY_AT_IMPORT"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("cannot retain VERIFY_AT_IMPORT" in error for error in errors))

    def test_imported_source_requires_imported_paths(self) -> None:
        source = self.valid_source()
        source["status"] = "imported"
        source["imported_paths"] = []
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("imported sources must record imported paths" in error for error in errors))

    def test_source_url_must_be_https(self) -> None:
        source = self.valid_source()
        source["source_url"] = "http://example.com/source"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("must be an https:// URL" in error for error in errors))

    def test_planned_source_cannot_claim_verification_date(self) -> None:
        source = self.valid_source()
        source["status"] = "planned"
        source["exact_commit_or_release"] = None
        source["verification_date"] = "2026-10-05"
        errors = self.validate_payload({"schema_version": "1", "sources": [source]})
        self.assertTrue(any("must not claim an execution-time verification date" in error for error in errors))

    def test_non_object_root_is_rejected(self) -> None:
        errors = self.validate_payload([])
        self.assertEqual(["root: must be an object"], errors)

    def test_invalid_json_is_rejected_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "invalid.yml"
            path.write_text("{not-json", encoding="utf-8")
            errors = validate(path)
        self.assertEqual(1, len(errors))
        self.assertIn("cannot parse JSON-compatible YAML", errors[0])

    def test_schema_and_validator_enums_remain_in_sync(self) -> None:
        schema = json.loads((ROOT / "schemas" / "upstreams.schema.json").read_text(encoding="utf-8"))
        source = schema["$defs"]["source"]
        checks = {
            "SOURCE_KEYS": (set(source["required"]), SOURCE_KEYS),
            "SOURCE_KINDS": (set(source["properties"]["source_kind"]["enum"]), SOURCE_KINDS),
            "ROLES": (set(source["properties"]["role"]["enum"]), ROLES),
            "STATUSES": (set(source["properties"]["status"]["enum"]), STATUSES),
            "PIN_POLICIES": (set(source["properties"]["pin_policy"]["enum"]), PIN_POLICIES),
            "PERMISSION_TYPES": (
                set(source["properties"]["permission_basis"]["properties"]["type"]["enum"]),
                PERMISSION_TYPES,
            ),
            "RIGHT_VALUES": (set(schema["$defs"]["right"]["enum"]), RIGHT_VALUES),
        }
        for name, (schema_values, validator_values) in checks.items():
            with self.subTest(name=name):
                self.assertEqual(schema_values, validator_values)


if __name__ == "__main__":
    unittest.main()
