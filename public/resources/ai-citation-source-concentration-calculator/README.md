# AI citation source concentration calculator

This dependency-free Python 3 calculator turns an answer-level citation CSV into a deterministic, descriptive concentration report. The fixture is synthetic: it is not a provider observation, benchmark, market estimate, or claim about which domains AI systems cite.

## Run the fixture

```sh
python3 calculate_concentration.py citations.csv > actual.json
cmp -s actual.json expected-report.json
```

The normal fixture contains 30 rows and exits `0`; `cmp` exits `0` when the generated JSON is byte-for-byte identical to `expected-report.json`. It has seven distinct hosts after normalization.

To test a failure branch without changing the fixture:

```sh
tmp=$(mktemp)
cp citations.csv "$tmp"
sed -i.bak '2s#https://#ftp://#' "$tmp"
python3 calculate_concentration.py "$tmp" >/dev/null
test $? -eq 2
rm -f "$tmp" "$tmp.bak"
```

The malformed URL command must exit `2`. The script rejects duplicate citation IDs, missing required columns, empty files, and non-absolute HTTP(S) URLs. It keeps each raw URL in the input record while using only its normalized host for counts.

## Input and metrics

Required columns are `citation_id`, `prompt_id`, `engine`, and `url`. IDs must be unique. Hosts are lower-cased, a trailing dot is removed, and one leading `www.` is removed. Registrable domains are not guessed: `blog.example.com` and `example.com` remain different hosts.

The report includes total rows, unique host count, sorted host counts and shares, top-one share, top-three share, HHI on 0–1 and 0–10,000 scales, and effective domain count (`1 / sum(share²)`). JSON is sorted and numeric values are rounded to six decimal places.

This is a transparent lens for comparing snapshots. It does not infer redirects, canonical URLs, page identity, ownership, causality, source quality, or antitrust compliance.
