import argparse
import json
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests

from worker.gcs_io import StorageIO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("worker.simulate_drift")


def generate_clean_sample(n: int = 500, seed: int = 42) -> pd.DataFrame:
    """Generates synthetic baseline-like credit data."""
    rng = np.random.default_rng(seed)

    age = np.clip(rng.normal(38, 12, n), 18, 85).round(0)
    income = np.clip(rng.lognormal(10.8, 0.6, n), 15000, 500000).round(-2)
    credit_score = np.clip(rng.normal(680, 75, n), 300, 850).round(0)
    debt_to_income = np.clip(rng.beta(2, 5, n) * 0.8, 0.02, 1.2).round(3)
    loan_amount = np.clip(rng.lognormal(9.2, 0.7, n), 2000, 80000).round(-2)
    interest_rate = np.clip(18.0 - (credit_score - 300) * 0.02 + rng.normal(0, 1.5, n), 3.0, 32.0).round(2)

    home_ownership_choices = ["RENT", "MORTGAGE", "OWN", "OTHER"]
    home_ownership_p = [0.45, 0.42, 0.11, 0.02]
    home_ownership = rng.choice(home_ownership_choices, size=n, p=home_ownership_p)

    loan_intent_choices = ["PERSONAL", "EDUCATION", "MEDICAL", "VENTURE", "HOMEIMPROVEMENT", "DEBTCONSOLIDATION"]
    loan_intent_p = [0.25, 0.15, 0.15, 0.10, 0.15, 0.20]
    loan_intent = rng.choice(loan_intent_choices, size=n, p=loan_intent_p)

    emp_length = np.clip(rng.exponential(5.0, n), 0, 40).round(1)

    df = pd.DataFrame({
        "age": age,
        "annual_income": income,
        "credit_score": credit_score,
        "debt_to_income_ratio": debt_to_income,
        "loan_amount": loan_amount,
        "interest_rate": interest_rate,
        "home_ownership": home_ownership,
        "loan_intent": loan_intent,
        "employment_history_length": emp_length,
    })

    # Realistic synthetic risk probability
    z = (
        -0.008 * (credit_score - 600)
        + 2.5 * debt_to_income
        + 0.05 * (interest_rate - 10)
        - 0.000003 * income
        + (df["home_ownership"] == "RENT").astype(float) * 0.3
    )
    prob = 1.0 / (1.0 + np.exp(-z))
    df["prediction_score"] = np.clip(prob, 0.01, 0.99).round(4)
    df["prediction_label"] = (df["prediction_score"] >= 0.5).astype(int)

    return df


def inject_drift(
    df: pd.DataFrame,
    drift_types: List[str],
    severity: str = "medium",
    seed: int = 123,
) -> pd.DataFrame:
    """
    Applies controlled synthetic drift transformations to DataFrame.
    Severity: 'low', 'medium', 'high'
    """
    df = df.copy()
    rng = np.random.default_rng(seed)

    sev_mult = {"low": 0.5, "medium": 1.0, "high": 2.0}.get(severity, 1.0)

    for dtype in drift_types:
        dtype = dtype.strip().lower()

        if dtype == "mean_shift":
            # Continuous mean shift: drop credit scores, raise debt-to-income
            shift_cs = int(60 * sev_mult)
            df["credit_score"] = np.clip(df["credit_score"] - shift_cs + rng.normal(0, 10, len(df)), 300, 850)

            shift_dti = 0.15 * sev_mult
            df["debt_to_income_ratio"] = np.clip(df["debt_to_income_ratio"] + shift_dti, 0.0, 1.5).round(3)

            # Raise interest rate
            df["interest_rate"] = np.clip(df["interest_rate"] + 4.0 * sev_mult, 3.0, 35.0).round(2)
            logger.info("Injected mean_shift: credit_score (-%d), debt_to_income (+%.2f)", shift_cs, shift_dti)

        elif dtype == "variance_scale":
            # Increase income dispersion / variance
            mean_inc = df["annual_income"].mean()
            scale_factor = 1.0 + 0.8 * sev_mult
            df["annual_income"] = np.clip(mean_inc + (df["annual_income"] - mean_inc) * scale_factor, 5000, 2000000)
            logger.info("Injected variance_scale: annual_income variance x%.1f", scale_factor)

        elif dtype == "category_shift":
            # Shift loan intent towards MEDICAL and DEBTCONSOLIDATION
            p_shifted = [0.10, 0.05, 0.40, 0.05, 0.05, 0.35]
            categories = ["PERSONAL", "EDUCATION", "MEDICAL", "VENTURE", "HOMEIMPROVEMENT", "DEBTCONSOLIDATION"]
            df["loan_intent"] = rng.choice(categories, size=len(df), p=p_shifted)
            # Shift home ownership towards RENT
            df["home_ownership"] = rng.choice(["RENT", "MORTGAGE", "OWN", "OTHER"], size=len(df), p=[0.75, 0.18, 0.06, 0.01])
            logger.info("Injected category_shift on loan_intent and home_ownership")

        elif dtype == "null_injection":
            # Inject missing values to trigger data quality alarm
            null_rate = min(0.08 * sev_mult, 0.40)
            mask = rng.random(len(df)) < null_rate
            df.loc[mask, "employment_history_length"] = np.nan
            logger.info("Injected null_injection: %.1f%% nulls in employment_history_length", null_rate * 100)

        elif dtype == "prediction_drift":
            # Substantial upward shift in default risk scores
            df["prediction_score"] = np.clip(df["prediction_score"] + 0.25 * sev_mult, 0.0, 1.0).round(4)
            df["prediction_label"] = (df["prediction_score"] >= 0.5).astype(int)
            logger.info("Injected prediction_drift: +%.2f score shift", 0.25 * sev_mult)

    return df


def write_simulated_partitions(
    df: pd.DataFrame,
    storage_io: StorageIO,
    target_time: Optional[datetime] = None,
    prefix: str = "inference_logs",
):
    """Writes simulated DataFrame as partitioned log files into storage."""
    target_time = target_time or datetime.now(timezone.utc)
    ts_str = target_time.isoformat()

    df = df.copy()
    if "request_id" not in df.columns:
        df["request_id"] = [f"sim_{uuid.uuid4().hex[:10]}" for _ in range(len(df))]
    if "timestamp" not in df.columns:
        df["timestamp"] = ts_str
    if "model_version" not in df.columns:
        df["model_version"] = "v1"
    if "latency_ms" not in df.columns:
        df["latency_ms"] = 12.5

    partition_path = (
        f"{prefix}/year={target_time.year}/month={target_time.strftime('%m')}/"
        f"day={target_time.strftime('%d')}/hour={target_time.strftime('%H')}/"
        f"inference_sim_{uuid.uuid4().hex[:8]}.parquet"
    )

    storage_io.write_parquet(partition_path, df)
    logger.info("Wrote %d simulated rows to partition %s", len(df), partition_path)


def run_benchmark_evaluation():
    """
    Evaluates system metrics:
    - Sensitivity: True Positive Rate on induced drift
    - Detection Delay / Latency: Time to detect shift under batch monitoring
    - False Alarm Rate: Type I Error on stationary null data
    """
    logger.info("Running System Benchmark Evaluation...")
    from worker.metrics import compute_continuous_psi, compute_ks_test
    from worker.baseline_build import build_baseline_artifacts

    with open("config/features.json", "r") as f:
        features_meta = json.load(f)

    # 1. Baseline dataset
    base_df = generate_clean_sample(n=2000, seed=100)
    bins_meta, _ = build_baseline_artifacts(base_df, features_meta)

    # 2. Test False Alarm Rate (Stationary distribution - 20 batches of clean data)
    false_alarms = 0
    total_clean_tests = 20
    for i in range(total_clean_tests):
        clean_batch = generate_clean_sample(n=300, seed=1000 + i)
        psi, _ = compute_continuous_psi(
            base_df["credit_score"],
            clean_batch["credit_score"],
            bin_edges=bins_meta["features"]["credit_score"]["bin_edges"],
        )
        if psi >= 0.20:
            false_alarms += 1

    far = (false_alarms / total_clean_tests) * 100.0
    logger.info("False Alarm Rate on stationary data: %.2f%% (%d / %d)", far, false_alarms, total_clean_tests)

    # 3. Test Sensitivity on Drifting Data
    detected = 0
    total_drift_tests = 20
    for i in range(total_drift_tests):
        drift_batch = generate_clean_sample(n=300, seed=2000 + i)
        drift_batch = inject_drift(drift_batch, ["mean_shift"], severity="high", seed=3000 + i)
        psi, _ = compute_continuous_psi(
            base_df["credit_score"],
            drift_batch["credit_score"],
            bin_edges=bins_meta["features"]["credit_score"]["bin_edges"],
        )
        if psi >= 0.20:
            detected += 1

    sensitivity = (detected / total_drift_tests) * 100.0
    logger.info("Sensitivity (True Positive Rate) on severe drift: %.2f%% (%d / %d)", sensitivity, detected, total_drift_tests)

    # 4. Detection Delay
    # With a 6-hour cron batch schedule, detection delay is bounded by:
    # min: 0h (drift happens just before cron), max: 6h (drift happens right after cron), average: 3.0 hours.
    avg_delay_hours = 3.0
    logger.info("Detection Delay: Average %.1f hours (Batch cron interval: 6 hours)", avg_delay_hours)

    return {
        "false_alarm_rate_pct": far,
        "sensitivity_pct": sensitivity,
        "average_detection_delay_hours": avg_delay_hours,
    }


def main():
    parser = argparse.ArgumentParser(description="Inject controlled drift or generate synthetic inference logs")
    parser.add_argument("--samples", type=int, default=500, help="Number of records to generate")
    parser.add_argument("--drift-types", default="none", help="Comma-separated: mean_shift, variance_scale, category_shift, null_injection, prediction_drift")
    parser.add_argument("--severity", default="medium", choices=["low", "medium", "high"], help="Drift severity level")
    parser.add_argument("--benchmark", action="store_true", help="Run system evaluation: sensitivity, false alarm rate, latency")
    parser.add_argument("--serving-url", default=None, help="If provided, sends records via HTTP POST to /predict")
    args = parser.parse_args()

    if args.benchmark:
        run_benchmark_evaluation()
        return

    df = generate_clean_sample(n=args.samples)
    if args.drift_types != "none":
        dtypes = [d.strip() for d in args.drift_types.split(",")]
        df = inject_drift(df, dtypes, severity=args.severity)

    if args.serving_url:
        logger.info("Sending %d records to serving endpoint: %s", len(df), args.serving_url)
        records = df.drop(columns=["prediction_score", "prediction_label", "request_id", "timestamp"], errors="ignore").to_dict(orient="records")
        resp = requests.post(f"{args.serving_url}/predict", json={"records": records})
        logger.info("Serving response status: %s", resp.status_code)
    else:
        # Write to partitioned storage
        storage_io = StorageIO()
        write_simulated_partitions(df, storage_io)


if __name__ == "__main__":
    main()
