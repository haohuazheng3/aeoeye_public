# AI Citation Evidence Bundle Validator

This complete bundle is a **synthetic fixture**. It is not a live AI-engine observation and its example URLs do not support a research conclusion.

Run the baseline check from this directory:

```sh
python3 validate_bundle.py bundle --report /tmp/citation-bundle-report.json
cmp /tmp/citation-bundle-report.json expected-report.json
```

The command exits `0` and the report is byte-identical to `expected-report.json`. To test tamper detection without changing the baseline, copy the bundle, change one byte, then run the validator against the copy:

```sh
tmp_dir=$(mktemp -d)
cp -R bundle "$tmp_dir/bundle"
printf 'x' >> "$tmp_dir/bundle/evidence/notes.txt"
python3 validate_bundle.py "$tmp_dir/bundle" --report "$tmp_dir/report.json"; test "$?" -ne 0
cmp "$tmp_dir/report.json" expected-report.json && echo 'unexpected match' || echo 'tamper report differs as expected'
```

The validator checks manifest version `1.0`, safe relative paths, duplicate paths, existence, byte sizes, SHA-256 values, and closure of `citation_id` references from `answers.csv` to `citations.csv`. It never rewrites manifest hashes or the expected report.
