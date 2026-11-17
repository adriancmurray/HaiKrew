#!/usr/bin/env python3
"""Route native Codex agent launches without changing task content."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

MODELS = {"gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol"}
EFFORTS = {"low", "medium", "high", "xhigh", "max", "ultra"}
DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "config" / "routing.json"
SENSITIVE = re.compile(r"\b(security|auth(?:entication|orization)?|oauth2?|oidc|pkce|jwt|tls|iam|migrat(?:ion|ions|e|ing)|concurren\w*|deploy(?:ment|ments|ing|ed)?|production|credentials?|permissions?|data loss|race condition|cryptograph\w*)\b", re.I)
BOUNDED = re.compile(r"^\s*(research|scout|docs|documentation|read.only|lookup|look up|read (?:the )?docs)\b", re.I)
JOB = re.compile(r"(?:^|\s)job=([a-z-]+)(?:\s|$)", re.I)


def task_route(text):
    if SENSITIVE.search(text):
        return "sensitive"
    first_line = text.splitlines()[0] if text.splitlines() else ""
    tag = JOB.search(first_line)
    if tag:
        return "bounded" if tag.group(1).lower() in {"research", "scout", "docs", "documentation", "lookup"} else "routine"
    return "bounded" if BOUNDED.search(text) else "routine"


def deny(reason):
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}


def validate_choice(choice):
    if not isinstance(choice, dict) or set(choice) != {"model", "reasoning_effort"}:
        raise ValueError("each route requires only model and reasoning_effort")
    model, effort = choice["model"], choice["reasoning_effort"]
    if not isinstance(model, str) or model not in MODELS:
        raise ValueError("unsupported model")
    if not isinstance(effort, str) or effort not in EFFORTS or (model == "gpt-6-luna" and effort == "ultra"):
        raise ValueError("unsupported model effort")


def load_policy(path):
    with open(path, encoding="utf-8") as stream:
        policy = json.load(stream)
    if not isinstance(policy, dict) or set(policy) != {"version", "routes"} or type(policy["version"]) is not int or policy["version"] != 1:
        raise ValueError("unsupported routing policy")
    routes = policy["routes"]
    if not isinstance(routes, dict) or set(routes) != {"bounded", "routine", "sensitive"}:
        raise ValueError("routing policy requires bounded, routine and sensitive routes")
    for choice in routes.values():
        validate_choice(choice)
    return routes


def recognized(name):
    # Native spelling and the documented collaboration namespace only.
    return isinstance(name, str) and name in {"spawn_agent", "Agent", "collaboration.spawn_agent", "collaboration::spawn_agent"}


def route(event, config=DEFAULT_CONFIG):
    if not isinstance(event, dict):
        return deny("HaiKrew: hook input must be an object"), "deny"
    if not recognized(event.get("tool_name")):
        return {}, "unrelated"
    try:
        if event.get("hook_event_name") != "PreToolUse":
            raise ValueError("recognized launch requires PreToolUse")
        args = event.get("tool_input")
        if not isinstance(args, dict):
            raise ValueError("tool_input must be an object")
        routes = load_policy(config)
        fork = args.get("fork_turns")
        if fork not in {None, "none", "all"}:
            raise ValueError("unsupported fork_turns")
        model = args.get("model")
        if model is not None and (not isinstance(model, str) or not model or model not in MODELS):
            raise ValueError("unsupported explicit model")
        effort = args.get("reasoning_effort")
        if effort is not None and (not isinstance(effort, str) or effort not in EFFORTS):
            raise ValueError("unsupported explicit reasoning_effort")
        if fork == "all":
            if model is not None or effort is not None:
                raise ValueError("fork_turns all cannot override model or reasoning_effort")
            return {}, "inherited"
        updated = dict(args)
        if model is not None:
            picked, reason = {"model": model, "reasoning_effort": effort or "medium"}, "explicit"
        else:
            text_parts = [args.get(key, "") for key in ("message", "prompt", "description", "task")]
            if any(not isinstance(text, str) for text in text_parts):
                raise ValueError("task text must be a string")
            text = "\n".join(text_parts)
            reason = task_route(text)
            picked = dict(routes[reason])
            if effort is not None:
                picked["reasoning_effort"] = effort
        validate_choice(picked)
        updated["model"] = picked["model"]
        if effort is not None or model is None:
            updated["reasoning_effort"] = picked["reasoning_effort"]
        updated["fork_turns"] = "none"
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": updated}}, reason
    except (ValueError, TypeError, OSError) as exc:
        # Never echo exception data, paths, task text, or configuration contents.
        return deny("HaiKrew: invalid agent launch or routing policy"), "deny"


def receipt(path, event, result, reason):
    output = result.get("hookSpecificOutput", {})
    args = output.get("updatedInput", {})
    record = {"route": reason, "decision": output.get("permissionDecision", "unchanged"), "model": args.get("model"), "reasoning_effort": args.get("reasoning_effort")}
    for key in ("session_id", "tool_use_id"):
        value = event.get(key) if isinstance(event, dict) else None
        if isinstance(value, str):
            record[key + "_sha256"] = hashlib.sha256(value.encode()).hexdigest()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, (json.dumps(record, sort_keys=True) + "\n").encode())
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--log", type=Path)
    options = parser.parse_args()
    event = None
    try:
        event = json.load(sys.stdin)
        result, reason = route(event, options.config)
    except (ValueError, TypeError):
        result, reason = deny("HaiKrew: malformed hook JSON"), "deny"
    if options.log is not None:
        try:
            receipt(options.log, event, result, reason)
        except OSError:
            result = deny("HaiKrew: unable to write routing receipt")
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
