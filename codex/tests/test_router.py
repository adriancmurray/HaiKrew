"""Contract checks for the portable Codex routing adapter; no model calls."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SKILL = Path(__file__).resolve().parents[1] / "skills" / "haikrew"
SCRIPT = SKILL / "scripts" / "router.py"
spec = importlib.util.spec_from_file_location("haikrew_codex_router", SCRIPT)
router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(router)


def event(message="Implement a parser", **args):
    return {
        "hook_event_name": "PreToolUse",
        "tool_name": "spawn_agent",
        "tool_input": {"task_name": "fixture", "message": message, **args},
    }


class RouterTests(unittest.TestCase):
    def test_routes_bounded_routine_and_sensitive_work(self):
        for message, tier in [
            ("HAIKREW job=research\nFind public reference material", "bounded"),
            ("Read the docs for the parser", "bounded"),
            ("HAIKREW job=implement\nImplement a parser", "routine"),
            ("HAIKREW job=review\nCheck a formatter", "routine"),
            ("HAIKREW job=docs\nDocument authentication changes", "sensitive"),
            ("Investigate a race condition", "sensitive"),
        ]:
            with self.subTest(message=message):
                original = event(message)
                result, reason = router.route(original)
                output = result["hookSpecificOutput"]
                self.assertEqual(reason, tier)
                self.assertEqual(output["permissionDecision"], "allow")
                choice = router.load_policy(router.DEFAULT_CONFIG)[tier]
                self.assertEqual(output["updatedInput"], {
                    **original["tool_input"], **choice, "fork_turns": "none",
                })
                self.assertNotIn("model", original["tool_input"])

    def test_supported_tool_spellings(self):
        for name in ("spawn_agent", "Agent", "collaboration.spawn_agent", "collaboration::spawn_agent"):
            value = event()
            value["tool_name"] = name
            self.assertEqual(router.route(value)[1], "routine")

    def test_unrelated_tools_unchanged(self):
        for name in ("exec_command", "untrusted.spawn_agent", None):
            value = event()
            value["tool_name"] = name
            self.assertEqual(router.route(value), ({}, "unrelated"))

    def test_explicit_supported_choices_preserved(self):
        value = event(model="gpt-6.1-sol", reasoning_effort="high", fork_turns="none")
        result, reason = router.route(value)
        self.assertEqual(reason, "explicit")
        self.assertEqual(result["hookSpecificOutput"]["updatedInput"], value["tool_input"])

    def test_explicit_effort_preserved_with_routed_model(self):
        result, _ = router.route(event(reasoning_effort="high"))
        self.assertEqual(result["hookSpecificOutput"]["updatedInput"]["reasoning_effort"], "high")

    def test_explicit_model_without_effort_keeps_runtime_default(self):
        result, reason = router.route(event(model="gpt-6.1-sol"))
        self.assertEqual(reason, "explicit")
        self.assertNotIn("reasoning_effort", result["hookSpecificOutput"]["updatedInput"])

    def test_full_history_fork_inherits(self):
        self.assertEqual(router.route(event(fork_turns="all")), ({}, "inherited"))

    def test_invalid_launches_return_deny(self):
        values = [
            [], event(model="unsupported"), event(reasoning_effort="unsupported"),
            event(fork_turns="invalid"), event(fork_turns=[]),
            event(fork_turns="all", model="gpt-6.1-sol"),
            event(fork_turns="all", reasoning_effort="high"),
            event(model="gpt-6-luna", reasoning_effort="ultra"),
            event(message=123),
            {**event(), "hook_event_name": "PostToolUse"},
            {**event(), "tool_input": []},
        ]
        for value in values:
            with self.subTest(value=value):
                result, reason = router.route(value)
                self.assertEqual(reason, "deny")
                self.assertEqual(result["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_custom_policy_is_used(self):
        policy = json.loads(router.DEFAULT_CONFIG.read_text())
        policy["routes"]["routine"] = {"model": "gpt-6.1-terra", "reasoning_effort": "high"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            path.write_text(json.dumps(policy))
            result, _ = router.route(event(), path)
            self.assertEqual(result["hookSpecificOutput"]["updatedInput"]["model"], "gpt-6.1-terra")

    def test_missing_or_invalid_policy_returns_deny(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            self.assertEqual(router.route(event(), path)[1], "deny")
            for policy in ({}, {"version": True, "routes": {}}, {"version": 1, "routes": {}}):
                path.write_text(json.dumps(policy))
                self.assertEqual(router.route(event(), path)[1], "deny")
            path.write_text("invalid JSON")
            self.assertEqual(router.route(event(), path)[1], "deny")

    def test_cli_is_portable_and_creates_no_receipt_by_default(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(event()),
                                    text=True, capture_output=True, cwd=directory, check=True)
            self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "allow")
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_malformed_cli_json_returns_deny(self):
        result = subprocess.run([sys.executable, str(SCRIPT)], input="{", text=True,
                                capture_output=True, check=True)
        self.assertEqual(json.loads(result.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertEqual(result.stderr, "")

    def test_receipt_contains_only_metadata_and_hashed_identifiers(self):
        value = {**event("private task text"), "session_id": "private-session", "tool_use_id": "private-tool"}
        result, reason = router.route(value)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "routes.jsonl"
            router.receipt(path, value, result, reason)
            raw = path.read_text()
            self.assertNotIn("private", raw)
            record = json.loads(raw)
            self.assertEqual(record["session_id_sha256"], hashlib.sha256(b"private-session").hexdigest())
            self.assertEqual(set(record), {"route", "decision", "model", "reasoning_effort", "session_id_sha256", "tool_use_id_sha256"})
            if os.name == "posix":
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    @unittest.skipUnless(hasattr(os, "O_NOFOLLOW"), "requires no-follow support")
    def test_receipt_cannot_follow_a_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target"
            target.write_text("preserve")
            link = Path(directory) / "receipt"
            link.symlink_to(target)
            result, reason = router.route(event())
            with self.assertRaises(OSError):
                router.receipt(link, event(), result, reason)
            self.assertEqual(target.read_text(), "preserve")


if __name__ == "__main__":
    unittest.main()
