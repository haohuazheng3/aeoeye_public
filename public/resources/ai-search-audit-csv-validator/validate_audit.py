#!/usr/bin/env python3
"""Validate answer-level AI-search audit CSVs without external dependencies."""

import argparse
import csv
import json
import sys
from pathlib import Path

REQUIRED = [
    "run_id",
    "prompt_id",
    "engine",
    "answer_status",
    "brand_mentioned",
    "brand_recommended",
    "citation_count",
]
BOOLEAN_FIELDS = ("brand_mentioned", "brand_recommended")
BOOLEAN_VALUES = {"true", "false"}


def validate(path: Path) -> dict:
    errors = []
    rows = []
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            headers = reader.fieldnames or []
            missing = [name for name in REQUIRED if name not in headers]
            if missing:
                errors.append({"code": "missing_columns", "columns": missing})
            for number, row in enumerate(reader, start=2):
                rows.append(row)
                run_id = (row.get("run_id") or "").strip()
                status = (row.get("answer_status") or "").strip()
                if not run_id:
                    errors.append({"code": "blank_run_id", "row": number})
                if status not in {"available", "unavailable"}:
                    errors.append({"code": "invalid_answer_status", "row": number, "value": status})
                for field in BOOLEAN_FIELDS:
                    value = (row.get(field) or "").strip().lower()
                    if status == "available" and value not in BOOLEAN_VALUES:
                        errors.append({"code": "invalid_boolean", "field": field, "row": number, "value": value})
                    if status == "unavailable" and value:
                        errors.append({"code": "unavailable_field_must_be_blank", "field": field, "row": number, "value": value})
                citation = (row.get("citation_count") or "").strip()
                if status == "available":
                    try:
                        if int(citation) < 0:
                            raise ValueError
                    except ValueError:
                        errors.append({"code": "invalid_citation_count", "row": number, "value": citation})
                elif citation:
                    errors.append({"code": "unavailable_field_must_be_blank", "field": "citation_count", "row": number, "value": citation})
    except (OSError, csv.Error) as exc:
        errors.append({"code": "read_error", "message": str(exc)})
    seen = {}
    for number, row in enumerate(rows, start=2):
        run_id = (row.get("run_id") or "").strip()
        if run_id:
            if run_id in seen:
                errors.append({"code": "duplicate_run_id", "row": number, "run_id": run_id, "first_row": seen[run_id]})
            else:
                seen[run_id] = number
    errors.sort(key=lambda item: (item.get("row", 0), item.get("code", ""), item.get("field", "")))
    return {"file": path.name, "ok": not errors, "row_count": len(rows), "errors": errors}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = validate(args.csv_file)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
