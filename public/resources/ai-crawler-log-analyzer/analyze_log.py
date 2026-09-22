#!/usr/bin/env python3
"""Classify claimed crawler tokens in a combined access log.

User-agent labels are claims. IP verification is a separate, optional CIDR
check supplied by the operator; this script never invents provider ranges.
"""
import argparse
import csv
import ipaddress
import re
from collections import Counter

LOG_RE = re.compile(r'^(?P<ip>\S+) \S+ \S+ \[[^]]+\] "(?P<request>[^"]*)" (?P<status>\d{3}) (?P<bytes>\S+) "(?P<ref>[^\"]*)" "(?P<ua>[^\"]*)"$')

def load_rules(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))

def load_cidrs(path):
    result = {}
    if not path:
        return result
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            result.setdefault(row["provider"], []).append(ipaddress.ip_network(row["cidr"], strict=False))
    return result

def classify(ua, rules):
    for rule in rules:
        if rule["token"].lower() in ua.lower():
            return rule["token"], rule["category"]
    return "unknown", "unknown"

def verify_ip(ip, token, cidrs):
    if token == "unknown" or not cidrs:
        return "not_checked"
    address = ipaddress.ip_address(ip)
    # Provider names in the optional file are deliberately independent of UA tokens.
    provider_for_token = {
        "GPTBot": "OpenAI", "OAI-SearchBot": "OpenAI", "ChatGPT-User": "OpenAI",
        "ClaudeBot": "Anthropic", "Claude-SearchBot": "Anthropic", "Claude-User": "Anthropic",
        "Googlebot": "Google",
    }
    provider = provider_for_token.get(token)
    if not provider or provider not in cidrs:
        return "not_checked"
    return "verified" if any(address in network for network in cidrs[provider]) else "mismatch"

def analyze(log_path, rules_path, cidr_path=None):
    rules = load_rules(rules_path)
    cidrs = load_cidrs(cidr_path)
    counts = Counter()
    malformed = 0
    with open(log_path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            match = LOG_RE.match(line)
            if not match:
                malformed += 1
                continue
            token, category = classify(match.group("ua"), rules)
            verification = verify_ip(match.group("ip"), token, cidrs)
            counts[(token, category, verification)] += 1
    rows = []
    for (token, category, verification), count in sorted(counts.items()):
        rows.append({"claimed_token": token, "claimed_category": category, "ip_verification": verification, "requests": count})
    rows.append({"claimed_token": "_TOTAL", "claimed_category": "all", "ip_verification": "malformed_lines", "requests": malformed})
    return rows

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log")
    parser.add_argument("--rules", default="provider-rules.csv")
    parser.add_argument("--cidrs", help="Optional operator-supplied provider,cidr CSV")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    rows = analyze(args.log, args.rules, args.cidrs)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["claimed_token", "claimed_category", "ip_verification", "requests"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

if __name__ == "__main__":
    main()
