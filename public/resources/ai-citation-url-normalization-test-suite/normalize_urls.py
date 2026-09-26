#!/usr/bin/env python3
"""Normalize citation URL syntax without fetching or inferring equivalence."""
import csv
import re
import sys
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urljoin, urlsplit, urlunsplit

UNRESERVED = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
TRACKING_EXACT = frozenset({"gclid", "fbclid", "msclkid"})
PERCENT = re.compile(r"%([0-9A-Fa-f]{2})")
BAD_PERCENT = re.compile(r"%(?![0-9A-Fa-f]{2})")


def normalize_percent(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        char = chr(int(match.group(1), 16))
        return char if char in UNRESERVED else "%" + match.group(1).upper()
    return PERCENT.sub(replace, text)


def remove_dot_segments(path: str) -> str:
    trailing = path.endswith("/") or path.endswith("/.") or path.endswith("/..")
    output = []
    for segment in path.split("/"):
        if segment == ".":
            continue
        if segment == "..":
            if output and output[-1] not in ("", ".."):
                output.pop()
        else:
            output.append(segment)
    result = "/".join(output)
    if trailing and result != "/":
        result += "/"
    return result or ("/" if path.startswith("/") else "")


def is_tracking(name: str) -> bool:
    lowered = name.lower()
    return lowered.startswith("utm_") or lowered in TRACKING_EXACT


def normalize(raw: str, base: str) -> tuple[str, str, str]:
    try:
        if BAD_PERCENT.search(raw):
            raise ValueError("invalid percent escape")
        resolved = urljoin(base, raw) if base else raw
        parsed = urlsplit(resolved)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            raise ValueError("absolute http(s) URL required")
        host = parsed.hostname.lower()
        try:
            port = parsed.port
        except ValueError as exc:
            raise ValueError("invalid port") from exc
        if ":" in host and not host.startswith("["):
            host = "[" + host + "]"
        netloc = host
        if parsed.username is not None:
            userinfo = parsed.username
            if parsed.password is not None:
                userinfo += ":" + parsed.password
            netloc = userinfo + "@" + netloc
        if port is not None and not ((parsed.scheme.lower() == "http" and port == 80) or (parsed.scheme.lower() == "https" and port == 443)):
            netloc += ":" + str(port)
        path = normalize_percent(remove_dot_segments(parsed.path or "/"))
        query_parts = []
        for key, value in parse_qsl(parsed.query, keep_blank_values=True):
            if not is_tracking(key):
                query_parts.append((normalize_percent(key), normalize_percent(value)))
        query = "&".join(quote(k, safe="!$'()*+,;=:/?@%") + ("=" + quote(v, safe="!$'()*+,;=:@%") if v != "" else "") for k, v in query_parts)
        key = urlunsplit((parsed.scheme.lower(), netloc, path, query, ""))
        status = "relative-resolved" if base and not urlsplit(raw).scheme else "normalized"
        note = "fragment removed; named tracking keys dropped"
        if not query_parts and parsed.query:
            note = "fragment removed; tracking-only query dropped"
        return key, status, note
    except (TypeError, ValueError):
        return "", "rejected", "malformed or unsupported URL; no inference"


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} cases.csv", file=sys.stderr)
        return 2
    with open(sys.argv[1], newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        writer = csv.writer(sys.stdout, lineterminator="\n")
        writer.writerow(["case_id", "raw_url", "normalized_key", "status", "decision", "notes"])
        for row in reader:
            key, status, notes = normalize(row["raw_url"], row.get("base_url", ""))
            decision = "reject" if status == "rejected" else ("review" if row.get("expected_decision") == "review" else "compare")
            writer.writerow([row["case_id"], row["raw_url"], key, status, decision, notes])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
