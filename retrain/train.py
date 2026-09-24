import argparse
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from worker.gcs_io import StorageIO
from worker.simulate_drift import generate_clean_sample

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("retrain.train")


def build_pipeline(features_meta: List[Dict[str, Any]]) -> Tuple[Pipeline, List[str], List[str]]:
    """Builds an end-to-end preprocessing and classification pipeline."""
    num_cols = [f["name"] for f in features_meta if f.get("type", "numerical") == "numerical"]
    cat_cols = [f["name"] for f in features_meta if f.get("type") == "categorical"]

    num_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    cat_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
    ])

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", num_transformer, num_cols),
            ("cat", cat_transformer, cat_cols),
        ]
    )

    clf = HistGradientBoostingClassifier(
        max_iter=100,
        learning_rate=0.08,
        max_depth=5,
        random_state=42,
    )

    pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", clf),
    ])

    return pipeline, num_cols, cat_cols


def determine_next_version(models_dir: Path) -> str:
    """Finds existing vN directories and returns v{N+1}."""
    max_v = 0
    if models_dir.exists():
        for d in models_dir.iterdir():
            if d.is_dir() and re.match(r"^v\d+$", d.name):
                try:
                    num = int(d.name[1:])
                    if num > max_v:
                        max_v = num
                except ValueError:
                    pass
    return f"v{max_v + 1}"


def train_challenger(
    models_dir: str = "./data/models",
    features_config_path: str = "config/features.json",
    data_source: str = "recent_logs",
) -> Dict[str, Any]:
    """
    Trains a new Challenger model combining baseline data and fresh production logs.
    """
    with open(features_config_path, "r") as f:
        features_config = json.load(f)

    models_path = Path(models_dir)
    models_path.mkdir(parents=True, exist_ok=True)
    challenger_dir = models_path / "challenger"
    challenger_dir.mkdir(parents=True, exist_ok=True)

    storage_io = StorageIO()

    # Load baseline dataset
    try:
        baseline_df = storage_io.read_parquet("baseline/ref_sample.parquet")
    except Exception:
        logger.info("Baseline ref_sample not found in storage. Generating synthetic baseline dataset.")
        baseline_df = generate_clean_sample(n=2500, seed=42)

    # Load production logs
    prod_df = pd.DataFrame()
    if data_source == "recent_logs":
        end_t = datetime.now(timezone.utc)
        start_t = end_t - pd.Timedelta(days=7)
        prod_df = storage_io.read_inference_partitions(start_t, end_t)

    if not prod_df.empty and len(prod_df) >= 100:
        logger.info("Merging %d baseline rows with %d recent production rows", len(baseline_df), len(prod_df))
        combined_df = pd.concat([baseline_df, prod_df], ignore_index=True)
    else:
        logger.info("No sufficient production data (%d rows). Training on updated baseline sample.", len(prod_df))
        combined_df = baseline_df

    target_col = "prediction_label"
    if target_col not in combined_df.columns:
        combined_df[target_col] = np.nan
    if "target" in combined_df.columns:
        combined_df[target_col] = combined_df[target_col].fillna(combined_df["target"])
    if "prediction_score" in combined_df.columns:
        combined_df[target_col] = combined_df[target_col].fillna((combined_df["prediction_score"] >= 0.5).astype(int))
    combined_df[target_col] = combined_df[target_col].fillna(0).astype(int)

    features_meta = features_config.get("features", [])
    feature_names = [f["name"] for f in features_meta]

    X = combined_df[feature_names]
    y = combined_df[target_col]

    # Split train and validation
    X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y if y.nunique() > 1 else None)

    # Build and fit pipeline
    pipeline, num_cols, cat_cols = build_pipeline(features_meta)
    logger.info("Fitting Challenger pipeline on %d training rows...", len(X_train))
    pipeline.fit(X_train, y_train)

    # Next version tag
    next_ver = determine_next_version(models_path)

    # Save challenger model
    model_artifact_path = challenger_dir / "model.joblib"
    joblib.dump(pipeline, model_artifact_path)

    # Save evaluation dataset
    val_df = X_val.copy()
    val_df["target"] = y_val
    storage_io.write_parquet("models/challenger/eval_data.parquet", val_df)
    # Also save local copy for convenience
    val_df.to_csv(challenger_dir / "eval_data.csv", index=False)

    metadata = {
        "candidate_version": next_ver,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "train_samples": len(X_train),
        "val_samples": len(X_val),
        "num_features": num_cols,
        "cat_features": cat_cols,
        "model_artifact": str(model_artifact_path),
    }

    with open(challenger_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    logger.info("Challenger model %s trained successfully and saved to %s", next_ver, challenger_dir)
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Train Challenger ML Model")
    parser.add_argument("--models-dir", default="./data/models", help="Directory where models are saved")
    parser.add_argument("--features-config", default="config/features.json", help="Path to features.json")
    parser.add_argument("--data-source", default="recent_logs", help="Data source: recent_logs or baseline_only")
    args = parser.parse_args()

    train_challenger(args.models_dir, args.features_config, args.data_source)


if __name__ == "__main__":
    main()
