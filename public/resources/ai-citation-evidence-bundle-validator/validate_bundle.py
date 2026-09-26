#!/usr/bin/env python3
"""Validate a citation-evidence bundle without mutating the bundle."""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SAFE_PATH = re.compile(r"^(?!/)(?!.*(?:^|/)\.\.?/)[A-Za-z0-9._/-]+$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")

def issue(code, detail):
    return {"code": code, "detail": detail}

def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def csv_rows(path, label):
    import csv
    if not path.is_file():
        raise ValueError(f"{label} is missing")
    with path.open(newline="", encoding="utf-8") as handle:
        yield from csv.DictReader(handle)

def validate(bundle):
    manifest_path = bundle / "manifest.json"
    issues = []
    checked_files = 0
    if not manifest_path.is_file():
        return {"status": "invalid", "bundle": bundle.name, "checked_files": 0, "issues": [issue("manifest_missing", "manifest.json is missing")]}
    try:
        manifest = read_json(manifest_path)
    except (OSError, json.JSONDecodeError) as exc:
        return {"status": "invalid", "bundle": bundle.name, "checked_files": 0, "issues": [issue("manifest_invalid_json", str(exc))]}
    if manifest.get("manifest_version") != "1.0":
        issues.append(issue("manifest_version", "expected 1.0"))
    entries = manifest.get("files")
    if not isinstance(entries, list):
        entries = []
        issues.append(issue("files_invalid", "files must be an array"))
    paths = []
    for entry in entries:
        if not isinstance(entry, dict):
            issues.append(issue("file_entry_invalid", "each files entry must be an object"))
            continue
        rel = entry.get("path")
        if not isinstance(rel, str) or not SAFE_PATH.fullmatch(rel) or rel == "manifest.json":
            issues.append(issue("unsafe_path", str(rel)))
            continue
        paths.append(rel)
        if paths.count(rel) > 1:
            issues.append(issue("duplicate_path", rel))
        target = bundle / rel
        if not target.is_file():
            issues.append(issue("file_missing", rel))
            continue
        checked_files += 1
        actual_size = target.stat().st_size
        actual_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        if entry.get("bytes") != actual_size:
            issues.append(issue("byte_size", f"{rel}: expected {entry.get('bytes')}, got {actual_size}"))
        if not isinstance(entry.get("sha256"), str) or not SHA256.fullmatch(entry["sha256"]):
            issues.append(issue("hash_format", rel))
        elif entry["sha256"] != actual_hash:
            issues.append(issue("sha256", f"{rel}: expected {entry['sha256']}, got {actual_hash}"))
    for ref in manifest.get("references", []):
        if not isinstance(ref, dict):
            issues.append(issue("reference_invalid", "reference must be an object"))
            continue
        source, target = ref.get("source"), ref.get("target")
        field, id_field = ref.get("field"), ref.get("id_field")
        if (
            not isinstance(source, str)
            or not isinstance(target, str)
            or not SAFE_PATH.fullmatch(source)
            or not SAFE_PATH.fullmatch(target)
            or source not in paths
            or target not in paths
        ):
            issues.append(issue("reference_path", "reference files must be safe paths listed in files"))
            continue
        try:
            source_rows = list(csv_rows(bundle / source, source))
            target_rows = list(csv_rows(bundle / target, target))
            source_ids = {row.get(field) for row in source_rows}
            target_ids = {row.get(id_field) for row in target_rows}
            for value in sorted(x for x in source_ids - target_ids if x):
                issues.append(issue("internal_id_missing", f"{source}:{field}={value} not in {target}:{id_field}"))
        except (OSError, ValueError, TypeError) as exc:
            issues.append(issue("reference_read", str(exc)))
    return {"status": "valid" if not issues else "invalid", "bundle": bundle.name, "manifest_version": manifest.get("manifest_version"), "checked_files": checked_files, "issues": issues}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--report", type=Path, help="write the JSON report here")
    args = parser.parse_args()
    report = validate(args.bundle.resolve())
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0 if report["status"] == "valid" else 1

if __name__ == "__main__":
    raise SystemExit(main())
