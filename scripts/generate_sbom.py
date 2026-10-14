#!/usr/bin/env python3
"""Generate a deterministic CycloneDX SBOM for the Skelet release record.

Reads `pnpm-lock.yaml` (lockfile v9 `packages`) and `requirements-ci.txt`
(hash-pinned Python dependencies) and writes a sorted CycloneDX 1.5 minimal
inventory to the repository-root `sbom.json`.

No network access. No new dependencies (stdlib plus PyYAML, already required
by the other qualification scripts). Deterministic: components sorted by
purl, unique purls, fixed schema. `metadata.repoHead` records the generating
head; `--check` compares components only so the file stays verifiable across
checkouts. Re-run after any dependency change and commit the result.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
SBOM_PATH = ROOT / "sbom.json"

REQUIREMENT_LINE = re.compile(r"^(?P<name>[A-Za-z0-9_.\-]+)==(?P<version>[^ ;\\]+)")


def npm_components(lock: dict) -> list[dict]:
    components = []
    for key in sorted((lock.get("packages", {}) or {})):
        name, _, version = key.rpartition("@")
        if not name or not version:
            continue
        components.append(
            {
                "name": name,
                "version": version,
                "purl": f"pkg:npm/{name}@{version}",
                "scope": "required",
                "type": "library",
            }
        )
    return components


def pypi_components(text: str) -> list[dict]:
    components = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = REQUIREMENT_LINE.match(line)
        if match:
            name, version = match.group("name"), match.group("version")
            components.append(
                {
                    "name": name,
                    "version": version,
                    "purl": f"pkg:pypi/{name}@{version}",
                    "scope": "required",
                    "type": "library",
                }
            )
    return components


def build_bom(repo_head: str) -> dict:
    lock = yaml.safe_load((ROOT / "pnpm-lock.yaml").read_text())
    requirements = (ROOT / "requirements-ci.txt").read_text()
    components = npm_components(lock) + pypi_components(requirements)
    components.sort(key=lambda c: c["purl"])
    purls = [c["purl"] for c in components]
    if len(set(purls)) != len(purls):
        raise ValueError("duplicate purls in SBOM inputs")
    return {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "metadata": {
            "component": {"name": "skelet"},
            "repoHead": repo_head,
        },
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="verify sbom.json components match current inputs")
    args = parser.parse_args()

    if args.check:
        current = json.loads(SBOM_PATH.read_text())
        fresh = build_bom(current["metadata"]["repoHead"])
        if current["components"] != fresh["components"]:
            print("sbom.json is stale: run python3 scripts/generate_sbom.py")
            return 1
        print(f"SBOM OK: {len(fresh['components'])} components")
        return 0

    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=ROOT
    ).stdout.strip()
    bom = build_bom(head)
    SBOM_PATH.write_text(json.dumps(bom, indent=2) + "\n")
    print(f"Wrote {SBOM_PATH}: {len(bom['components'])} components at {head}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
