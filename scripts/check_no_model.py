#!/usr/bin/env python3
"""AF-02 zero-model and egress conformance gate for Skilit.

Mandatory Skilit path runs with no model API key, no GPU, and no paid
cloud subscription. This gate fails closed when strict zero-model mode is
enabled and a forbidden model or paid-provider credential is present, when
SKILIT_NO_MODEL is not an explicit state, or when runtime source outside
the canonical policy references unapproved model or paid-cloud egress.

The TypeScript module packages/no-model/src/no-model.ts is canonical for
runtime guards. This script mirrors its deny lists for CI static checks
and clean-environment validation. If the lists diverge, update both and
the Node conformance suite together.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

FORBIDDEN_MODEL_ENV_VARS = (
    "ANTHROPIC_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "COHERE_API_KEY",
    "DEEPSEEK_API_KEY",
    "ELEVENLABS_API_KEY",
    "EMBEDDINGS_API_KEY",
    "FIRECRAWL_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_KEY",
    "GROQ_API_KEY",
    "HF_TOKEN",
    "HUGGINGFACE_API_KEY",
    "LLM_API_KEY",
    "MISTRAL_API_KEY",
    "MODEL_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_ORG",
    "OPENROUTER_API_KEY",
    "PERPLEXITY_API_KEY",
    "REPLICATE_API_TOKEN",
    "STABILITY_API_KEY",
    "TOGETHER_API_KEY",
    "XAI_API_KEY",
    "ALGOLIA_API_KEY",
    "PINECONE_API_KEY",
    "QDRANT_API_KEY",
    "WEAVIATE_API_KEY",
    "ARTCRAFT_API_KEY",
)

UNAPPROVED_EGRESS_HOSTS = (
    "api.anthropic.com",
    "api.cohere.com",
    "api.deepseek.com",
    "api.elevenlabs.io",
    "api.firecrawl.dev",
    "api.fireworks.ai",
    "api.groq.com",
    "api.huggingface.co",
    "api.mistral.ai",
    "api.openai.com",
    "api.openrouter.ai",
    "api.perplexity.ai",
    "api.replicate.com",
    "api.runpod.ai",
    "api.stability.ai",
    "api.together.xyz",
    "api.x.ai",
    "aiplatform.googleapis.com",
    "generativelanguage.googleapis.com",
    "inference.huggingface.co",
    "api-inference.huggingface.co",
    "api.pinecone.io",
    "api.algolia.net",
    "api.weaviate.cloud",
    "api.qdrant.cloud",
    "api.scrapingbee.com",
)

SCAN_ROOTS = ("apps", "packages", "scripts")
SCAN_SUFFIXES = (".ts", ".tsx", ".mjs", ".js", ".py")
SCAN_EXCLUDE_PREFIXES = (
    "packages/no-model/",
    "scripts/check_no_model.py",
    "docs/",
    ".github/",
)


def parse_no_model_flag(raw: str | None) -> bool:
    if raw is None:
        return True
    if raw == "1":
        return True
    if raw == "0":
        return False
    raise ValueError('SKILIT_NO_MODEL must be "1" or "0".')


def forbidden_present(env: dict[str, str]) -> list[str]:
    present = [name for name in FORBIDDEN_MODEL_ENV_VARS if env.get(name)]
    return sorted(present)


def scan_unapproved_egress(root: Path) -> list[str]:
    violations: list[str] = []
    for scan_root in SCAN_ROOTS:
        base = root / scan_root
        if not base.exists():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix not in SCAN_SUFFIXES:
                continue
            rel = path.relative_to(root).as_posix()
            if any(rel.startswith(prefix) for prefix in SCAN_EXCLUDE_PREFIXES):
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            lowered = text.lower()
            for host in UNAPPROVED_EGRESS_HOSTS:
                if host in lowered:
                    violations.append(f"{rel}: unapproved egress host {host}")
    return sorted(violations)


def check_repository(root: Path, env: dict[str, str]) -> list[str]:
    errors: list[str] = []
    try:
        # Canonical SKILIT_NO_MODEL; legacy SKELET_NO_MODEL remains readable.
        raw = env.get("SKILIT_NO_MODEL", env.get("SKELET_NO_MODEL"))
        enabled = parse_no_model_flag(raw)
    except ValueError as exc:
        return [str(exc)]
    if enabled:
        present = forbidden_present(env)
        if present:
            errors.append(
                "Zero-model mode forbids credentials: " + ", ".join(present) + "."
            )
    errors.extend(scan_unapproved_egress(root))
    required = [
        root / "packages" / "no-model" / "src" / "no-model.ts",
        root / "packages" / "no-model" / "tests" / "no-model.test.mjs",
        root / "fixtures" / "build-kit",
        root / "schemas" / "lens-build-kit.schema.json",
    ]
    for path in required:
        if not path.exists():
            errors.append(f"required no-model fixture missing: {path.name}")
    return errors


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args(argv[1:])
    root = args.root.resolve()
    errors = check_repository(root, dict(os.environ))
    if errors:
        print("NO_MODEL_GATE_FAILED", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    enabled = parse_no_model_flag(os.environ.get("SKILIT_NO_MODEL", os.environ.get("SKELET_NO_MODEL")))
    mode = "strict" if enabled else "opt-out"
    print(f"NO_MODEL_GATE_PASSED mode={mode} hosts={len(UNAPPROVED_EGRESS_HOSTS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
