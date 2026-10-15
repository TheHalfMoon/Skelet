#!/usr/bin/env python3
"""AC-00-ii frame-extractor dependency-closure inventory (ArtCraft P10 candidate).

Fetches the 2 frozen frame-extractor files at the AF-01 pinned
artcraft-services commit, verifies every git blob SHA, parses import
specifiers, and records external packages, alias imports, asset
references, and capability flags (CSS, storage APIs, network, workers,
Tauri, WASM, media APIs, SSR risk) into
imports/craft-suite/frame-extractor-closure.json.

Standard library only. Network access (GitHub API) is required to RUN
this audit; the committed JSON output is validated offline by
tests/test_frame_extractor_closure.py, so CI never touches the network.
Engineer usage:
  GH_TOKEN=$(gh auth token) python3 scripts/audit_frame_extractor_closure.py
No donor code is imported by this script: blobs are inspected in memory
and only the inventory JSON is written.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import ssl
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "imports" / "craft-suite" / "frame-extractor-closure.json"

DONOR = "artcraft-services"
SOURCE_URL = "https://github.com/storytold/artcraft-services"
PINNED_COMMIT = "02a3de2509662cfc7c12f51c09e7f4322618029a"

# Frozen tree enumeration at PINNED_COMMIT (path -> git blob SHA).
# Sourced from the GitHub contents API; the SHAs match the AF-01
# donor-pins key_files for artcraft-services. frame-actions.ts is listed
# because it exists beside the candidate, but it is marked excluded: it
# couples to the ArtCraft provider API, router, and create-page stores.
FILES = {
    "frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/extract-frames.ts": "b7f40f26446ff04053fe231683af3f975359b755",
    "frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/frame-actions.ts": "cbe779a0410ed6e07ee5fb078d7d44f82b3e21c1",
}

EXCLUDED = ["frontend/apps/artcraft-webapp/src/pages/frame-extractor/lib/frame-actions.ts"]

IMPORT_RE = re.compile(r"""(?:^|\s)(?:import\s+(?:[^'\"]*?\s+from\s+)?|export\s+(?:[^'\"]*?\s+from\s+)?|import\()\s*['\"]([^'\"]+)['\"]""")
REQUIRE_RE = re.compile(r"""require\(\s*['\"]([^'\"]+)['\"]\s*\)""")

FLAG_PATTERNS = {
    "css_import": re.compile(r"\.css['\"]"),
    "url_reference": re.compile(r"\burl\(\s*['\"]?[^)'\"]"),
    "network_fetch": re.compile(r"\b(fetch|axios|XMLHttpRequest|EventSource|WebSocket)\b"),
    "worker": re.compile(r"\b(new\s+Worker|SharedWorker|serviceWorker|navigator\.serviceWorker)\b"),
    "storage": re.compile(r"\b(localStorage|sessionStorage|indexedDB)\b"),
    "tauri": re.compile(r"@tauri-apps|__TAURI__"),
    "wasm": re.compile(r"\.wasm|WebAssembly"),
    "media_api": re.compile(r"\b(HTMLVideoElement|HTMLCanvasElement|canvas\.getContext|AudioContext|URL\.createObjectURL)\b"),
    "ssr_risk": re.compile(r"^\s*(const|let|var)\s+\w+\s*=\s*(window|document|navigator|localStorage)"),
}


def classify(spec: str) -> str:
    if spec.startswith("."):
        return "relative"
    if spec.startswith("@storyteller/") or spec.startswith("@/") or spec.startswith("~/"):
        return "alias"
    if spec.startswith("node:") or spec in ("react", "react-dom"):
        return "runtime"
    return "external"


def git_blob_sha(content: bytes) -> str:
    return hashlib.sha1(b"blob %d\0" % len(content) + content).hexdigest()


def api_get(url: str, token: str | None) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    if token:
        request.add_header("Authorization", "Bearer " + token)
    try:
        import certifi  # Local audit-time CA bundle; CI never runs this.

        context: ssl.SSLContext | None = ssl.create_default_context(cafile=certifi.where())
    except (ImportError, ssl.SSLError):
        context = None
    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        return json.loads(response.read().decode("utf-8"))


def analyze_text(text: str) -> tuple[dict[str, list[str]], dict[str, bool]]:
    specs: dict[str, set[str]] = {"relative": set(), "alias": set(), "external": set(), "runtime": set()}
    for pattern in (IMPORT_RE, REQUIRE_RE):
        for match in pattern.finditer(text):
            spec = match.group(1)
            specs[classify(spec)].add(spec)
    flags = {name: bool(pattern.search(text)) for name, pattern in FLAG_PATTERNS.items()}
    return ({key: sorted(value) for key, value in specs.items()}, flags)


def main() -> int:
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    files = []
    external: dict[str, list[str]] = {}
    for path in sorted(FILES):
        expected = FILES[path]
        try:
            payload = api_get(
                "https://api.github.com/repos/storytold/artcraft-services/git/blobs/" + expected, token
            )
        except Exception as error:
            print(f"BLOB FETCH FAILED {path} sha={expected}: {error}", file=sys.stderr)
            return 1
        content = base64.b64decode(payload["content"])
        actual = git_blob_sha(content)
        if actual != expected:
            print(f"SHA MISMATCH {path}: tree says {expected}, blob hashes {actual}", file=sys.stderr)
            return 1
        text = content.decode("utf-8", errors="replace")
        imports, flags = analyze_text(text)
        for spec in imports["external"]:
            external.setdefault(spec.split("/")[0], []).append(path)
        files.append(
            {
                "path": path,
                "sha": expected,
                "size": len(content),
                "excluded": path in EXCLUDED,
                "imports": imports,
                "flags": flags,
            }
        )
    record = {
        "schema_version": "1",
        "grain": "AC-00-ii",
        "donor": DONOR,
        "source_url": SOURCE_URL,
        "pinned_commit": PINNED_COMMIT,
        "file_count": len(files),
        "files": files,
        "external_packages": sorted(external),
        "generated_note": "Inspected in memory at audit time; no donor code imported.",
    }
    OUT_PATH.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"FRAME_EXTRACTOR_CLOSURE_OK files={len(files)} external={len(external)} path={OUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
