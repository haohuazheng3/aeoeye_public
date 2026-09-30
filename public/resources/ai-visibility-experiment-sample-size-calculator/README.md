# AI visibility experiment sample-size calculator

This dependency-free Python 3 calculator plans equal-size independent groups for a two-proportion mention-rate comparison. The scenarios and report are synthetic planning fixtures, not observations from an AI provider.

## Exact verification

From this directory:

```bash
python3 calculate_sample_size.py --input scenarios.json --output actual-report.json
cmp -s actual-report.json expected-report.json
python3 -c 'import json; p="bad.json"; json.dump([{"name":"bad","baseline_rate":0,"target_rate":0.3,"alpha":0.05,"power":0.8}],open(p,"w"))'
python3 calculate_sample_size.py --input bad.json --output bad-report.json; test $? -ne 0
```

The normal run must exit 0 and be byte-identical to `expected-report.json`. The invalid fixture must exit nonzero because a proportion of zero is outside the documented input range. The implementation uses only Python's standard library, including `statistics.NormalDist`.

## Method boundary

The script uses the pooled-null, unpooled-alternative normal approximation documented by statsmodels for equal-size independent groups and rounds each group up. It does not account for repeated prompts, clustered engines, prompt drift, missing answers, sequential peeking, multiple comparisons, or paired designs. Replace the synthetic scenarios with a declared protocol and ask a statistician to review confirmatory studies.
