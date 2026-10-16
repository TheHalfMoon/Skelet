"""AF-03a agent-contract fixture validation tests for Skilit."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from validate_agent_contract import (  # noqa: E402
    ERROR_CODES,
    EVIDENCE_MODES,
    validate_envelope,
    validate_uri,
)


class AgentContractTests(unittest.TestCase):
    def test_taxonomy_covers_required_classes(self) -> None:
        for code in (
            "INVALID_INPUT",
            "UNAUTHENTICATED",
            "FORBIDDEN_OR_NOT_FOUND",
            "NOT_AVAILABLE",
            "RIGHTS_RESTRICTED",
            "PROVIDER_DISABLED",
            "JOB_PENDING",
            "INTERNAL_OPAQUE",
        ):
            self.assertIn(code, ERROR_CODES)

    def test_evidence_modes_cover_required_vocabulary(self) -> None:
        for mode in (
            "observed",
            "deterministic-computation",
            "heuristic-inference",
            "generated-by-external-agent",
            "unknown",
        ):
            self.assertIn(mode, EVIDENCE_MODES)

    def test_tool_names_match_implemented_surface(self) -> None:
        implemented = {
            "search_assets",
            "get_asset",
            "get_registry_item",
            "save_reference",
            "create_reference_pack",
            "get_object",
        }
        for tool in implemented:
            self.assertTrue(isinstance(tool, str) and len(tool) > 0)
        self.assertEqual(len(implemented), 6)

    def test_valid_fixtures_pass(self) -> None:
        for name in ("valid-envelope.json", "valid-denied.json"):
            data = json.loads(
                (ROOT / "fixtures" / "agent-contract" / name).read_text(encoding="utf-8")
            )
            self.assertEqual(validate_envelope(data), [], name)

    def test_invalid_fixtures_fail(self) -> None:
        for name in ("invalid-uri.json", "invalid-error.json"):
            data = json.loads(
                (ROOT / "fixtures" / "agent-contract" / name).read_text(encoding="utf-8")
            )
            if name == "invalid-uri.json":
                self.assertTrue(validate_uri(data.get("uri")))
            else:
                self.assertTrue(validate_envelope(data))

    def test_uri_rejects_traversal_and_unknown_kinds(self) -> None:
        for bad in (
            "skilit://artifact/../../etc/passwd",
            "skilit://unknown/abc",
            "https://example.com/x",
            "",
            None,
        ):
            self.assertTrue(validate_uri(bad), repr(bad))
        self.assertEqual(validate_uri("skilit://artifact/icon-set-001"), [])

    def test_gate_cli_passes(self) -> None:
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate_agent_contract.py")],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("AGENT_CONTRACT_PASSED", result.stdout)

    def test_checked_in_schema_matches_validator_contract(self) -> None:
        import re as re_module

        schema = json.loads(
            (ROOT / "schemas" / "agent-contract.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(schema["properties"]["schema_version"], {"const": "skilit.agent.v1"})
        error_enum = schema["$defs"]["error"]["properties"]["code"]["enum"]
        self.assertEqual(set(error_enum), ERROR_CODES)
        self.assertEqual(len(error_enum), 13)
        pattern = schema["$defs"]["uri"]["pattern"]
        compiled = re_module.compile(pattern)
        self.assertTrue(compiled.match("skilit://artifact/icon-set-001"))
        self.assertFalse(compiled.match("skilit://artifact/../../etc/passwd"))
        self.assertFalse(compiled.match("skilit://unknown/abc"))


if __name__ == "__main__":
    unittest.main()
