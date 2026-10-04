import json
import unittest
from pathlib import Path

from scripts import validate_upstreams as validator

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "provenance"


class UpstreamsValidatorTests(unittest.TestCase):
    def test_repository_lock_is_valid(self) -> None:
        self.assertEqual([], validator.validate(ROOT / "UPSTREAMS.lock.yml"))

    def test_ready_fixture_is_valid(self) -> None:
        self.assertEqual([], validator.validate(FIXTURES / "upstreams.valid-ready.yml"))

    def test_mutable_ref_is_rejected(self) -> None:
        errors = validator.validate(FIXTURES / "upstreams.invalid-mutable.yml")
        self.assertTrue(any("mutable branch/ref names are forbidden" in error for error in errors))

    def test_missing_required_field_is_rejected(self) -> None:
        errors = validator.validate(FIXTURES / "upstreams.invalid-missing.yml")
        self.assertTrue(any("missing required fields" in error for error in errors))

    def test_planned_source_cannot_claim_pin(self) -> None:
        errors = validator.validate(FIXTURES / "upstreams.invalid-planned-pin.yml")
        self.assertTrue(any("planned sources must remain unpinned" in error for error in errors))

    def test_unresolved_rights_are_rejected_for_ready_source(self) -> None:
        errors = validator.validate(FIXTURES / "upstreams.invalid-unresolved-rights.yml")
        self.assertTrue(any("cannot retain verify-at-import" in error for error in errors))

    def test_future_verification_date_is_rejected(self) -> None:
        errors = validator.validate(FIXTURES / "upstreams.invalid-future-date.yml")
        self.assertTrue(any("verification date cannot be in the future" in error for error in errors))

    def test_malformed_types_fail_without_crashing(self) -> None:
        errors = validator.validate(FIXTURES / "upstreams.invalid-types.yml")
        self.assertTrue(errors)
        self.assertTrue(any("source_kind" in error for error in errors))
        self.assertTrue(any("rights_scope.assets" in error for error in errors))

    def test_schema_and_validator_enums_remain_in_sync(self) -> None:
        schema = json.loads((ROOT / "schemas" / "upstreams.schema.json").read_text(encoding="utf-8"))
        source = schema["$defs"]["source"]
        checks = {
            "SOURCE_KEYS": (set(source["required"]), validator.SOURCE_KEYS),
            "SOURCE_KINDS": (set(source["properties"]["source_kind"]["enum"]), validator.SOURCE_KINDS),
            "ROLES": (set(source["properties"]["role"]["enum"]), validator.ROLES),
            "STATUSES": (set(source["properties"]["status"]["enum"]), validator.STATUSES),
            "PIN_POLICIES": (set(source["properties"]["pin_policy"]["enum"]), validator.PIN_POLICIES),
            "PERMISSION_TYPES": (
                set(source["properties"]["permission_basis"]["properties"]["type"]["enum"]),
                validator.PERMISSION_TYPES,
            ),
            "RIGHT_VALUES": (set(schema["$defs"]["right"]["enum"]), validator.RIGHT_VALUES),
        }
        for name, (schema_values, validator_values) in checks.items():
            with self.subTest(name=name):
                self.assertEqual(schema_values, validator_values)


if __name__ == "__main__":
    unittest.main()
