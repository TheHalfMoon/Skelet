"""Fail-closed, offline preflight for the pinned Monet code-only source snapshot.

This command never imports donor files, downloads data, or activates runtime code.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "imports" / "monet-registry" / "manifest.json"
SOURCE_TREE = ROOT / "imports" / "monet-registry" / "source-tree.tsv"

CODE_SUFFIXES = frozenset({".ts", ".tsx", ".mts", ".mjs", ".js", ".css", ".json", ".yaml", ".yml"})
BRAND_MARKERS = ("vooster", "landing-mon-template", "monet", "saaspo", "unsection")
IDENTITY_CONFIG = frozenset({"src/config/site-data.json", "src/config/site.tsx"})
SHA1 = re.compile(r"^[0-9a-f]{40}$")


class AuditError(ValueError):
    """Invalid donor identity, scope, source bytes, or manifest."""


def source_blob_hash(content: bytes) -> str:
    header = f"blob {len(content)}\0".encode("ascii")
    return hashlib.sha1(header + content).hexdigest()


def selected_by_policy(path: str, policy: dict) -> bool:
    return path in policy["include_exact"] or any(
        path.startswith(prefix) for prefix in policy["include_prefixes"]
    )


def audit_snapshot(source: Path, manifest: dict, rows: list[dict[str, str]]) -> dict:
    """Verify every selected blob and partition it without copying any bytes."""
    if manifest.get("state") != "ready-code-snapshot":
        raise AuditError("The Monet code-only rights gate is not canonical-ready.")
    if manifest.get("activation_allowed") is not False:
        raise AuditError("Runtime activation must remain explicitly disabled.")
    if manifest.get("rights_gate", {}).get("status") != "resolved-code-only":
        raise AuditError("Code-only authorization has not been recorded.")
    if not source.is_dir():
        raise AuditError("The source directory does not exist.")
    root = source.resolve(strict=True)
    policy = manifest["classification_policy"]
    seen: set[str] = set()
    qualified: list[dict] = []
    quarantined: list[dict] = []
    selected_bytes = 0

    for row in rows:
        path = row["path"]
        parts = PurePosixPath(path)
        raw_parts = path.split("/")
        if (not path or path.startswith("/") or "\\" in path
                or any(part in {"", ".", ".."} for part in raw_parts)
                or parts.as_posix() != path):
            raise AuditError(f"Invalid source path: {path}")
        if path in seen:
            raise AuditError(f"Duplicate source path: {path}")
        seen.add(path)
        if not selected_by_policy(path, policy):
            continue
        sha = row["sha"]
        if row.get("mode") not in {"100644", "100755"}:
            raise AuditError(f"Unsupported source file mode: {path}")
        if not SHA1.fullmatch(sha):
            raise AuditError(f"Invalid Git object identity: {path}")
        target = source.joinpath(*parts.parts)
        if target.is_symlink() or not target.is_file():
            raise AuditError(f"Missing or symlinked selected source: {path}")
        if not target.resolve(strict=True).is_relative_to(root):
            raise AuditError(f"Source path escapes the pinned root: {path}")
        content = target.read_bytes()
        if len(content) != int(row["size"]) or source_blob_hash(content) != sha:
            raise AuditError(f"Blob SHA/size mismatch: {path}")
        selected_bytes += len(content)
        reasons: list[str] = []
        if parts.suffix.lower() not in CODE_SUFFIXES:
            reasons.append("non_code_or_docs")
        if path in IDENTITY_CONFIG:
            reasons.append("donor_identity_configuration")
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            reasons.append("non_utf8_content")
        else:
            if not text.isascii():
                reasons.append("non_english_or_unicode_content")
            if any(marker in text.lower() for marker in BRAND_MARKERS):
                reasons.append("donor_identity_reference")
        record = {"path": path, "sha": sha, "bytes": len(content)}
        if reasons:
            quarantined.append({**record, "reasons": sorted(set(reasons))})
        else:
            qualified.append(record)

    if not qualified and not quarantined:
        raise AuditError("The pinned manifest selects no source blobs.")
    return {
        "schema_version": "1",
        "state": "preflight_only_not_imported",
        "source_id": manifest["source_id"],
        "source_url": manifest["source_url"],
        "source_commit": manifest["observed_commit"],
        "source_tree": manifest["observed_tree"],
        "runtime_activation_allowed": False,
        "total_selected": len(qualified) + len(quarantined),
        "total_verified_bytes": selected_bytes,
        "code_candidates": qualified,
        "quarantined": quarantined,
        "limitations": [
            "Candidates are not yet copied into the Skelet repository.",
            "Candidate files are not independently runtime-qualified.",
            "Quarantine requires human review and safe English-language adaptation.",
            "Dataset, screenshot, asset, model, service, and trademark rights remain excluded.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    with SOURCE_TREE.open(encoding="utf-8", newline="") as source_file:
        rows = list(csv.DictReader(source_file, delimiter="\t"))
    report = audit_snapshot(args.source, manifest, rows)
    content = json.dumps(report, sort_keys=True, indent=2, ensure_ascii=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(content, encoding="utf-8", newline="\n")
    else:
        print(content, end="")
    print(
        f"MONET_PREFLIGHT_PASSED selected={report['total_selected']} "
        f"candidates={len(report['code_candidates'])} "
        f"quarantined={len(report['quarantined'])}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
