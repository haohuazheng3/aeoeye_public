#!/usr/bin/env python3
"""Calculate deterministic two-reviewer agreement statistics for AI answer codes."""

import argparse
import csv
import json
import math
import sys
from pathlib import Path

CODES = ("not_mentioned", "mentioned", "recommended")


def load_ratings(path: Path):
    rows = []
    seen = set()
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {"item_id", "reviewer_a", "reviewer_b"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("CSV must contain item_id, reviewer_a, and reviewer_b columns")
        for line, row in enumerate(reader, start=2):
            item_id = (row.get("item_id") or "").strip()
            a = (row.get("reviewer_a") or "").strip()
            b = (row.get("reviewer_b") or "").strip()
            if not item_id or item_id in seen:
                raise ValueError(f"line {line}: item_id must be nonblank and unique")
            if a not in CODES or b not in CODES:
                raise ValueError(f"line {line}: ratings must use exactly {', '.join(CODES)}")
            seen.add(item_id)
            rows.append((item_id, a, b))
    if not rows:
        raise ValueError("CSV contains no rating rows")
    return rows


def calculate(rows):
    matrix = {a: {b: 0 for b in CODES} for a in CODES}
    for _, a, b in rows:
        matrix[a][b] += 1
    n = len(rows)
    row_marginals = {code: sum(matrix[code].values()) for code in CODES}
    column_marginals = {code: sum(matrix[row][code] for row in CODES) for code in CODES}
    observed = sum(matrix[code][code] for code in CODES) / n
    expected = sum(row_marginals[code] * column_marginals[code] for code in CODES) / (n * n)
    undefined_reason = "expected_agreement_is_1" if math.isclose(expected, 1.0) else None
    kappa = None if undefined_reason else (observed - expected) / (1 - expected)
    per_category = {
        code: {"agreement_count": matrix[code][code], "reviewer_a_count": row_marginals[code],
               "reviewer_b_count": column_marginals[code]}
        for code in CODES
    }
    disagreements = [
        {"item_id": item_id, "reviewer_a": a, "reviewer_b": b}
        for item_id, a, b in rows if a != b
    ]

    def rounded(value):
        return None if value is None else round(value, 6)

    return {
        "categories": list(CODES),
        "item_count": n,
        "confusion_matrix": matrix,
        "row_marginals": row_marginals,
        "column_marginals": column_marginals,
        "observed_agreement": rounded(observed),
        "expected_agreement": rounded(expected),
        "cohens_kappa": rounded(kappa),
        "undefined_reason": undefined_reason,
        "per_category": per_category,
        "disagreement_count": len(disagreements),
        "disagreements": disagreements,
    }


def render(report):
    return json.dumps(report, indent=2, sort_keys=True) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--check", type=Path, help="compare generated JSON byte-for-byte with this file")
    args = parser.parse_args()
    try:
        output = render(calculate(load_ratings(args.input)))
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.check:
        expected = args.check.read_text(encoding="utf-8")
        if output != expected:
            print("error: generated report differs from expected-report.json", file=sys.stderr)
            return 1
        print("exact match: generated report equals expected-report.json")
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
