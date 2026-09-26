#!/usr/bin/env python3
"""Dependency-free exact/normalized alias matcher for synthetic AEO cases."""
import csv
import argparse
import pathlib
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent

def normalize(value):
    text = unicodedata.normalize("NFKC", value).casefold()
    text = re.sub(r"[^\w]+", "", text, flags=re.UNICODE)
    return text

def load_aliases():
    by_exact, by_normalized, names = {}, {}, {}
    with (ROOT / "aliases.csv").open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            entity = row["entity_id"]
            names[entity] = row["canonical_name"]
            by_exact.setdefault(row["alias"], set()).add(entity)
            by_normalized.setdefault(normalize(row["alias"]), set()).add(entity)
    return by_exact, by_normalized, names

def classify(observed, by_exact, by_normalized):
    exact = by_exact.get(observed, set())
    if len(exact) == 1:
        return "exact", "match", next(iter(exact))
    if len(exact) > 1:
        return "exact", "review", ""
    normalized = by_normalized.get(normalize(observed), set())
    if len(normalized) == 1 and normalize(observed) != "":
        return "normalized", "match", next(iter(normalized))
    if len(normalized) > 1:
        return "normalized", "review", ""
    return "none", "no-match", ""

def main():
    parser = argparse.ArgumentParser(description="Generate deterministic alias-match output")
    parser.add_argument("--output", default="actual.csv", help="output CSV path (default: actual.csv)")
    args = parser.parse_args()
    by_exact, by_normalized, names = load_aliases()
    output_path = pathlib.Path(args.output)
    if not output_path.is_absolute():
        output_path = ROOT / output_path
    with (ROOT / "cases.csv").open(newline="", encoding="utf-8") as source, output_path.open("w", newline="", encoding="utf-8") as output:
        reader = csv.DictReader(source)
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["case_id", "observed_name", "match_mode", "decision", "matched_entity_id", "matched_canonical_name"])
        for row in reader:
            mode, decision, entity = classify(row["observed_name"], by_exact, by_normalized)
            writer.writerow([row["case_id"], row["observed_name"], mode, decision, entity, names.get(entity, "")])
    print("PASS: generated %s for 24 synthetic cases" % output_path)

if __name__ == "__main__":
    main()
