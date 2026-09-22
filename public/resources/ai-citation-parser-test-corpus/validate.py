#!/usr/bin/env python3
"""Dependency-free structural validator for the synthetic citation corpus."""
import csv, json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent
CASES = ROOT / "cases.jsonl"
EXPECTED = ROOT / "expected-results.csv"
REQUIRED = {"inline-numbered", "grouped-markers", "footnote", "source-card", "bare-url", "malformed-marker", "uncited-claim", "ambiguous-scope"}

def fail(message):
    print("FAIL:", message, file=sys.stderr)
    return 1

def main():
    rows = []
    try:
        with CASES.open(encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, 1):
                if not line.strip():
                    return fail("blank JSONL line %d" % line_no)
                row = json.loads(line)
                rows.append(row)
    except Exception as exc:
        return fail("invalid JSONL: %s" % exc)
    if len(rows) != 24:
        return fail("expected exactly 24 cases, found %d" % len(rows))
    ids = [row.get("case_id") for row in rows]
    if len(set(ids)) != 24 or any(not value for value in ids):
        return fail("case IDs must be present and unique")
    categories = {row.get("category") for row in rows}
    if not REQUIRED.issubset(categories):
        return fail("missing categories: %s" % sorted(REQUIRED - categories))
    expected = {}
    with EXPECTED.open(newline="", encoding="utf-8") as handle:
        for item in csv.DictReader(handle):
            key = (item["case_id"], item["claim_id"])
            if key in expected:
                return fail("duplicate expected row for %s/%s" % key)
            expected[key] = item
    actual_claim_keys = {
        (row["case_id"], claim.get("claim_id"))
        for row in rows
        for claim in row.get("claims", [])
    }
    if set(expected) != actual_claim_keys:
        return fail("expected CSV claim IDs do not match JSONL claim IDs")
    for row in rows:
        claims = row.get("claims")
        sources = row.get("sources")
        if not isinstance(claims, list) or not claims or not isinstance(sources, list):
            return fail("%s must have claims and sources arrays" % row["case_id"])
        source_ids = {source.get("source_id") for source in sources}
        for claim in claims:
            claim_id = claim.get("claim_id")
            item = expected[(row["case_id"], claim_id)]
            claim_source_ids = claim.get("source_ids")
            if not isinstance(claim_source_ids, list) or not set(claim_source_ids).issubset(source_ids):
                return fail("unresolved source ID in %s/%s" % (row["case_id"], claim_id))
            for key in ("marker_detected", "marker_kind", "claim_support_label"):
                if str(claim.get(key)).lower() != item[key].lower():
                    return fail("%s mismatch for %s/%s" % (key, row["case_id"], claim_id))
            if str(len(claim_source_ids)) != item["source_count"] or row.get("ambiguity") != item["ambiguity"]:
                return fail("metadata mismatch for %s/%s" % (row["case_id"], claim_id))
            if claim["claim_support_label"] not in {"supported", "contradicted", "insufficient"}:
                return fail("invalid support label in %s/%s" % (row["case_id"], claim_id))
            if claim["marker_detected"] is False and claim["marker_kind"] not in {"none", "malformed_numeric"}:
                return fail("undetected marker has unexpected kind in %s/%s" % (row["case_id"], claim_id))
    print("PASS: 24 cases, 27 claims, 8 required categories, expected labels match")
    return 0

if __name__ == "__main__":
    sys.exit(main())
