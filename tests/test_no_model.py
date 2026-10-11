"""AF-02 zero-model and egress conformance tests for Skelet."""

from __future__ import annotations

import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from check_no_model import (  # noqa: E402
    UNAPPROVED_EGRESS_HOSTS,
    check_repository,
    forbidden_present,
    parse_no_model_flag,
    scan_unapproved_egress,
)


class ParseNoModelFlagTests(unittest.TestCase):
    def test_default_is_strict(self) -> None:
        self.assertTrue(parse_no_model_flag(None))
        self.assertTrue(parse_no_model_flag("1"))
        self.assertFalse(parse_no_model_flag("0"))

    def test_invalid_states_fail_closed(self) -> None:
        for bad in ("true", "yes", "", "2", "strict", " 1 "):
            with self.assertRaises(ValueError, msg=bad):
                parse_no_model_flag(bad)


class ForbiddenCredentialTests(unittest.TestCase):
    def test_clean_env_has_no_forbidden_names(self) -> None:
        self.assertEqual(forbidden_present({}), [])

    def test_empty_values_do_not_count(self) -> None:
        self.assertEqual(forbidden_present({"OPENAI_API_KEY": ""}), [])

    def test_present_credentials_are_sorted_names_only(self) -> None:
        got = forbidden_present(
            {"OPENAI_API_KEY": "sk-test", "ANTHROPIC_API_KEY": "x", "PATH": "/bin"}
        )
        self.assertEqual(got, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"])
        self.assertNotIn("sk-test", " ".join(got))


class EgressScanTests(unittest.TestCase):
    def test_deny_list_covers_launch_critical_providers(self) -> None:
        for host in (
            "api.openai.com",
            "api.anthropic.com",
            "generativelanguage.googleapis.com",
            "api.replicate.com",
            "api.firecrawl.dev",
            "api.pinecone.io",
        ):
            self.assertIn(host, UNAPPROVED_EGRESS_HOSTS)

    def test_runtime_tree_has_no_unapproved_egress(self) -> None:
        violations = scan_unapproved_egress(ROOT)
        self.assertEqual(violations, [])

    def test_strict_clean_repository_passes(self) -> None:
        errors = check_repository(ROOT, {})
        self.assertEqual(errors, [])

    def test_strict_credential_present_fails_closed(self) -> None:
        errors = check_repository(ROOT, {"OPENAI_API_KEY": "sk-test"})
        self.assertTrue(any("OPENAI_API_KEY" in error for error in errors))

    def test_invalid_flag_fails_closed(self) -> None:
        errors = check_repository(ROOT, {"SKELET_NO_MODEL": "strict"})
        self.assertTrue(any("SKELET_NO_MODEL" in error for error in errors))

    def test_opt_out_skips_credential_gate_but_keeps_egress_scan(self) -> None:
        errors = check_repository(
            ROOT, {"SKELET_NO_MODEL": "0", "OPENAI_API_KEY": "sk-test"}
        )
        self.assertEqual(errors, [])


class GateCliTests(unittest.TestCase):
    def test_gate_cli_passes_on_clean_strict_env(self) -> None:
        env = {k: v for k, v in __import__("os").environ.items()}
        for name in (
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "GEMINI_API_KEY",
            "REPLICATE_API_TOKEN",
            "HF_TOKEN",
            "FIRECRAWL_API_KEY",
            "PINECONE_API_KEY",
            "SKELET_NO_MODEL",
        ):
            env.pop(name, None)
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "check_no_model.py"), "--root", str(ROOT)],
            capture_output=True,
            text=True,
            env=env,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("NO_MODEL_GATE_PASSED mode=strict", result.stdout)


if __name__ == "__main__":
    unittest.main()
