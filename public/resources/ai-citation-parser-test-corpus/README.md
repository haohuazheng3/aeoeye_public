# AI citation parser test corpus

This directory contains 24 populated, synthetic JSON Lines cases for regression-testing citation extraction. The text is original fixture text, not copied answer text. It is intentionally small enough to inspect in a code review and varied enough to expose common parser mistakes.

## Files

- `cases.jsonl`: one JSON object per line. Each case has an answer, one or more claims, source records, and an explicit ambiguity note.
- `expected-results.csv`: one expected row for every claim, including the secondary claims used in repeat and scope tests.
- `validate.py`: dependency-free Python 3.9 validator.

## Run it

```bash
python3 validate.py
```

The validator exits nonzero when the JSONL count, IDs, required categories, claim labels, source counts, or ambiguity notes drift from the expected CSV. It checks structure and declared labels; it does not prove that a source supports a claim.

## Suggested parser contract

Keep these decisions separate in your output: whether a marker-like token was detected, what kind it is, which source records it resolves to, which claims it might scope, and whether a reviewer judged the claim supported, contradicted, or insufficient. A detected marker is not evidence of support. A repeated marker points to the same source unless the source mapping explicitly says otherwise. A bare URL is a source pointer, not automatically a numbered citation. Malformed markers and uncited claims should remain visible as negative cases.

The examples are synthetic and are not a benchmark, accuracy claim, or statement about any provider's interface. Before running on live answers, define your sampling frame, preserve raw answer text under your own retention policy, and review ambiguous scope manually.
