"""Skilit command-line interface over REST API v1.

Read-only agent/human helper: search assets, resolve one asset, or
recover a canonical object by Skilit URI. Credentials come from flags or
environment (SKILIT_BASE_URL, SKILIT_TOKEN) and are never logged.
Exits 0 on success, 1 on request failure, 2 on usage errors.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.skilit_sdk import SdkError, SkilitClient


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="skilit", description="Skilit agent CLI (REST API v1).")
    # Canonical SKILIT_*; legacy SKELET_* remains readable for migration.
    parser.add_argument("--base-url", default=os.environ.get("SKILIT_BASE_URL", os.environ.get("SKELET_BASE_URL", "")))
    parser.add_argument(
        "--token",
        default=os.environ.get("SKILIT_TOKEN", os.environ.get("SKELET_TOKEN", "")),
        help="Bearer token; prefer SKILIT_TOKEN over flags and shell history.",
    )
    parser.add_argument("--timeout", type=float, default=30.0)
    # AF-03c: stable request identifiers for retry correlation. The value is
    # sent as X-Request-Id and echoed in the envelope; retries with the same
    # ID share one trace without duplicating canonical state (reads) or
    # requiring a ledger (save_reference) / via ledger (packs, MCP only).
    parser.add_argument("--request-id", default=None, help="Optional request ID (1..128 chars) for retry correlation.")
    sub = parser.add_subparsers(dest="command", required=True)

    search = sub.add_parser("search", help="Search icons, logos, and fonts.")
    search.add_argument("--query", required=True)
    search.add_argument("--kinds", default=None)
    search.add_argument("--limit", type=int, default=None)
    search.add_argument("--cursor", default=None, help="Opaque pagination cursor from a prior search page.")

    get = sub.add_parser("get", help="Resolve one asset by artifact ID.")
    get.add_argument("artifact_id")

    obj = sub.add_parser("object", help="Recover a canonical object by Skilit URI.")
    obj.add_argument("uri")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.base_url or not args.token:
        print("skilit: --base-url and --token (or SKILIT_BASE_URL/SKILIT_TOKEN) are required.", file=sys.stderr)
        return 2
    if not 0 < args.timeout <= 300 or args.timeout != args.timeout:
        parser.error("--timeout must be within (0, 300] seconds.")
    try:
        client = SkilitClient(args.base_url, args.token, timeout=args.timeout)
        request_id = args.request_id
        if args.command == "search":
            page = client.search_assets_page(args.query, kinds=args.kinds, limit=args.limit, cursor=args.cursor, request_id=request_id)
            result = {"assets": page["assets"]}
            if page.get("cursor"):
                result["cursor"] = page["cursor"]
            if page.get("request_id"):
                result["request_id"] = page["request_id"]
        elif args.command == "get":
            result = {"asset": client.get_asset(args.artifact_id, request_id=request_id)}
        elif args.command == "object":
            result = client.get_object(args.uri, request_id=request_id)
        else:
            return 2
    except SdkError as error:
        print(f"skilit: {error.code} (status {error.status})", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
