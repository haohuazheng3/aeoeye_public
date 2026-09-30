#!/usr/bin/env python3
"""Evaluate a deliberately small, documented RFC 9309 robots.txt subset."""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit


@dataclass(frozen=True)
class Rule:
    directive: str
    pattern: str
    line: int


def parse_robots(path: Path) -> dict[str, list[Rule]]:
    groups: dict[str, list[Rule]] = {}
    current_agents: list[str] = []
    saw_rule = False
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        text = raw.split("#", 1)[0].strip()
        if not text:
            if saw_rule:
                current_agents = []
                saw_rule = False
            continue
        if ":" not in text:
            continue
        name, value = (part.strip() for part in text.split(":", 1))
        name = name.lower()
        if name == "user-agent":
            if saw_rule:
                current_agents = []
                saw_rule = False
            if value:
                current_agents.append(value.lower())
            continue
        if name not in {"allow", "disallow"} or not current_agents:
            continue
        saw_rule = True
        # An empty Disallow means no restriction and is not a matchable rule.
        if value:
            rule = Rule(name, value, line_no)
            for agent in current_agents:
                groups.setdefault(agent, []).append(rule)
    return groups


def _decode_for_match(value: str) -> str:
    # This documented subset normalizes the synthetic UTF-8 encoding case by
    # decoding both sides. Encoded reserved-delimiter edge cases are excluded.
    protected = value.replace("%2F", "__ENCODED_SLASH__").replace("%2f", "__ENCODED_SLASH__")
    return unquote(protected).replace("__ENCODED_SLASH__", "%2F")


def _matches(pattern: str, path: str) -> bool:
    pattern = _decode_for_match(pattern)
    path = _decode_for_match(path)
    end_anchor = pattern.endswith("$")
    if end_anchor:
        pattern = pattern[:-1]
    expression = "^" + "".join(".*" if char == "*" else re.escape(char) for char in pattern)
    expression += "$" if end_anchor else ".*"
    return re.match(expression, path) is not None


def evaluate(groups: dict[str, list[Rule]], user_agent: str, url_path: str) -> tuple[str, str]:
    ua = user_agent.lower()
    specific = [token for token in groups if token != "*" and token in ua]
    if specific:
        best = max(len(token) for token in specific)
        selected = [token for token in specific if len(token) == best]
    elif "*" in groups:
        selected = ["*"]
    else:
        return "allow", ""
    rules = [rule for token in selected for rule in groups[token]]
    matches = [rule for rule in rules if _matches(rule.pattern, url_path)]
    if not matches:
        return "allow", ""
    longest = max(len(_decode_for_match(rule.pattern.rstrip("$"))) for rule in matches)
    winners = [rule for rule in matches if len(_decode_for_match(rule.pattern.rstrip("$"))) == longest]
    winner = next((rule for rule in winners if rule.directive == "allow"), winners[0])
    return ("allow" if winner.directive == "allow" else "disallow"), winner.pattern


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--robots", type=Path, required=True)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    groups = parse_robots(args.robots)
    with args.cases.open(newline="", encoding="utf-8") as handle:
        cases = list(csv.DictReader(handle))
    required = {"case_id", "user_agent", "path", "expected_decision", "note"}
    if not cases or set(cases[0]) != required or len(cases) != 24:
        raise SystemExit("cases.csv must contain exactly 24 rows and the documented columns")
    ids = [row["case_id"] for row in cases]
    if len(set(ids)) != len(ids):
        raise SystemExit("case_id values must be unique")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["case_id", "decision", "matched_rule"])
        for case in cases:
            decision, matched = evaluate(groups, case["user_agent"], urlsplit(case["path"]).path or "/")
            if decision != case["expected_decision"]:
                raise SystemExit(f"case {case['case_id']} expected {case['expected_decision']} got {decision}")
            writer.writerow([case["case_id"], decision, matched])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
