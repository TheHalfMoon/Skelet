"""Validate Skelet agent skill packages.

Each skill directory must carry a SKILL.md with exact frontmatter (name
matching the directory, non-empty description), reference only known
tools (implemented, or upcoming with explicit gating), keep every cited
Skelet URI well-formed, and contain no denied instructions. Backtick
spans outside the known tools, URIs/paths, and the documentation
vocabulary below fail closed; extend DOC_VOCABULARY when legitimate new
field words are introduced. Exits nonzero on the first violation.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"

EXPECTED_SKILLS = ("skelet-research", "skelet-assets", "skelet-lens", "skelet-reference-pack")

IMPLEMENTED_TOOLS = frozenset(
    {
        "search_assets",
        "get_asset",
        "get_registry_item",
        "save_reference",
        "create_reference_pack",
        "get_object",
    }
)
UPCOMING_TOOLS = frozenset(
    {
        "analyze_url",
        "analyze_image",
        "find_similar",
        "compare_design",
        "get_changes",
        "search_registry",
    }
)
GATING_MARKERS = ("lands", "until then", "upcoming", "later phase", "deferred", "do not invoke", "do not promise")

DENIED_PHRASES = (
    r"\bembed restricted\b",
    r"\bbypass\b",
    r"\bdisable (authentication|auth)\b",
    r"\buse file:",
    r"\bunsandboxed\b",
    r"\bignore the serving\b",
)

SNAKE_FIELDS = frozenset({"artifact_ids", "workspace_id", "reference_pack"})

URI_PATTERN = re.compile(r"skelet://[a-z-]+/[A-Za-z0-9_.-]+")
TOOL_PATTERN = re.compile(r"`([^`]+)`")

# Non-tool backtick vocabulary: field names, values, paths, and component
# identifiers the skills legitimately quote. Anything outside the known
# tools, URIs/paths, and this set fails closed as an unknown reference.
DOC_VOCABULARY = frozenset(
    {
        "@/lib/utils",
        "TODO",
        "artifactId",
        "artifactIds",
        "download",
        "font",
        "http(s)",
        "icon",
        "items",
        "kinds",
        "license",
        "limit",
        "logo",
        "metadata-only",
        "query",
        "rights",
        "serving",
        "serving: download",
        "servingReason",
        "skelet-button",
        "skelet-card",
        "skelet/reference-pack/1",
        "title",
        "workspaceId",
    }
)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str] | None:
    if not text.startswith("---\n"):
        return None
    closing = text.find("\n---\n", 4)
    if closing < 0:
        return None
    fields: dict[str, str] = {}
    for line in text[4:closing].splitlines():
        if ":" not in line:
            return None
        key, _, value = line.partition(":")
        fields[key.strip()] = value.strip()
    return fields, text[closing + 5 :]


def validate_skill(directory: Path) -> list[str]:
    name = directory.name
    if name not in EXPECTED_SKILLS:
        return [f"unexpected skill package: {name}"]
    path = directory / "SKILL.md"
    if not path.is_file():
        return [f"skill {name} is missing SKILL.md"]
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return [f"skill {name} unreadable: {error}"]
    parsed = parse_frontmatter(text)
    if parsed is None:
        return [f"skill {name} frontmatter is invalid"]
    fields, body = parsed
    if fields.get("name") != name:
        return [f"skill {name} frontmatter name mismatch"]
    if not fields.get("description"):
        return [f"skill {name} description is empty"]
    if len(body.strip()) < 200:
        return [f"skill {name} body is too short to guide an agent"]
    tools = set(TOOL_PATTERN.findall(body))
    unknown = {
        span
        for span in tools
        if span not in IMPLEMENTED_TOOLS
        and span not in UPCOMING_TOOLS
        and "://" not in span
        and "/" not in span
        and span not in DOC_VOCABULARY
    }
    if unknown:
        return [f"skill {name} references unknown tools: {sorted(unknown)}"]
    upcoming = tools & UPCOMING_TOOLS
    lowered = body.lower()
    if upcoming and not any(marker in lowered for marker in GATING_MARKERS):
        return [f"skill {name} references upcoming tools without gating: {sorted(upcoming)}"]
    for span in re.findall(r"skelet://\S+", body):
        candidate = re.sub(r"\{[^}]*\}", "x", span).rstrip(".,:)]}'\"`")
        if URI_PATTERN.fullmatch(candidate) is None:
            return [f"skill {name} cites a malformed Skelet URI: {span}"]
    bare = set(re.findall(r"(?<![`/\w])[a-z]+(?:_[a-z]+)+(?![\w`])", body))
    stray = bare - IMPLEMENTED_TOOLS - UPCOMING_TOOLS - SNAKE_FIELDS
    if stray:
        return [f"skill {name} references ungated tool-like words: {sorted(stray)}"]
    for pattern in DENIED_PHRASES:
        if re.search(pattern, lowered):
            return [f"skill {name} contains a denied instruction: {pattern}"]
    return []


def validate(directory: Path = SKILLS_DIR) -> list[str]:
    if not directory.is_dir():
        return ["skills directory is missing"]
    present = sorted(path.name for path in directory.iterdir() if path.is_dir())
    if present != sorted(EXPECTED_SKILLS):
        return [f"skill set mismatch: {present}"]
    for name in EXPECTED_SKILLS:
        errors = validate_skill(directory / name)
        if errors:
            return errors
    return []


def main() -> int:
    errors = validate()
    if errors:
        print(f"SKILLS_VALIDATION_FAILED {errors[0]}", file=sys.stderr)
        return 1
    print(f"SKILLS_VALIDATION_PASSED skills={len(EXPECTED_SKILLS)} path={SKILLS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
