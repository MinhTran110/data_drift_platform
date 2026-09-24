import argparse
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score,
    f1_score,
    log_loss,
    roc_auc_score,
)
import yaml

from worker.gcs_io import StorageIO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("retrain.evaluate")


def evaluate_pipeline(pipeline: Any, X: pd.DataFrame, y: pd.Series) -> Dict[str, float]:
    """Computes comprehensive classification metrics and inference latency."""
    t0 = time.time()
    if hasattr(pipeline, "predict_proba"):
        probs = pipeline.predict_proba(X)
        scores = probs[:, 1] if probs.shape[1] > 1 else probs[:, 0]
    else:
        scores = pipeline.predict(X).astype(float)
    latency_ms = ((time.time() - t0) / max(len(X), 1)) * 1000.0

    preds = (scores >= 0.5).astype(int)

    # Calculate metrics safely
    try:
        auc = roc_auc_score(y, scores) if y.nunique() > 1 else 0.5
    except Exception:
        auc = 0.5

    try:
        pr_auc = average_precision_score(y, scores) if y.nunique() > 1 else float(y.mean())
    except Exception:
        pr_auc = 0.5

    f1 = f1_score(y, preds, zero_division=0)
    try:
        loss = log_loss(y, np.clip(scores, 1e-6, 1.0 - 1e-6))
    except Exception:
        loss = 0.0

    return {
        "roc_auc": round(float(auc), 4),
        "pr_auc": round(float(pr_auc), 4),
        "f1_score": round(float(f1), 4),
        "log_loss": round(float(loss), 4),
        "latency_ms": round(float(latency_ms), 3),
    }


def compare_champion_challenger(
    models_dir: str = "./data/models",
    rules_config_path: str = "config/rules.yaml",
) -> Dict[str, Any]:
    """
    Evaluates Champion vs Challenger model on the validation split.
    Emits promotion gate verdict: APPROVED or REJECTED.
    """
    models_path = Path(models_dir)
    challenger_dir = models_path / "challenger"
    latest_manifest = models_path / "latest.json"

    # 1. Load evaluation data
    storage_io = StorageIO()
    try:
        eval_df = storage_io.read_parquet("models/challenger/eval_data.parquet")
    except Exception:
        csv_path = challenger_dir / "eval_data.csv"
        if csv_path.exists():
            eval_df = pd.read_csv(csv_path)
        else:
            raise FileNotFoundError("Evaluation data for challenger not found")

    target_col = "target"
    X = eval_df.drop(columns=[target_col], errors="ignore")
    y = eval_df[target_col]

    # 2. Load Challenger
    with open(challenger_dir / "metadata.json", "r") as f:
        challenger_meta = json.load(f)
    challenger_pipeline = joblib.load(challenger_dir / "model.joblib")
    challenger_metrics = evaluate_pipeline(challenger_pipeline, X, y)

    # 3. Load Champion
    champion_metrics = None
    champion_ver = "none"
    if latest_manifest.exists():
        with open(latest_manifest, "r") as f:
            champ_meta = json.load(f)
        champion_ver = champ_meta.get("version", "v1")
        champ_model_path = models_path / champ_meta.get("model_path", f"{champion_ver}/model.joblib")
        if champ_model_path.exists():
            champion_pipeline = joblib.load(champ_model_path)
            champion_metrics = evaluate_pipeline(champion_pipeline, X, y)

    if champion_metrics is None:
        # Initial cold start - Challenger is the first model
        logger.info("No existing champion found. Challenger automatically qualifies as first champion.")
        champion_metrics = {
            "roc_auc": 0.5,
            "pr_auc": 0.5,
            "f1_score": 0.0,
            "log_loss": 1.0,
            "latency_ms": 0.0,
        }
        verdict = "APPROVED"
        reason = "Initial baseline model (no champion to compare against)"
    else:
        # Load rules
        rules = {}
        if os.path.exists(rules_config_path):
            with open(rules_config_path, "r") as f:
                rules = yaml.safe_load(f)
        eval_rules = rules.get("retraining", {}).get("evaluation", {})
        min_auc_delta = eval_rules.get("min_roc_auc_delta", 0.0)
        max_degradation = eval_rules.get("max_perf_degradation", 0.01)

        auc_delta = challenger_metrics["roc_auc"] - champion_metrics["roc_auc"]

        if auc_delta >= -max_degradation:
            verdict = "APPROVED"
            reason = f"Challenger ROC-AUC ({challenger_metrics['roc_auc']:.4f}) meets criteria compared to Champion ({champion_metrics['roc_auc']:.4f}, delta: {auc_delta:+.4f})"
        else:
            verdict = "REJECTED"
            reason = f"Challenger ROC-AUC degraded by {abs(auc_delta):.4f} exceeding allowable limit {max_degradation}"

    report = {
        "timestamp": pd.Timestamp.utcnow().isoformat(),
        "champion_version": champion_ver,
        "challenger_version": challenger_meta.get("candidate_version", "v_next"),
        "verdict": verdict,
        "reason": reason,
        "metrics": {
            "champion": champion_metrics,
            "challenger": challenger_metrics,
            "delta": {
                "roc_auc": round(challenger_metrics["roc_auc"] - champion_metrics["roc_auc"], 4),
                "f1_score": round(challenger_metrics["f1_score"] - champion_metrics["f1_score"], 4),
                "log_loss": round(challenger_metrics["log_loss"] - champion_metrics["log_loss"], 4),
            },
        },
    }

    # Save verdict
    verdict_path = challenger_dir / "eval_verdict.json"
    with open(verdict_path, "w") as f:
        json.dump(report, f, indent=2)

    logger.info("Evaluation Complete. Verdict: %s", verdict)
    logger.info("Champion ROC-AUC: %.4f | Challenger ROC-AUC: %.4f (Delta: %+.4f)",
                champion_metrics["roc_auc"], challenger_metrics["roc_auc"], report["metrics"]["delta"]["roc_auc"])

    return report


def main():
    parser = argparse.ArgumentParser(description="Offline evaluation of Champion vs Challenger")
    parser.add_argument("--models-dir", default="./data/models", help="Directory where models are saved")
    parser.add_argument("--rules-config", default="config/rules.yaml", help="Path to rules.yaml")
    args = parser.parse_args()

    compare_champion_challenger(args.models_dir, args.rules_config)


if __name__ == "__main__":
    main()
