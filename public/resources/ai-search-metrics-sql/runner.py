#!/usr/bin/env python3
"""Import a CSV into SQLite and run the named metric queries.

Only Python's standard library is used. Tested with Python 3.9 and SQLite.
"""
import argparse
import csv
import sqlite3
from pathlib import Path

REQUIRED = [
    "run_id", "prompt_id", "engine", "answer_available", "brand_mentioned",
    "brand_recommended", "citation_count", "cited_brand_source", "citation_reviewable",
]


def load_csv(connection, csv_path):
    with open(csv_path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != REQUIRED:
            raise ValueError(f"CSV columns must be {REQUIRED}; got {reader.fieldnames}")
        connection.execute("""
            CREATE TABLE audit_rows (
              run_id TEXT, prompt_id TEXT, engine TEXT, answer_available TEXT NOT NULL,
              brand_mentioned TEXT, brand_recommended TEXT, citation_count INTEGER,
              cited_brand_source TEXT, citation_reviewable TEXT
            )
        """)
        rows = []
        for row in reader:
            count = None if row["citation_count"] == "" else int(row["citation_count"])
            rows.append(tuple(row[field] or None for field in REQUIRED[:6]) +
                        (count,) + tuple(row[field] or None for field in REQUIRED[7:]))
        connection.executemany(
            "INSERT INTO audit_rows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows
        )


def sections(sql_text):
    current = None
    for line in sql_text.splitlines():
        if line.startswith("-- name:"):
            if current:
                yield current[0], "\n".join(current[1:]).strip()
            current = [line.split(":", 1)[1].strip()]
        elif current is not None and not line.startswith("--"):
            current.append(line)
    if current:
        yield current[0], "\n".join(current[1:]).strip()


def run(csv_path, sql_path, output_path):
    connection = sqlite3.connect(":memory:")
    load_csv(connection, csv_path)
    output_rows = []
    with open(sql_path, encoding="utf-8") as handle:
        sql_text = handle.read()
    for query_name, query in sections(sql_text):
        columns = [item[0] for item in connection.execute(query).description]
        for row in connection.execute(query):
            output_rows.append({"query": query_name, **dict(zip(columns, row))})
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["query", "metric", "engine", "numerator", "denominator", "rate"]
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(output_rows)
    print(f"wrote {len(output_rows)} rows to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", default="ai_search_audit_sample.csv")
    parser.add_argument("--sql", default="queries.sql")
    parser.add_argument("--output", default="expected_output.csv")
    args = parser.parse_args()
    run(args.csv, args.sql, args.output)
