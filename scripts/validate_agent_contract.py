#!/usr/bin/env python3
"""Validate Skelet agent-contract fixtures (AF-03a frozen v1).

Standard library only. Enforces the versioned result envelope, the typed
error taxonomy, stable Skelet URI patterns, and the evidence-mode
vocabulary shared by MCP, REST, SDK, and CLI. Behavior parity lands in
later AF-03 grains; this gate freezes the contract first.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = "skelet.agent.v1"
STATUSES = {"complete", "partial"}
ERROR_CODES = {
    "INVALID_INPUT",
    "UNAUTHENTICATED",
    "FORBIDDEN_OR_NOT_FOUND",
    "NOT_AVAILABLE",
    "RIGHTS_RESTRICTED",
    "STALE_REVISION",
    "RATE_LIMITED",
    "QUOTA_EXCEEDED",
    "PROVIDER_DISABLED",
    "JOB_PENDING",
    "JOB_FAILED",
    "TIMEOUT",
    "INTERNAL_OPAQUE",
}
EVIDENCE_MODES = {
    "observed",
    "deterministic-computation",
    "heuristic-inference",
    "generated-by-external-agent",
    "unknown",
}
URI_RE = re.compile(
    r"^skelet://(product|version|artifact|flow|collection|lens|reference-pack)/[A-Za-z0-9_\-]{1,128}$"
)
TOOL_NAMES = {
    "search_assets",
    "get_asset",
    "get_registry_item",
    "save_reference",
    "create_reference_pack",
    "get_object",
}


def fail(errors: list[str], location: str, message: str) -> None:
    errors.append(f"{location}: {message}")


def validate_error(error: object, location: str, errors: list[str]) -> None:
    if not isinstance(error, dict):
        fail(errors, location, "error must be an object")
        return
    if set(error) - {"code", "message", "retryable"}:
        fail(errors, location, "error carries unknown fields")
    if error.get("code") not in ERROR_CODES:
        fail(errors, location, "error.code is out of contract")
    message = error.get("message")
    if not isinstance(message, str) or not message or len(message) > 512:
        fail(errors, location, "error.message must be 1..512 chars")
    if "retryable" in error and not isinstance(error["retryable"], bool):
        fail(errors, location, "error.retryable must be a boolean")


def validate_envelope(data: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["envelope: must be an object"]
    allowed = {
        "schema_version", "request_id", "status", "result",
        "cursor", "warnings", "error", "provenance",
    }
    unknown = set(data) - allowed
    if unknown:
        fail(errors, "envelope", f"unknown fields: {sorted(unknown)}")
    if data.get("schema_version") != SCHEMA_VERSION:
        fail(errors, "envelope", "schema_version must be skelet.agent.v1")
    request_id = data.get("request_id")
    if not isinstance(request_id, str) or not request_id or len(request_id) > 128:
        fail(errors, "envelope", "request_id must be 1..128 chars")
    if data.get("status") not in STATUSES:
        fail(errors, "envelope", "status must be complete or partial")
    if not isinstance(data.get("result"), dict):
        fail(errors, "envelope", "result must be an object")
    if "cursor" in data and (
        not isinstance(data["cursor"], str) or len(data["cursor"]) > 256
    ):
        fail(errors, "envelope", "cursor must be a string of at most 256 chars")
    if "warnings" in data:
        warnings = data["warnings"]
        if not isinstance(warnings, list) or len(warnings) > 16:
            fail(errors, "envelope", "warnings must be a list of at most 16 items")
        elif any(not isinstance(w, str) or not w or len(w) > 512 for w in warnings):
            fail(errors, "envelope", "warnings items must be 1..512 chars")
    if "error" in data:
        validate_error(data["error"], "envelope.error", errors)
    if "provenance" in data:
        provenance = data["provenance"]
        if not isinstance(provenance, dict):
            fail(errors, "envelope.provenance", "provenance must be an object")
        else:
            if provenance.get("evidence_mode") not in EVIDENCE_MODES:
                fail(errors, "envelope.provenance", "evidence_mode is out of contract")
            for field in ("source_uri", "captured_at"):
                if field in provenance and (
                    not isinstance(provenance[field], str)
                    or not provenance[field]
                    or len(provenance[field]) > 2048
                ):
                    fail(errors, "envelope.provenance", f"{field} must be 1..2048 chars")
    return errors


def validate_uri(value: object) -> list[str]:
    if not isinstance(value, str) or not URI_RE.match(value):
        return [f"uri: out of contract: {value!r}"]
    return []


def main(argv: list[str]) -> int:
    root = Path(__file__).resolve().parents[1]
    fixture_dir = root / "fixtures" / "agent-contract"
    errors: list[str] = []
    if not fixture_dir.is_dir():
        print(f"AGENT_CONTRACT_FAILED\n- missing fixture dir: {fixture_dir}")
        return 1
    for path in sorted(fixture_dir.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{path.name}: unreadable fixture: {exc}")
            continue
        if path.name.startswith("valid-"):
            errors.extend(f"{path.name}: {e}" for e in validate_envelope(data))
            for key in ("uri", "source_uri"):
                if isinstance(data, dict):
                    target = data.get(key)
                    if target is not None:
                        errors.extend(f"{path.name}: {e}" for e in validate_uri(target))
                    result = data.get("result")
                    if isinstance(result, dict) and key in result:
                        errors.extend(
                            f"{path.name}: {e}" for e in validate_uri(result[key])
                        )
        elif path.name.startswith("invalid-"):
            if not validate_envelope(data):
                errors.append(f"{path.name}: invalid fixture unexpectedly validates")
        else:
            errors.append(f"{path.name}: fixture name must start with valid- or invalid-")
    if errors:
        print("AGENT_CONTRACT_FAILED", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("AGENT_CONTRACT_PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
