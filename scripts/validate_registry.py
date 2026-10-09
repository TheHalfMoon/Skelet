"""Validate the Skelet shadcn-compatible component registry.

Checks the index against its item documents: every indexed entry must
resolve to an item file, every item must satisfy the registry contract
(name/type/title/description, dependency lists, at least one file with
path and non-empty content), and names must be unique. Exits nonzero
with a fail-closed message on the first violation.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_DIR = WEB_ROOT / "apps" / "web" / "registry"

REQUIRED_ITEM_FIELDS = ("name", "type", "title", "description")
REQUIRED_LIST_FIELDS = ("dependencies", "devDependencies", "registryDependencies")


def read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"unreadable: {error}") from error


def item_path_for(directory: Path, name: str) -> Path | None:
    if not re.fullmatch(r"skelet-[a-z0-9-]+", name):
        return None
    candidate_path = directory / f"{name}.json"
    try:
        if candidate_path.is_file() and candidate_path.resolve().is_relative_to(directory.resolve()):
            return candidate_path
    except (OSError, ValueError):
        return None
    return None


def validate_file_entry(name: str, file) -> str | None:
    if (
        not isinstance(file, dict)
        or not isinstance(file.get("path"), str)
        or not re.fullmatch(r"components/[A-Za-z0-9][A-Za-z0-9/_.-]*\.tsx", file["path"])
        or ".." in file["path"]
        or not isinstance(file.get("content"), str)
        or not file["content"]
    ):
        return f"item {name} file entry invalid"
    return None


def validate_item(name: str, item) -> str | None:
    if not isinstance(item, dict) or item.get("name") != name:
        return f"item identity mismatch: {name}"
    for field in REQUIRED_ITEM_FIELDS:
        if not isinstance(item.get(field), str) or not item[field]:
            return f"item {name} field invalid: {field}"
    for field in REQUIRED_LIST_FIELDS:
        if not isinstance(item.get(field), list):
            return f"item {name} list invalid: {field}"
    files = item.get("files")
    if not isinstance(files, list) or not files:
        return f"item {name} must ship at least one file"
    for file in files:
        error = validate_file_entry(name, file)
        if error is not None:
            return error
    return None


def validate(directory: Path) -> list[str]:
    """Return a list of violations; empty means the registry is valid."""
    try:
        index = read_json(directory / "registry.json")
    except ValueError as error:
        return [f"index {error}"]
    if not isinstance(index, dict) or not isinstance(index.get("version"), str):
        return ["index must carry a version"]
    entries = index.get("items")
    if not isinstance(entries, list) or not entries:
        return ["index must list at least one item"]
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            return ["index entries must name an item"]
        name = entry["name"]
        if name in seen:
            return [f"duplicate index entry: {name}"]
        seen.add(name)
        item_path = item_path_for(directory, name)
        if item_path is None:
            return [f"missing item document for: {name}"]
        try:
            item = read_json(item_path)
        except ValueError as error:
            return [f"item {name} {error}"]
        error = validate_item(name, item)
        if error is not None:
            return [error]
    return []


def main() -> int:
    errors = validate(REGISTRY_DIR)
    if errors:
        print(f"REGISTRY_VALIDATION_FAILED {errors[0]}", file=sys.stderr)
        return 1
    count = len(json.loads((REGISTRY_DIR / "registry.json").read_text(encoding="utf-8"))["items"])
    print(f"REGISTRY_VALIDATION_PASSED items={count} path={REGISTRY_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
