"""Skelet command-line interface over REST API v1.

Read-only agent/human helper: search assets, resolve one asset, or
recover a canonical object by Skelet URI. Credentials come from flags or
environment (SKELET_BASE_URL, SKELET_TOKEN) and are never logged.
Exits 0 on success, 1 on request failure, 2 on usage errors.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.skelet_sdk import SdkError, SkeletClient


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="skelet", description="Skelet agent CLI (REST API v1).")
    parser.add_argument("--base-url", default=os.environ.get("SKELET_BASE_URL", ""))
    parser.add_argument(
        "--token",
        default=os.environ.get("SKELET_TOKEN", ""),
        help="Bearer token; prefer SKELET_TOKEN over flags and shell history.",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    sub = parser.add_subparsers(dest="command", required=True)

    search = sub.add_parser("search", help="Search icons, logos, and fonts.")
    search.add_argument("--query", required=True)
    search.add_argument("--kinds", default=None)
    search.add_argument("--limit", type=int, default=None)

    get = sub.add_parser("get", help="Resolve one asset by artifact ID.")
    get.add_argument("artifact_id")

    obj = sub.add_parser("object", help="Recover a canonical object by Skelet URI.")
    obj.add_argument("uri")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.base_url or not args.token:
        print("skelet: --base-url and --token (or SKELET_BASE_URL/SKELET_TOKEN) are required.", file=sys.stderr)
        return 2
    if not 0 < args.timeout <= 300 or args.timeout != args.timeout:
        parser.error("--timeout must be within (0, 300] seconds.")
    try:
        client = SkeletClient(args.base_url, args.token, timeout=args.timeout)
        if args.command == "search":
            result = {"assets": client.search_assets(args.query, kinds=args.kinds, limit=args.limit)}
        elif args.command == "get":
            result = {"asset": client.get_asset(args.artifact_id)}
        elif args.command == "object":
            result = client.get_object(args.uri)
        else:
            return 2
    except SdkError as error:
        print(f"skelet: {error.code} (status {error.status})", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
