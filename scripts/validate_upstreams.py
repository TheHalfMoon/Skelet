#!/usr/bin/env python3
"""Validate Skelet's zero-dependency upstream lock contract.

UPSTREAMS.lock.yml intentionally uses the JSON-compatible subset of YAML 1.2 so
bootstrap validation can run with the Python standard library only.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

SOURCE_KINDS = {"git", "website", "package", "dataset", "model"}
ROLES = {"base", "transplant", "adapter", "dataset", "reference", "fallback", "dev_gate"}
STATUSES = {"planned", "ready", "imported", "retired"}
PIN_POLICIES = {"git_commit_required", "content_hash_required", "release_digest_required"}
PERMISSION_TYPES = {"user_authorization", "upstream_license", "both"}
RIGHT_VALUES = {"authorized", "license-governed", "verify-at-import", "not-applicable", "restricted"}
RIGHT_KEYS = {"code", "data", "assets", "models", "services", "trademarks"}
SOURCE_KEYS = {
    "id",
    "source_url",
    "source_kind",
    "role",
    "status",
    "capability",
    "permission_basis",
    "license",
    "pin_policy",
    "exact_commit_or_release",
    "verification_date",
    "rights_scope",
    "imported_paths",
    "modifications",
}
MUTABLE_PINS = {"main", "master", "head", "latest", "stable", "dev", "develop", "trunk"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")
GIT_SHA_RE = re.compile(r"^[0-9a-fA-F]{40}$")
SHA256_RE = re.compile(r"^sha256:[0-9a-fA-F]{64}$")


def fail(errors: list[str], location: str, message: str) -> None:
    errors.append(f"{location}: {message}")


def valid_date(value: str) -> bool:
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def validate_source(source: Any, index: int, errors: list[str]) -> str | None:
    location = f"sources[{index}]"
    if not isinstance(source, dict):
        fail(errors, location, "must be an object")
        return None

    keys = set(source)
    missing = SOURCE_KEYS - keys
    extra = keys - SOURCE_KEYS
    if missing:
        fail(errors, location, f"missing required fields: {', '.join(sorted(missing))}")
    if extra:
        fail(errors, location, f"unknown fields: {', '.join(sorted(extra))}")
    if missing:
        return source.get("id") if isinstance(source.get("id"), str) else None

    source_id = source["id"]
    if not isinstance(source_id, str) or not ID_RE.fullmatch(source_id):
        fail(errors, f"{location}.id", "must match ^[a-z0-9][a-z0-9-]*$")
        source_id = None

    url = source["source_url"]
    if not isinstance(url, str) or not url.startswith("https://"):
        fail(errors, f"{location}.source_url", "must be an https:// URL")

    kind = source["source_kind"]
    if not isinstance(kind, str) or kind not in SOURCE_KINDS:
        fail(errors, f"{location}.source_kind", f"must be one of {sorted(SOURCE_KINDS)}")

    role = source["role"]
    if not isinstance(role, str) or role not in ROLES:
        fail(errors, f"{location}.role", f"must be one of {sorted(ROLES)}")

    status = source["status"]
    if not isinstance(status, str) or status not in STATUSES:
        fail(errors, f"{location}.status", f"must be one of {sorted(STATUSES)}")

    capability = source["capability"]
    if not isinstance(capability, str) or len(capability.strip()) < 3:
        fail(errors, f"{location}.capability", "must be a non-empty capability description")

    permission = source["permission_basis"]
    if not isinstance(permission, dict) or set(permission) != {"type", "note"}:
        fail(errors, f"{location}.permission_basis", "must contain exactly type and note")
    else:
        if not isinstance(permission["type"], str) or permission["type"] not in PERMISSION_TYPES:
            fail(errors, f"{location}.permission_basis.type", f"must be one of {sorted(PERMISSION_TYPES)}")
        if not isinstance(permission["note"], str) or len(permission["note"].strip()) < 3:
            fail(errors, f"{location}.permission_basis.note", "must be a non-empty note")

    license_value = source["license"]
    if not isinstance(license_value, str) or not license_value.strip():
        fail(errors, f"{location}.license", "must be a non-empty string")

    pin_policy = source["pin_policy"]
    if not isinstance(pin_policy, str) or pin_policy not in PIN_POLICIES:
        fail(errors, f"{location}.pin_policy", f"must be one of {sorted(PIN_POLICIES)}")

    if kind == "git" and pin_policy != "git_commit_required":
        fail(errors, f"{location}.pin_policy", "git sources must use git_commit_required")
    if kind == "website" and pin_policy != "content_hash_required":
        fail(errors, f"{location}.pin_policy", "website sources must use content_hash_required")
    if kind == "package" and pin_policy != "release_digest_required":
        fail(errors, f"{location}.pin_policy", "package sources must use release_digest_required")

    pin = source["exact_commit_or_release"]
    verification_date = source["verification_date"]

    if status == "planned":
        if pin is not None:
            fail(errors, f"{location}.exact_commit_or_release", "planned sources must remain unpinned until execution-time verification")
        if verification_date is not None:
            fail(errors, f"{location}.verification_date", "planned sources must not claim an execution-time verification date")
    elif isinstance(status, str) and status in {"ready", "imported", "retired"}:
        if not isinstance(pin, str) or not pin:
            fail(errors, f"{location}.exact_commit_or_release", f"{status} sources require an immutable pin")
        else:
            if pin.lower() in MUTABLE_PINS or pin.lower().startswith("refs/heads/"):
                fail(errors, f"{location}.exact_commit_or_release", "mutable branch/ref names are forbidden")
            if pin_policy == "git_commit_required" and not GIT_SHA_RE.fullmatch(pin):
                fail(errors, f"{location}.exact_commit_or_release", "git sources require a full 40-hex commit SHA")
            if isinstance(pin_policy, str) and pin_policy in {"content_hash_required", "release_digest_required"} and not SHA256_RE.fullmatch(pin):
                fail(errors, f"{location}.exact_commit_or_release", "content/release pins require sha256:<64 hex>")
        if not isinstance(verification_date, str) or not valid_date(verification_date):
            fail(errors, f"{location}.verification_date", f"{status} sources require an ISO YYYY-MM-DD verification date")
        elif date.fromisoformat(verification_date) > date.today():
            fail(errors, f"{location}.verification_date", "verification date cannot be in the future")
        if license_value == "VERIFY_AT_IMPORT":
            fail(errors, f"{location}.license", f"{status} sources cannot retain VERIFY_AT_IMPORT")

    rights = source["rights_scope"]
    if not isinstance(rights, dict) or set(rights) != RIGHT_KEYS:
        fail(errors, f"{location}.rights_scope", f"must contain exactly {sorted(RIGHT_KEYS)}")
    else:
        for key, value in rights.items():
            if not isinstance(value, str) or value not in RIGHT_VALUES:
                fail(errors, f"{location}.rights_scope.{key}", f"must be one of {sorted(RIGHT_VALUES)}")
        if isinstance(status, str) and status in {"ready", "imported", "retired"}:
            unresolved = sorted(key for key, value in rights.items() if value == "verify-at-import")
            if unresolved:
                fail(errors, f"{location}.rights_scope", f"{status} sources cannot retain verify-at-import: {', '.join(unresolved)}")

    for field in ("imported_paths", "modifications"):
        value = source[field]
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            fail(errors, f"{location}.{field}", "must be an array of strings")

    if status == "imported" and isinstance(source["imported_paths"], list) and not source["imported_paths"]:
        fail(errors, f"{location}.imported_paths", "imported sources must record imported paths")

    return source_id


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        return [f"{path}: cannot parse JSON-compatible YAML: {exc}"]

    if not isinstance(payload, dict):
        return ["root: must be an object"]
    if set(payload) != {"schema_version", "sources"}:
        fail(errors, "root", "must contain exactly schema_version and sources")
    if payload.get("schema_version") != "1":
        fail(errors, "schema_version", "must equal string '1'")

    sources = payload.get("sources")
    if not isinstance(sources, list):
        fail(errors, "sources", "must be an array")
        return errors

    seen_ids: set[str] = set()
    for index, source in enumerate(sources):
        source_id = validate_source(source, index, errors)
        if source_id:
            if source_id in seen_ids:
                fail(errors, f"sources[{index}].id", f"duplicate source id: {source_id}")
            seen_ids.add(source_id)

    return errors


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else Path("UPSTREAMS.lock.yml")
    errors = validate(path)
    if errors:
        print("UPSTREAMS_VALIDATION_FAILED", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    print(f"UPSTREAMS_VALIDATION_PASSED sources={len(payload['sources'])} path={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
