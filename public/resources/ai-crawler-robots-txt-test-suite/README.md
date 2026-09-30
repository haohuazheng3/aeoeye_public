# AI Crawler Robots.txt Test Suite

This is a synthetic, dependency-free regression suite for a deliberately documented subset of [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309). It exercises group selection, merged groups, longest-match precedence, wildcard and terminal `$` rules, percent-encoding, case-insensitive fields/tokens, empty `Disallow`, and allow-on-tie behavior.

The policy and cases are synthetic. They do not observe a production crawler, prove that a bot will comply, or establish crawler identity. The evaluator does not implement HTTP fetch status or caching, redirects, the 500 KiB parse ceiling, non-UTF-8 recovery, authentication, IP verification, or provider-specific behavior.

## Exact reproducible check

From this directory, with Python 3.9+:

```sh
python3 evaluate_policy.py --robots robots.txt --cases cases.csv --output /tmp/robots-expected.csv
cmp expected.csv /tmp/robots-expected.csv
```

`cmp` must produce no output and exit 0. The runner also exits nonzero if a case does not produce its declared expected decision or if the fixture is not exactly 24 rows.

The synthetic `ExampleAnswerBot` token is used so this package does not ship a stale allowlist for any real provider. Adapt `robots.txt` and `cases.csv` for a real site, then review the result alongside the site's HTTP delivery and crawler documentation.
