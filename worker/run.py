import argparse
import hashlib
import hmac
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
import requests
import yaml

from worker.gcs_io import StorageIO
from worker.metrics import compute_feature_metrics, compute_prediction_drift
from worker.quality import DataQualityChecker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("worker.run")


def calculate_hmac_signature(secret_key: str, body_bytes: bytes) -> str:
    """Computes HMAC-SHA256 signature for API authentication."""
    sig = hmac.new(secret_key.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


def execute_drift_run(
    window_hours: int = 6,
    target_date: Optional[str] = None,
    features_config_path: str = "config/features.json",
    rules_config_path: str = "config/rules.yaml",
) -> Dict[str, Any]:
    """
    Near-real-time batch drift quantification runner.
    Processes partitions over the designated monitoring window.
    """
    # 1. Load configurations
    with open(features_config_path, "r") as f:
        features_config = json.load(f)

    with open(rules_config_path, "r") as f:
        rules_config = yaml.safe_load(f)

    storage_io = StorageIO()

    # 2. Establish monitoring window
    if target_date:
        end_time = datetime.fromisoformat(target_date).replace(tzinfo=timezone.utc)
    else:
        end_time = datetime.now(timezone.utc)
    start_time = end_time - timedelta(hours=window_hours)

    logger.info("Executing batch drift run for window: %s to %s (%d hours)", start_time.isoformat(), end_time.isoformat(), window_hours)

    # 3. Load baseline reference artifacts
    bins_meta = storage_io.read_json("baseline/bins.json")
    if not bins_meta:
        logger.error("Baseline bins.json not found in storage. Run scripts/seed_baseline.sh first.")
        raise FileNotFoundError("Baseline bins metadata not found")

    try:
        ref_df = storage_io.read_parquet("baseline/ref_sample.parquet")
    except Exception as e:
        logger.error("Failed to load baseline ref_sample.parquet: %s", e)
        raise

    # 4. Load production inference logs from partitions
    curr_df = storage_io.read_inference_partitions(start_time, end_time)

    # If empty in mock environment, generate representative sample for testing
    if curr_df.empty:
        logger.warning("No production logs found in window. Checking for test/fallback generation.")
        # If in local development or CI test mode, fall back to sample for continuity
        if os.getenv("DRIFT_MOCK_FALLBACK", "false").lower() == "true":
            from worker.simulate_drift import generate_clean_sample
            logger.info("DRIFT_MOCK_FALLBACK enabled: Generating clean fallback sample")
            curr_df = generate_clean_sample(n=250)
        else:
            logger.warning("Inference log partitions are empty for this batch window.")

    sample_count = len(curr_df)
    min_samples = rules_config.get("monitoring", {}).get("min_samples", 100)

    # 5. Execute Data Quality Checks
    quality_checker = DataQualityChecker(features_config, rules_config)
    quality_report = quality_checker.run_checks(curr_df)

    if sample_count < min_samples:
        logger.warning("Batch sample count (%d) is below min_samples threshold (%d)", sample_count, min_samples)
        status = "INSUFFICIENT_DATA"
        payload = {
            "window_start": start_time.isoformat(),
            "window_end": end_time.isoformat(),
            "sample_count": sample_count,
            "overall_status": status,
            "max_psi": 0.0,
            "quality_report": quality_report,
            "features": [],
            "prediction_drift": None,
            "summary": f"Batch contained {sample_count} samples (minimum required: {min_samples}). Drift computation skipped.",
        }
        return payload

    # 6. Compute Feature Drift Metrics
    features_list = features_config.get("features", [])
    feature_results = []
    max_psi = 0.0
    severe_drift_count = 0
    warning_drift_count = 0

    for f_meta in features_list:
        fname = f_meta["name"]
        f_bins = bins_meta.get("features", {}).get(fname, {})
        metrics = compute_feature_metrics(f_meta, ref_df, curr_df, bins_meta=bins_meta.get("features", {}), rules=rules_config)
        feature_results.append(metrics)

        psi = metrics["psi"]
        if psi > max_psi:
            max_psi = psi

        if metrics["status"] == "DRIFT":
            severe_drift_count += 1
        elif metrics["status"] == "WARNING":
            warning_drift_count += 1

    # 7. Compute Prediction Drift if prediction score is present
    pred_col = rules_config.get("monitoring", {}).get("prediction_column", "prediction_score")
    pred_drift_result = None
    if pred_col in curr_df.columns and pred_col in ref_df.columns:
        pred_drift_result = compute_prediction_drift(ref_df[pred_col], curr_df[pred_col], rules=rules_config)

    # 8. Determine Overall Status
    severe_thresh = rules_config.get("retraining", {}).get("trigger_conditions", {}).get("severe_drift_feature_count", 2)
    trigger_pred = rules_config.get("retraining", {}).get("trigger_conditions", {}).get("trigger_on_prediction_drift", True)

    is_prediction_drifted = pred_drift_result and pred_drift_result.get("status") == "DRIFT"
    has_severe_feature_drift = severe_drift_count >= severe_thresh

    if has_severe_feature_drift or (trigger_pred and is_prediction_drifted) or not quality_report["passed"]:
        overall_status = "DRIFT_DETECTED"
    elif severe_drift_count > 0 or warning_drift_count > 0 or len(quality_report["warning_violations"]) > 0:
        overall_status = "WARNING"
    else:
        overall_status = "STABLE"

    payload = {
        "window_start": start_time.isoformat(),
        "window_end": end_time.isoformat(),
        "sample_count": sample_count,
        "overall_status": overall_status,
        "max_psi": round(max_psi, 4),
        "severe_drift_count": severe_drift_count,
        "warning_drift_count": warning_drift_count,
        "quality_report": quality_report,
        "features": feature_results,
        "prediction_drift": pred_drift_result,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    # 9. Write audit report to storage
    report_name = f"reports/report_{end_time.strftime('%Y%m%d_%H%M%S')}.json"
    storage_io.write_json(report_name, payload)
    logger.info("Saved drift report to %s with status: %s (Max PSI: %.4f)", report_name, overall_status, max_psi)

    return payload


def send_payload_to_api(payload: Dict[str, Any], api_url: str, secret_key: str):
    """Posts drift summary with HMAC authentication to the web ingest endpoint."""
    body_bytes = json.dumps(payload, default=str).encode("utf-8")
    signature = calculate_hmac_signature(secret_key, body_bytes)

    headers = {
        "Content-Type": "application/json",
        "X-Signature-SHA256": signature,
        "X-Timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        resp = requests.post(api_url, data=body_bytes, headers=headers, timeout=15)
        logger.info("API ingest response: %d - %s", resp.status_code, resp.text)
        resp.raise_for_status()
    except Exception as e:
        logger.error("Failed to post drift summary to API %s: %s", api_url, e)


def main():
    parser = argparse.ArgumentParser(description="Near-real-time batch drift quantification worker")
    parser.add_argument("--window-hours", type=int, default=6, help="Window of inference partitions in hours")
    parser.add_argument("--target-date", default=None, help="Target end timestamp (ISO 8601)")
    parser.add_argument("--skip-api-post", action="store_true", help="Do not POST to web API")
    args = parser.parse_args()

    payload = execute_drift_run(window_hours=args.window_hours, target_date=args.target_date)

    api_url = os.getenv("WEB_API_URL", "http://localhost:3000/api/drift/ingest")
    secret_key = os.getenv("DRIFT_HMAC_SECRET", "super-secret-hmac-key")

    if not args.skip_api_post and api_url:
        send_payload_to_api(payload, api_url, secret_key)


if __name__ == "__main__":
    main()
