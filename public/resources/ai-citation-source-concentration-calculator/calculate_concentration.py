#!/usr/bin/env python3
"""Calculate descriptive citation-source concentration from a CSV export."""
import argparse
import csv
import json
import sys
from collections import Counter
from urllib.parse import urlsplit

REQUIRED = ("citation_id", "prompt_id", "engine", "url")


def host_for(raw: str) -> str:
    parsed = urlsplit(raw)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"url must be an absolute HTTP(S) URL: {raw!r}")
    if parsed.username or parsed.password:
        raise ValueError(f"URL credentials are not accepted: {raw!r}")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        raise ValueError(f"URL has no host: {raw!r}")
    return host[4:] if host.startswith("www.") else host


def report(path: str) -> dict:
    rows = []
    seen = set()
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None or any(col not in reader.fieldnames for col in REQUIRED):
            raise ValueError("CSV must contain citation_id,prompt_id,engine,url columns")
        for line, row in enumerate(reader, start=2):
            citation_id = (row.get("citation_id") or "").strip()
            if not citation_id:
                raise ValueError(f"line {line}: citation_id is required")
            if citation_id in seen:
                raise ValueError(f"line {line}: duplicate citation_id {citation_id!r}")
            seen.add(citation_id)
            prompt_id = (row.get("prompt_id") or "").strip()
            engine = (row.get("engine") or "").strip()
            if not prompt_id or not engine:
                raise ValueError(f"line {line}: prompt_id and engine are required")
            raw = (row.get("url") or "").strip()
            rows.append({"citation_id": citation_id, "prompt_id": prompt_id,
                         "engine": engine, "url": raw, "host": host_for(raw)})
    if not rows:
        raise ValueError("CSV contains no citation rows")
    counts = Counter(row["host"] for row in rows)
    total = len(rows)
    hosts = [{"host": host, "count": counts[host], "share": round(counts[host] / total, 6)}
             for host in sorted(counts, key=lambda h: (-counts[h], h))]
    shares = [item["count"] / total for item in hosts]
    hhi = sum(share * share for share in shares)
    return {"total_citations": total, "unique_hosts": len(hosts), "hosts": hosts,
            "top_one_share": round(shares[0], 6), "top_three_share": round(sum(shares[:3]), 6),
            "hhi_0_to_1": round(hhi, 6), "hhi_0_to_10000": round(hhi * 10000, 6),
            "effective_domain_count": round(1 / hhi, 6)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="citation CSV")
    parser.add_argument("--output", help="write JSON report to this path")
    args = parser.parse_args()
    try:
        result = report(args.input)
    except (OSError, ValueError, UnicodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        with open(args.output, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(rendered)
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
