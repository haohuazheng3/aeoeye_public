# AI recommendation coding agreement calculator

This dependency-free Python 3 package calculates a deterministic confusion matrix,
marginals, observed agreement, expected agreement, Cohen's kappa, category counts,
and disagreements for two reviewers using the three-code contract:
`not_mentioned`, `mentioned`, `recommended`.

Run the populated synthetic fixture and compare every output byte with the committed expectation:

```sh
python3 calculate_agreement.py ratings.csv --check expected-report.json
```

The command exits `0` only when the generated JSON exactly matches the expectation. The fixture
has 24 synthetic answer rows and is not a provider observation, validation study, or claim about
reviewer quality. To test the undefined-kappa branch (all mass in one category), run:

```sh
python3 calculate_agreement.py all-one-category.csv
```

The report exits `0`, sets `cohens_kappa` to `null`, and records
`undefined_reason: "expected_agreement_is_1"`; the implementation never divides by zero.
Malformed IDs, blank ratings, unknown codes, and an empty file exit nonzero.
