# AI Search Prompt Coverage Auditor

This dependency-free Python 3 tool audits declared coverage in a prompt register. It checks required CSV columns, unique prompt IDs, allowed statuses, known dimensions, minimum counts for required dimension/value pairs, and unrecognized active values. Only `active` rows count; `disabled` and `excluded` rows are retained as explicit exclusions.

The fixture is synthetic. It is not a sample of real search demand, prompt popularity, provider behavior, or market representativeness. The normal run exits `1` because it intentionally contains gaps; `--allow-gaps` emits the same deterministic report but exits `0` for exploratory work.

## Files

- `audit_prompt_coverage.py` — standard-library-only auditor.
- `prompts.csv` — 20 populated synthetic rows, including disabled and excluded rows.
- `requirements.csv` — declared dimensions, values, and minimum active counts.
- `expected-report.json` — byte-level expected output.

## Exact verification

From this directory:

```bash
python3 audit_prompt_coverage.py --prompts prompts.csv --requirements requirements.csv --output actual-report.json; test $? -eq 1
cmp -s actual-report.json expected-report.json
python3 audit_prompt_coverage.py --prompts prompts.csv --requirements requirements.csv --output allow-gaps-report.json --allow-gaps
cmp -s allow-gaps-report.json expected-report.json
```

The first run must exit `1` for the deliberate gaps. The second must exit `0` while producing byte-identical JSON. To exercise a validation failure, copy `requirements.csv`, change one `stage` dimension to undeclared `bogus`, and run the first command; it must exit `2` and write no report.

## Adapting it

Add a column for each declared sampling dimension, then add its required values and minimums to `requirements.csv`. Keep the prompt ID, status, exact engine label, locale, persona, stage, and topic in the register. Treat requirements as a declared frame: passing this check does not prove that the frame is representative or that an engine answered accurately.

The audit vocabulary is compatible with risk documentation practices in the [NIST AI Risk Management Framework](https://www.nist.gov/itl/ai-risk-management-framework), the [NIST Generative AI Profile](https://doi.org/10.6028/NIST.AI.600-1), provenance concepts in [W3C PROV-O](https://www.w3.org/TR/prov-o/), and Python's [CSV module documentation](https://docs.python.org/3/library/csv.html).
