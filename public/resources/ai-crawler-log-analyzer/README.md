# AI crawler log analyzer

This dependency-free Python 3.9 utility reads a standard combined access log and writes a CSV summary. It separates three questions:

1. What token does the user-agent claim?
2. What category does the locally maintained token rules file assign?
3. Was the source IP verified against an operator-supplied CIDR file?

The included `access.log` and `expected-summary.csv` are synthetic fixtures. The addresses use RFC 5737 documentation ranges. They are not provider traffic and must not be treated as a benchmark.

## Run

```sh
python3 analyze_log.py access.log --rules provider-rules.csv --out actual-summary.csv
cmp actual-summary.csv expected-summary.csv
```

To test IP verification, pass your own reviewed `provider,cidr` CSV with `--cidrs`. `provider-cidrs.example.csv` is only a reserved-address demonstration. It is not an assertion about OpenAI, Anthropic, Google, or Bing network ownership.

The rules were checked 2026-09-22 against [OpenAI bot documentation](https://developers.openai.com/api/docs/bots), [Anthropic's crawler support article](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler), [Googlebot verification documentation](https://developers.google.com/search/docs/crawling-indexing/googlebot), and [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html). The fixture covers search, training, user-triggered, and unknown tokens. A token match is not proof of identity. A crawl is not evidence of indexing, ranking, citation, or recommendation.
