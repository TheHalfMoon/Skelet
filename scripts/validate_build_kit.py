#!/usr/bin/env python3
"""Validate Skelet Lens Build Kit manifests (P09b frozen v1 contract).

Standard library only. Enforces the schema, the fixed export layout, the
ZIP path firewall, the rights firewall (unknown/restricted/trademarked
bytes MUST NOT be marked redistributable), and the lens report binding.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
STATUSES = {
    "queued", "capturing", "extracting", "generating", "validating",
    "completed", "partial", "failed", "canceled",
}
SCOPE_MODES = {"single-page", "selected-pages", "bounded-sitemap"}
VIEWPORTS = {"desktop", "mobile"}
KINDS = {
    "manifest", "report", "design-record", "tokens", "theme",
    "agent-pack", "screenshot", "starter-file", "asset-inventory",
}
CLASSIFICATIONS = {"permitted", "unknown", "restricted", "trademarked"}

# The G09-10 export surface, frozen into every kit. Paths are exact.
FIXED_ARTIFACTS = {
    "manifest.json": "manifest",
    "lens.json": "report",
    "DESIGN.md": "design-record",
    "tokens.dtcg.json": "tokens",
    "tailwind.theme.js": "theme",
    "shadcn-theme.css": "theme",
    "AGENT.md": "agent-pack",
}
# Prefix trees for generated/downloadable content. Nothing else is allowed.
PREFIX_KINDS = {
    "starter/": "starter-file",
    "screenshots/": "screenshot",
}


def fail(errors: list[str], location: str, message: str) -> None:
    errors.append(f"{location}: {message}")


def valid_path(path: object) -> bool:
    if not isinstance(path, str) or not path or len(path) > 256:
        return False
    if path.startswith("/") or "\\" in path or ".." in path.split("/"):
        return False
    if any(part in ("", ".") for part in path.split("/")):
        return False
    if path in FIXED_ARTIFACTS:
        return True
    return any(
        path.startswith(prefix) and len(path) > len(prefix)
        for prefix in PREFIX_KINDS
    )


def validate_rights(rights: object, location: str, errors: list[str]) -> None:
    if not isinstance(rights, dict) or set(rights) != {"classification", "redistributable"}:
        fail(errors, location, "rights must carry exactly classification and redistributable")
        return
    if rights["classification"] not in CLASSIFICATIONS:
        fail(errors, location, "rights.classification is out of contract")
    if not isinstance(rights["redistributable"], bool):
        fail(errors, location, "rights.redistributable must be a boolean")
        return
    if rights["redistributable"] and rights["classification"] != "permitted":
        fail(errors, location, "only permitted bytes may be marked redistributable")


def validate_manifest(data: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["manifest: must be an object"]
    if data.get("schema_version") != "skelet.lens.build-kit.v1":
        fail(errors, "schema_version", "must be skelet.lens.build-kit.v1")
    for key in ("kit_id", "analysis_id"):
        if not isinstance(data.get(key), str) or not HEX64_RE.match(data[key]):
            fail(errors, key, "must be 64 lowercase hex chars")
    if data.get("status") not in STATUSES:
        fail(errors, "status", "is out of contract")
    report = data.get("lens_report")
    if not isinstance(report, dict):
        fail(errors, "lens_report", "must be an object")
    else:
        if report.get("schema") != "skelet.lens.report.v1":
            fail(errors, "lens_report.schema", "must be skelet.lens.report.v1")
        if report.get("analysis_id") != data.get("analysis_id"):
            fail(errors, "lens_report.analysis_id", "must equal the kit analysis_id")
        if not isinstance(report.get("sha256"), str) or not HEX64_RE.match(report["sha256"]):
            fail(errors, "lens_report.sha256", "must be 64 lowercase hex chars")
    scope = data.get("capture_scope")
    if not isinstance(scope, dict):
        fail(errors, "capture_scope", "must be an object")
    else:
        if scope.get("mode") not in SCOPE_MODES:
            fail(errors, "capture_scope.mode", "is out of contract")
        for key, lo, hi in (
            ("max_pages", 1, 25), ("max_depth", 0, 3),
            ("max_bytes", 1, 52428800), ("time_budget_ms", 1000, 600000),
        ):
            value = scope.get(key)
            if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
                fail(errors, f"capture_scope.{key}", "is out of range")
    pages = data.get("pages")
    if not isinstance(pages, list) or not 1 <= len(pages) <= 25:
        fail(errors, "pages", "must list 1..25 pages")
    else:
        for i, page in enumerate(pages):
            loc = f"pages[{i}]"
            if not isinstance(page, dict):
                fail(errors, loc, "must be an object")
                continue
            url = page.get("url")
            if not isinstance(url, str) or not url.startswith("https://") or len(url) > 2048:
                fail(errors, f"{loc}.url", "must be an https URL within 2048 chars")
            if not isinstance(page.get("sha256"), str) or not HEX64_RE.match(page["sha256"]):
                fail(errors, f"{loc}.sha256", "must be 64 lowercase hex chars")
            if page.get("viewport") not in VIEWPORTS:
                fail(errors, f"{loc}.viewport", "is out of contract")
    artifacts = data.get("artifacts")
    if not isinstance(artifacts, list) or not 1 <= len(artifacts) <= 500:
        fail(errors, "artifacts", "must list 1..500 artifacts")
        return errors
    seen: set[str] = set()
    for i, artifact in enumerate(artifacts):
        loc = f"artifacts[{i}]"
        if not isinstance(artifact, dict):
            fail(errors, loc, "must be an object")
            continue
        path = artifact.get("path")
        if not valid_path(path):
            fail(errors, f"{loc}.path", "is not an allowed kit path")
            continue
        if path in seen:
            fail(errors, f"{loc}.path", "duplicate artifact path")
        seen.add(path)
        expected_kind = FIXED_ARTIFACTS.get(path)
        if expected_kind is not None:
            if artifact.get("kind") != expected_kind:
                fail(errors, f"{loc}.kind", f"{path} must be kind {expected_kind}")
        else:
            for prefix, kind in PREFIX_KINDS.items():
                if path.startswith(prefix) and artifact.get("kind") != kind:
                    fail(errors, f"{loc}.kind", f"{prefix} entries must be kind {kind}")
        if artifact.get("kind") not in KINDS:
            fail(errors, f"{loc}.kind", "is out of contract")
        if not isinstance(artifact.get("sha256"), str) or not HEX64_RE.match(artifact["sha256"]):
            fail(errors, f"{loc}.sha256", "must be 64 lowercase hex chars")
        size = artifact.get("bytes")
        if not isinstance(size, int) or isinstance(size, bool) or not 1 <= size <= 16777216:
            fail(errors, f"{loc}.bytes", "is out of range")
        validate_rights(artifact.get("rights"), f"{loc}.rights", errors)
    for path, kind in FIXED_ARTIFACTS.items():
        if path not in seen:
            fail(errors, "artifacts", f"missing required export {path}")
    policy = data.get("rights_policy")
    if not isinstance(policy, dict) or policy.get("default_classification") != "unknown":
        fail(errors, "rights_policy", "default_classification must be unknown")
    provenance = data.get("provenance")
    if not isinstance(provenance, dict):
        fail(errors, "provenance", "must be an object")
        return errors
    for key in ("observed", "deterministic", "coverage_gaps"):
        values = provenance.get(key)
        if not isinstance(values, list) or any(not isinstance(v, str) or not v for v in values):
            fail(errors, f"provenance.{key}", "must be a string list")
    if provenance.get("heuristic") != [] or provenance.get("model_generated") != []:
        fail(errors, "provenance", "v1 kits carry no heuristic or model-generated content")
    if provenance.get("generated_label") != "generated-starter-is-skelet-synthesis-not-original-source":
        fail(errors, "provenance.generated_label", "is out of contract")
    return errors


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    fixture = root / "fixtures" / "build-kit" / "manifest.valid.json"
    try:
        data = json.loads(fixture.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"BUILD_KIT_VALIDATION_FAILED fixture unreadable: {exc}")
        return 1
    errors = validate_manifest(data)
    if errors:
        print("BUILD_KIT_VALIDATION_FAILED")
        for error in errors:
            print(f"  - {error}")
        return 1
    print("BUILD_KIT_VALIDATION_PASSED fixture=fixtures/build-kit/manifest.valid.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
