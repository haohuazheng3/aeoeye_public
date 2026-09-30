#!/usr/bin/env python3
"""Plan equal-size, two-group mention-rate experiments with a normal approximation."""

import argparse
import json
import math
import sys
from pathlib import Path
from statistics import NormalDist


def sample_size(p0: float, p1: float, alpha: float, power: float) -> int:
    """Return the required observations in each independent group."""
    if not (0 < p0 < 1 and 0 < p1 < 1):
        raise ValueError("p0 and p1 must be strictly between 0 and 1")
    if p0 == p1:
        raise ValueError("p0 and p1 must be different")
    if not (0 < alpha < 1):
        raise ValueError("alpha must be strictly between 0 and 1")
    if not (0 < power < 1):
        raise ValueError("power must be strictly between 0 and 1")
    pooled = (p0 + p1) / 2
    z_alpha = NormalDist().inv_cdf(1 - alpha / 2)
    z_power = NormalDist().inv_cdf(power)
    numerator = (
        z_alpha * math.sqrt(2 * pooled * (1 - pooled))
        + z_power * math.sqrt(p0 * (1 - p0) + p1 * (1 - p1))
    ) ** 2
    return math.ceil(numerator / (p1 - p0) ** 2)


def calculate(scenario: dict) -> dict:
    required = ("name", "baseline_rate", "target_rate", "alpha", "power")
    missing = [key for key in required if key not in scenario]
    if missing:
        raise ValueError("missing fields: " + ", ".join(missing))
    values = {key: scenario[key] for key in required[1:]}
    try:
        values = {key: float(value) for key, value in values.items()}
    except (TypeError, ValueError) as exc:
        raise ValueError("rates, alpha, and power must be numbers") from exc
    per_group = sample_size(
        values["baseline_rate"], values["target_rate"], values["alpha"], values["power"]
    )
    return {
        "name": str(scenario["name"]),
        "baseline_rate": values["baseline_rate"],
        "target_rate": values["target_rate"],
        "alpha": values["alpha"],
        "power": values["power"],
        "per_group_observations": per_group,
        "total_observations": per_group * 2,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        scenarios = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(scenarios, list) or not scenarios:
            raise ValueError("input must be a non-empty JSON array")
        report = {"scenarios": [calculate(item) for item in scenarios]}
        rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
        args.output.write_text(rendered, encoding="utf-8")
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
