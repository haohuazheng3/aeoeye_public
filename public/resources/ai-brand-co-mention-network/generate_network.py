#!/usr/bin/env python3
"""Build weighted co-mention edges and node counts from coded answer rows.

Input rows must contain answer_id, prompt_id, engine, run_id, brand, position,
and recommended. Each answer contributes at most one count to each unordered
brand pair, even if a source CSV repeats a brand row.
"""
import argparse
import csv
import itertools
from collections import defaultdict


REQUIRED = {"answer_id", "prompt_id", "engine", "run_id", "brand", "position", "recommended"}


def read_rows(path):
    with open(path, "r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED - set(reader.fieldnames or [])
        if missing:
            raise ValueError("missing columns: " + ", ".join(sorted(missing)))
        return list(reader)


def build(rows):
    answers = defaultdict(set)
    prompts = defaultdict(set)
    engines = defaultdict(set)
    recommended = defaultdict(set)
    for row in rows:
        answer = row["answer_id"].strip()
        brand = row["brand"].strip()
        if not answer or not brand:
            raise ValueError("answer_id and brand cannot be empty")
        answers[answer].add(brand)
        prompts[brand].add(row["prompt_id"].strip())
        engines[brand].add(row["engine"].strip())
        if row["recommended"].strip().lower() in {"true", "1", "yes"}:
            recommended[brand].add(answer)

    edge_counts = defaultdict(int)
    edge_answers = defaultdict(set)
    for answer_id, brands in answers.items():
        for left, right in itertools.combinations(sorted(brands), 2):
            key = (left, right)
            edge_counts[key] += 1
            edge_answers[key].add(answer_id)

    nodes = []
    for brand in sorted(answers_by_brand(answers)):
        brand_answers = answers_by_brand(answers)[brand]
        nodes.append({
            "brand": brand,
            "answer_count": str(len(brand_answers)),
            "prompt_count": str(len(prompts[brand])),
            "engine_count": str(len(engines[brand])),
            "recommended_answer_count": str(len(recommended[brand])),
        })
    edges = [{
        "brand_a": left,
        "brand_b": right,
        "co_mention_count": str(edge_counts[(left, right)]),
        "answer_ids": ";".join(sorted(edge_answers[(left, right)])),
    } for left, right in sorted(edge_counts)]
    return nodes, edges


def answers_by_brand(answers):
    result = defaultdict(set)
    for answer_id, brands in answers.items():
        for brand in brands:
            result[brand].add(answer_id)
    return result


def write_csv(path, fieldnames, rows):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_csv")
    parser.add_argument("output_dir")
    args = parser.parse_args()
    rows = read_rows(args.input_csv)
    nodes, edges = build(rows)
    import os
    os.makedirs(args.output_dir, exist_ok=True)
    write_csv(os.path.join(args.output_dir, "edges.csv"),
              ["brand_a", "brand_b", "co_mention_count", "answer_ids"], edges)
    write_csv(os.path.join(args.output_dir, "nodes.csv"),
              ["brand", "answer_count", "prompt_count", "engine_count", "recommended_answer_count"], nodes)


if __name__ == "__main__":
    main()
