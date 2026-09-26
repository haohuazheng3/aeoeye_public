# AI search audit CSV validator

This dependency-free fixture checks an answer-level export before aggregation. It is intentionally synthetic: it does not call an AI provider or claim provider performance.

Requires Python 3.9+. From this directory:

```bash
python3 validate_audit.py valid-sample.csv --output valid-report.json
python3 -c "import json; assert json.load(open('valid-report.json')) == {'file': 'valid-sample.csv', 'ok': True, 'row_count': 4, 'errors': []}"
```

The valid fixture exits 0. The invalid fixture must exit nonzero and match the checked-in report exactly:

```bash
python3 validate_audit.py invalid-sample.csv --output actual-report.json
diff -u expected-report.json actual-report.json
```

Checks cover required columns, unique `run_id`, explicit `available`/`unavailable` status, strict boolean fields, nonnegative citation counts, and blank measured fields on unavailable answers. The validator reports row numbers using CSV header line 1.
