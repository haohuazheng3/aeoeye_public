#!/usr/bin/env python3
"""Audit declared prompt-register coverage using only Python's standard library."""
import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REQUIRED_PROMPT_COLUMNS = {"prompt_id", "status"}
ALLOWED_STATUS = {"active", "disabled", "excluded"}


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError(f"{path} is empty")
    return rows


def audit(prompts_path, requirements_path):
    prompts = read_csv(prompts_path)
    requirements = read_csv(requirements_path)
    prompt_columns = set(prompts[0])
    missing = sorted(REQUIRED_PROMPT_COLUMNS - prompt_columns)
    if missing:
        raise ValueError("prompts.csv missing required columns: " + ", ".join(missing))
    required_columns = {"dimension", "value", "minimum"}
    if required_columns - set(requirements[0]):
        raise ValueError("requirements.csv missing required columns: " + ", ".join(sorted(required_columns - set(requirements[0]))))
    dimensions = sorted(prompt_columns - REQUIRED_PROMPT_COLUMNS)
    if not dimensions:
        raise ValueError("prompts.csv must declare at least one coverage dimension")

    ids = [row["prompt_id"].strip() for row in prompts]
    duplicates = sorted(prompt_id for prompt_id, count in Counter(ids).items() if count > 1)
    bad_status = sorted({row["status"].strip() for row in prompts} - ALLOWED_STATUS)
    if duplicates:
        raise ValueError("duplicate prompt_id: " + ", ".join(duplicates))
    if bad_status:
        raise ValueError("unknown status: " + ", ".join(bad_status))

    parsed_requirements = []
    known_values = defaultdict(set)
    for row in requirements:
        dimension = row["dimension"].strip()
        value = row["value"].strip()
        try:
            minimum = int(row["minimum"])
        except ValueError as exc:
            raise ValueError(f"invalid minimum for {dimension}={value}") from exc
        if dimension not in dimensions:
            raise ValueError(f"unknown requirement dimension: {dimension}")
        if minimum < 0:
            raise ValueError(f"minimum must be non-negative for {dimension}={value}")
        parsed_requirements.append((dimension, value, minimum))
        known_values[dimension].add(value)

    active = [row for row in prompts if row["status"].strip() == "active"]
    unrecognized = []
    for dimension in dimensions:
        for value in sorted({row.get(dimension, "").strip() for row in active} - known_values[dimension] - {""}):
            unrecognized.append({"dimension": dimension, "value": value})

    counts = {}
    unmet = []
    for dimension, value, minimum in parsed_requirements:
        count = sum(row.get(dimension, "").strip() == value for row in active)
        key = f"{dimension}={value}"
        counts[key] = {"count": count, "minimum": minimum, "met": count >= minimum}
        if count < minimum:
            unmet.append({"dimension": dimension, "value": value, "count": count, "minimum": minimum})

    report = {
        "active_prompt_count": len(active),
        "coverage": counts,
        "declared_dimensions": dimensions,
        "eligible_statuses": ["active"],
        "excluded_prompt_count": len(prompts) - len(active),
        "gaps_detected": bool(unmet or unrecognized),
        "unmet_requirements": unmet,
        "unrecognized_values": unrecognized,
        "validation": {"prompt_rows": len(prompts), "requirements": len(requirements), "unique_prompt_ids": len(ids)},
    }
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompts", default="prompts.csv")
    parser.add_argument("--requirements", default="requirements.csv")
    parser.add_argument("--output", required=True)
    parser.add_argument("--allow-gaps", action="store_true", help="return success even when declared coverage is incomplete")
    args = parser.parse_args()
    try:
        report = audit(args.prompts, args.requirements)
        rendered = json.dumps(report, separators=(",", ":"), sort_keys=True) + "\n"
        Path(args.output).write_text(rendered, encoding="utf-8")
    except (OSError, ValueError) as exc:
        print(f"audit error: {exc}", file=sys.stderr)
        return 2
    if report["gaps_detected"] and not args.allow_gaps:
        print("gaps detected; see report", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
