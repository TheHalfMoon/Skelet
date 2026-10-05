import copy
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from scripts.validate_upstreams import (
    PERMISSION_TYPES,
    PIN_POLICIES,
    RIGHT_VALUES,
    ROLES,
    SOURCE_KEYS,
    SOURCE_KINDS,
    STATUSES,
    main,
    valid_date,
    validate,
)

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "provenance"
VALID_READY = json.loads((FIXTURES / "upstreams.valid-ready.yml").read_text(encoding="utf-8"))


class UpstreamsValidatorTests(unittest.TestCase):
    def _payload(self) -> dict:
        return copy.deepcopy(VALID_READY)

    def _source(self) -> dict:
        return self._payload()["sources"][0]

    def _validate_payload(self, payload) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "upstreams.yml"
            path.write_text(json.dumps(payload), encoding="utf-8")
            return validate(path)

    def _assert_source_error(self, mutate, needle: str) -> None:
        payload = self._payload()
        mutate(payload["sources"][0])
        errors = self._validate_payload(payload)
        self.assertTrue(any(needle in error for error in errors), errors)

    def test_repository_lock_is_valid(self) -> None:
        self.assertEqual([], validate(ROOT / "UPSTREAMS.lock.yml"))

    def test_ready_fixture_is_valid(self) -> None:
        self.assertEqual([], validate(FIXTURES / "upstreams.valid-ready.yml"))

    def test_valid_website_and_package_pins(self) -> None:
        for kind, policy in (("website", "content_hash_required"), ("package", "release_digest_required")):
            with self.subTest(kind=kind):
                payload = self._payload()
                source = payload["sources"][0]
                source["source_kind"] = kind
                source["pin_policy"] = policy
                source["exact_commit_or_release"] = "sha256:" + ("a" * 64)
                self.assertEqual([], self._validate_payload(payload))

    def test_root_contract_failures(self) -> None:
        cases = [
            ([], "root: must be an object"),
            ({"schema_version": "1", "sources": [], "extra": True}, "must contain exactly"),
            ({"schema_version": "2", "sources": []}, "must equal string '1'"),
            ({"schema_version": "1", "sources": {}}, "must be an array"),
        ]
        for payload, needle in cases:
            with self.subTest(needle=needle):
                errors = self._validate_payload(payload)
                self.assertTrue(any(needle in error for error in errors), errors)

    def test_invalid_json_is_rejected_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.yml"
            path.write_text("{not-json", encoding="utf-8")
            errors = validate(path)
        self.assertEqual(1, len(errors))
        self.assertIn("cannot parse JSON-compatible YAML", errors[0])

    def test_missing_file_is_rejected_without_traceback(self) -> None:
        errors = validate(ROOT / "fixtures" / "provenance" / "does-not-exist.yml")
        self.assertEqual(1, len(errors))
        self.assertIn("cannot parse JSON-compatible YAML", errors[0])

    def test_source_must_be_object(self) -> None:
        payload = self._payload()
        payload["sources"] = ["not-an-object"]
        self.assertTrue(any("must be an object" in error for error in self._validate_payload(payload)))

    def test_missing_and_unknown_source_fields_are_rejected(self) -> None:
        payload = self._payload()
        del payload["sources"][0]["capability"]
        errors = self._validate_payload(payload)
        self.assertTrue(any("missing required fields" in error for error in errors), errors)

        payload = self._payload()
        payload["sources"][0]["unexpected"] = True
        errors = self._validate_payload(payload)
        self.assertTrue(any("unknown fields" in error for error in errors), errors)

    def test_identity_and_text_fields_are_validated(self) -> None:
        cases = [
            (lambda s: s.__setitem__("id", "Bad ID"), "must match"),
            (lambda s: s.__setitem__("source_url", "http://example.com"), "must be an https:// URL"),
            (lambda s: s.__setitem__("capability", "x"), "non-empty capability"),
            (lambda s: s.__setitem__("license", ""), "non-empty string"),
        ]
        for mutate, needle in cases:
            with self.subTest(needle=needle):
                self._assert_source_error(mutate, needle)

    def test_enum_fields_are_validated(self) -> None:
        cases = [
            ("source_kind", "invalid-kind"),
            ("role", "invalid-role"),
            ("status", "invalid-status"),
            ("pin_policy", "invalid-policy"),
        ]
        for field, value in cases:
            with self.subTest(field=field):
                self._assert_source_error(lambda s, f=field, v=value: s.__setitem__(f, v), "must be one of")

    def test_permission_basis_contract(self) -> None:
        cases = [
            (lambda s: s.__setitem__("permission_basis", "invalid"), "must contain exactly type and note"),
            (lambda s: s.__setitem__("permission_basis", {"type": "invalid", "note": "valid note"}), "permission_basis.type"),
            (lambda s: s.__setitem__("permission_basis", {"type": "upstream_license", "note": "x"}), "permission_basis.note"),
            (lambda s: s.__setitem__("permission_basis", {"type": "upstream_license", "note": "valid", "extra": True}), "must contain exactly type and note"),
        ]
        for mutate, needle in cases:
            with self.subTest(needle=needle):
                self._assert_source_error(mutate, needle)

    def test_source_kind_requires_matching_pin_policy(self) -> None:
        cases = [
            ("git", "content_hash_required", "git sources must use git_commit_required"),
            ("website", "git_commit_required", "website sources must use content_hash_required"),
            ("package", "git_commit_required", "package sources must use release_digest_required"),
        ]
        for kind, policy, needle in cases:
            with self.subTest(kind=kind):
                def mutate(source, k=kind, p=policy):
                    source["source_kind"] = k
                    source["pin_policy"] = p
                self._assert_source_error(mutate, needle)

    def test_planned_source_cannot_claim_pin_or_verification_date(self) -> None:
        payload = self._payload()
        source = payload["sources"][0]
        source["status"] = "planned"
        source["exact_commit_or_release"] = "a" * 40
        source["verification_date"] = "2026-10-05"
        errors = self._validate_payload(payload)
        self.assertTrue(any("planned sources must remain unpinned" in error for error in errors), errors)
        self.assertTrue(any("must not claim an execution-time verification date" in error for error in errors), errors)

    def test_ready_lifecycle_requires_pin_and_valid_date(self) -> None:
        cases = [
            (lambda s: s.__setitem__("exact_commit_or_release", None), "require an immutable pin"),
            (lambda s: s.__setitem__("exact_commit_or_release", "main"), "mutable branch/ref names are forbidden"),
            (lambda s: s.__setitem__("exact_commit_or_release", "abc"), "full 40-hex commit SHA"),
            (lambda s: s.__setitem__("verification_date", None), "require an ISO YYYY-MM-DD"),
            (lambda s: s.__setitem__("verification_date", "2026-99-99"), "require an ISO YYYY-MM-DD"),
            (lambda s: s.__setitem__("verification_date", "2999-01-01"), "cannot be in the future"),
            (lambda s: s.__setitem__("license", "VERIFY_AT_IMPORT"), "cannot retain VERIFY_AT_IMPORT"),
        ]
        for mutate, needle in cases:
            with self.subTest(needle=needle):
                self._assert_source_error(mutate, needle)

    def test_content_and_release_pins_require_sha256(self) -> None:
        for kind, policy in (("website", "content_hash_required"), ("package", "release_digest_required")):
            with self.subTest(kind=kind):
                def mutate(source, k=kind, p=policy):
                    source["source_kind"] = k
                    source["pin_policy"] = p
                    source["exact_commit_or_release"] = "not-a-digest"
                self._assert_source_error(mutate, "require sha256:<64 hex>")

    def test_rights_scope_contract(self) -> None:
        cases = [
            (lambda s: s.__setitem__("rights_scope", "invalid"), "must contain exactly"),
            (lambda s: s["rights_scope"].pop("assets"), "must contain exactly"),
            (lambda s: s["rights_scope"].__setitem__("assets", "invalid"), "rights_scope.assets"),
            (lambda s: s["rights_scope"].__setitem__("assets", "verify-at-import"), "cannot retain verify-at-import"),
        ]
        for mutate, needle in cases:
            with self.subTest(needle=needle):
                self._assert_source_error(mutate, needle)

    def test_list_fields_require_string_arrays(self) -> None:
        cases = [
            ("imported_paths", "not-a-list"),
            ("imported_paths", [1]),
            ("modifications", "not-a-list"),
            ("modifications", [1]),
        ]
        for field, value in cases:
            with self.subTest(field=field, value=value):
                self._assert_source_error(lambda s, f=field, v=value: s.__setitem__(f, v), "must be an array of strings")

    def test_imported_source_requires_imported_paths(self) -> None:
        def mutate(source):
            source["status"] = "imported"
            source["imported_paths"] = []
        self._assert_source_error(mutate, "imported sources must record imported paths")

    def test_retired_source_uses_resolved_lifecycle_contract(self) -> None:
        payload = self._payload()
        payload["sources"][0]["status"] = "retired"
        self.assertEqual([], self._validate_payload(payload))

    def test_duplicate_source_ids_are_rejected(self) -> None:
        payload = self._payload()
        payload["sources"].append(copy.deepcopy(payload["sources"][0]))
        errors = self._validate_payload(payload)
        self.assertTrue(any("duplicate source id" in error for error in errors), errors)

    def test_malformed_types_fail_without_crashing(self) -> None:
        errors = validate(FIXTURES / "upstreams.invalid-types.yml")
        self.assertTrue(errors)
        self.assertTrue(any("source_kind" in error for error in errors))
        self.assertTrue(any("rights_scope.assets" in error for error in errors))

    def test_valid_date_helper(self) -> None:
        self.assertTrue(valid_date("2026-10-05"))
        self.assertFalse(valid_date("2026-02-31"))

    def test_main_returns_zero_for_valid_lock(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(["validate_upstreams.py", str(ROOT / "UPSTREAMS.lock.yml")])
        self.assertEqual(0, code)
        self.assertIn("UPSTREAMS_VALIDATION_PASSED", stdout.getvalue())
        self.assertEqual("", stderr.getvalue())

    def test_main_returns_one_for_invalid_lock(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            code = main(["validate_upstreams.py", str(FIXTURES / "upstreams.invalid-mutable.yml")])
        self.assertEqual(1, code)
        self.assertEqual("", stdout.getvalue())
        self.assertIn("UPSTREAMS_VALIDATION_FAILED", stderr.getvalue())
        self.assertIn("mutable branch/ref names are forbidden", stderr.getvalue())

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
