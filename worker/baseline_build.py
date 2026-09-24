import argparse
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import yaml

from worker.gcs_io import StorageIO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("worker.baseline_build")


def build_baseline_artifacts(
    df: pd.DataFrame,
    features_config: Dict[str, Any],
    rules_config: Optional[Dict[str, Any]] = None,
    num_bins: int = 10,
) -> Tuple[Dict[str, Any], pd.DataFrame]:
    """
    Computes quantile bin edges and baseline statistics for all declared features.
    Returns:
        bins_meta: dictionary with bin edges, categories, and summary stats
        sample_df: representative baseline DataFrame for KS/PSI testing
    """
    features = features_config.get("features", [])
    bins_meta = {
        "dataset_name": features_config.get("dataset_name", "credit_risk"),
        "created_at": pd.Timestamp.utcnow().isoformat(),
        "total_baseline_samples": len(df),
        "num_bins": num_bins,
        "features": {},
    }

    for f in features:
        name = f["name"]
        f_type = f.get("type", "numerical")

        if name not in df.columns:
            logger.warning("Feature '%s' declared in config but missing in training DataFrame", name)
            continue

        series = df[name].dropna()

        if f_type == "numerical":
            num_clean = pd.to_numeric(series, errors="coerce").dropna().to_numpy()
            if len(num_clean) == 0:
                continue

            quantiles = np.linspace(0, 1, num_bins + 1)
            raw_edges = np.unique(np.quantile(num_clean, quantiles)).tolist()

            if len(raw_edges) < 2:
                v = float(num_clean[0])
                raw_edges = [v - 1.0, v + 1.0]

            # Replace extremes with -inf and +inf for binning
            calc_edges = list(raw_edges)
            calc_edges[0] = -np.inf
            calc_edges[-1] = np.inf

            counts, _ = np.histogram(num_clean, bins=calc_edges)
            pcts = (counts / max(len(num_clean), 1)).tolist()

            bins_meta["features"][name] = {
                "type": "numerical",
                "bin_edges": [round(float(x), 4) for x in raw_edges],
                "baseline_percentages": [round(float(p), 5) for p in pcts],
                "mean": round(float(np.mean(num_clean)), 3),
                "std": round(float(np.std(num_clean)), 3),
                "median": round(float(np.median(num_clean)), 3),
                "min": round(float(np.min(num_clean)), 3),
                "max": round(float(np.max(num_clean)), 3),
            }

        elif f_type == "categorical":
            cat_series = series.astype(str)
            value_counts = cat_series.value_counts(normalize=True).to_dict()
            configured_allowed = f.get("allowed_values", [])
            all_cats = sorted(list(set(configured_allowed).union(set(value_counts.keys()))))

            cat_pcts = {cat: round(float(value_counts.get(cat, 0.0)), 5) for cat in all_cats}

            bins_meta["features"][name] = {
                "type": "categorical",
                "categories": all_cats,
                "category_percentages": cat_pcts,
                "top_category": str(cat_series.mode().iloc[0]) if not cat_series.empty else "",
            }

    # If prediction scores exist in training df, compute baseline for prediction_score
    if "prediction_score" in df.columns:
        p_clean = pd.to_numeric(df["prediction_score"], errors="coerce").dropna().to_numpy()
        fixed_edges = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        counts, _ = np.histogram(p_clean, bins=fixed_edges)
        pcts = (counts / max(len(p_clean), 1)).tolist()
        bins_meta["features"]["prediction_score"] = {
            "type": "numerical",
            "bin_edges": fixed_edges,
            "baseline_percentages": [round(float(p), 5) for p in pcts],
            "mean": round(float(np.mean(p_clean)), 4),
        }

    # Take up to 10,000 rows as representative sample
    sample_size = min(len(df), 10000)
    sample_df = df.sample(n=sample_size, random_state=42) if len(df) > sample_size else df.copy()

    return bins_meta, sample_df


def main():
    parser = argparse.ArgumentParser(description="Build baseline distribution artifacts from reference dataset")
    parser.add_argument("--input", default="tests/fixtures/sample_train.parquet", help="Path to reference dataset")
    parser.add_argument("--config-features", default="config/features.json", help="Path to features.json")
    parser.add_argument("--config-rules", default="config/rules.yaml", help="Path to rules.yaml")
    parser.add_argument("--output-prefix", default="baseline", help="Destination storage prefix")
    args = parser.parse_args()

    # Load configs
    with open(args.config_features, "r") as f:
        features_config = json.load(f)

    rules_config = {}
    if os.path.exists(args.config_rules):
        with open(args.config_rules, "r") as f:
            rules_config = yaml.safe_load(f)

    # Read training data
    input_path = args.input
    if not os.path.exists(input_path):
        # Check fallback
        fallback = input_path.replace(".parquet", ".csv")
        if os.path.exists(fallback):
            df = pd.read_csv(fallback)
        else:
            raise FileNotFoundError(f"Reference dataset not found at {input_path}")
    else:
        try:
            df = pd.read_parquet(input_path)
        except Exception:
            # Fallback if pyarrow not ready
            fallback = input_path.replace(".parquet", ".csv")
            if os.path.exists(fallback):
                df = pd.read_csv(fallback)
            else:
                raise

    logger.info("Loaded reference dataset with %d rows and %d columns", len(df), len(df.columns))

    bins_meta, sample_df = build_baseline_artifacts(df, features_config, rules_config)

    # Write to storage
    storage_io = StorageIO()
    storage_io.write_json(f"{args.output_prefix}/bins.json", bins_meta)
    storage_io.write_parquet(f"{args.output_prefix}/ref_sample.parquet", sample_df)

    logger.info("Successfully built and saved baseline artifacts to %s/", args.output_prefix)


if __name__ == "__main__":
    main()
