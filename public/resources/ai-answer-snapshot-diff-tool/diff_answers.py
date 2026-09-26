#!/usr/bin/env python3
"""Compare two synthetic answer snapshots by prompt_id and engine."""
import csv
import json
import sys
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

FIELDS = ("availability", "brand_mention", "recommendation_label", "rank")


def load(path: str) -> Dict[Tuple[str, str], dict]:
    with open(path, encoding="utf-8") as handle:
        rows = json.load(handle)
    return {(row["prompt_id"], row["engine"]): row for row in rows}


def value(row: Optional[dict], field: str) -> str:
    if row is None or field not in row or row[field] is None:
        return ""
    if isinstance(row[field], bool):
        return str(row[field]).lower()
    return str(row[field])


def domains(row: Optional[dict]) -> Set[str]:
    return set() if row is None else set(row.get("citation_domains", []))


def main() -> int:
    if len(sys.argv) != 3:
        print(f"usage: {Path(sys.argv[0]).name} before.json after.json", file=sys.stderr)
        return 2
    before, after = load(sys.argv[1]), load(sys.argv[2])
    writer = csv.writer(sys.stdout, lineterminator="\n")
    writer.writerow(["prompt_id", "engine", "change_type", "field", "before", "after"])
    for key in sorted(set(before) | set(after)):
        prompt_id, engine = key
        old, new = before.get(key), after.get(key)
        if old is None or new is None:
            writer.writerow([prompt_id, engine, "prompt_set_gap", "record", "present" if old else "missing", "present" if new else "missing"])
            continue
        for field in FIELDS:
            old_value, new_value = value(old, field), value(new, field)
            if old_value != new_value:
                writer.writerow([prompt_id, engine, "field_change", field, old_value, new_value])
        old_domains, new_domains = domains(old), domains(new)
        for domain in sorted(new_domains - old_domains):
            writer.writerow([prompt_id, engine, "citation_domain_addition", "citation_domain", "", domain])
        for domain in sorted(old_domains - new_domains):
            writer.writerow([prompt_id, engine, "citation_domain_removal", "citation_domain", domain, ""])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
