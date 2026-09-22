# AI brand co-mention network generator

This folder contains a small, dependency-free Python 3.9 utility for turning
coded AI-answer brand lists into a weighted, undirected edge list and node
table. The CSV is synthetic and is not a market benchmark.

## Run

```bash
python3 generate_network.py answer-brands.csv /tmp/aeoeye-network-output
```

The command writes `edges.csv` and `nodes.csv`. To reproduce the checked
fixture, compare those files with `expected-edges.csv` and `expected-nodes.csv`
after running the command.

## Input contract

Each row represents one brand coded in one answer. Required columns are
`answer_id`, `prompt_id`, `engine`, `run_id`, `brand`, `position`, and
`recommended`. Keep the answer, prompt, engine, and run identifiers: the
network is only meaningful within the declared collection scope.

## Counting rules

Brand names are trimmed, pairs are alphabetized, and a repeated brand within
one answer is counted once. Therefore one answer contributes at most one unit
to an unordered pair. Node counts report distinct answers, prompts, engines,
and answers where `recommended` is true. A co-mention is an observation, not
an endorsement, causal relationship, market-share estimate, or proof that the
brands share an independent source.

The generator does not normalize aliases, infer missing brands, remove provider
duplicates, or estimate uncertainty. Apply a documented brand codebook before
running it, and segment results by engine, prompt family, date, or run when
those strata are not comparable.
