# AI Search Metrics SQL Starter Kit

This package turns exported AI-answer audit rows into transparent, local SQLite metrics. The included CSV is **synthetic** and is not a benchmark or a measurement of any provider.

## Run it

Requires Python 3.9+ and the standard library only:

```bash
python3 runner.py --csv ai_search_audit_sample.csv --sql queries.sql --output expected_output.csv
```

The runner imports the CSV into an in-memory SQLite database, executes each named query, and writes a combined CSV. Compare it with the checked-in `expected_output.csv` to verify a clean run.

## Field semantics

`answer_available=no` is missing at the answer level and is excluded from answer denominators. A real `citation_count=0` is a measured zero for an available answer and remains in the answer denominator. `brand_mentioned` and `brand_recommended` are separate labels: a brand can be named without being recommended. `brand_citation_rate_cited_answers` uses only answers with one or more citations as its denominator; the other citation rate uses all available answers.

## Adapt it carefully

Keep raw answer evidence and the coding guide outside this package. Add a stable run and prompt identifier, preserve the engine and capture date, and define how “recommendation” and “brand source” were adjudicated before calculating a rate. Do not combine missing answers with “no” unless the study explicitly treats non-response as a zero. Do not describe these SQL outputs as a population estimate, causal effect, or provider ranking.

## Files

- `ai_search_audit_sample.csv` — populated synthetic input.
- `queries.sql` — answer-level and citation-level query pack.
- `runner.py` — dependency-free importer and runner.
- `expected_output.csv` — expected result for the included sample.
