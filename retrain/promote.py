import argparse
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import requests

from worker.baseline_build import build_baseline_artifacts
from worker.gcs_io import StorageIO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("retrain.promote")


def promote_challenger(
    models_dir: str = "./data/models",
    features_config_path: str = "config/features.json",
    force: bool = False,
    serving_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Promotes the Challenger model to active Champion:
    1. Validates offline evaluation gate
    2. Writes model artifacts to models/v{N}/
    3. Atomically updates models/latest.json
    4. Regenerates and saves new baseline reference artifacts (closes the loop)
    5. Triggers hot-reload on model serving service
    """
    models_path = Path(models_dir)
    challenger_dir = models_path / "challenger"
    latest_manifest = models_path / "latest.json"

    # 1. Read evaluation verdict
    verdict_file = challenger_dir / "eval_verdict.json"
    if not verdict_file.exists() and not force:
        raise FileNotFoundError(f"Evaluation verdict not found at {verdict_file}. Run evaluate.py first or use --force.")

    if verdict_file.exists():
        with open(verdict_file, "r") as f:
            verdict_data = json.load(f)
        if verdict_data.get("verdict") != "APPROVED" and not force:
            raise ValueError(f"Challenger promotion blocked: verdict was {verdict_data.get('verdict')}. Reason: {verdict_data.get('reason')}")
    else:
        verdict_data = {"verdict": "FORCED", "metrics": {}}

    # 2. Read challenger metadata
    with open(challenger_dir / "metadata.json", "r") as f:
        meta = json.load(f)

    target_version = meta.get("candidate_version", "v2")
    version_dir = models_path / target_version
    version_dir.mkdir(parents=True, exist_ok=True)

    # 3. Copy challenger model artifact to its version directory
    src_model = challenger_dir / "model.joblib"
    dest_model = version_dir / "model.joblib"
    shutil.copy2(src_model, dest_model)

    # 4. Check previous version from current latest.json
    previous_version = None
    if latest_manifest.exists():
        try:
            with open(latest_manifest, "r") as f:
                prev_manifest = json.load(f)
                previous_version = prev_manifest.get("version")
        except Exception:
            pass

    # 5. Atomically update latest.json
    now_iso = datetime.now(timezone.utc).isoformat()
    new_manifest = {
        "version": target_version,
        "previous_version": previous_version,
        "model_path": f"{target_version}/model.joblib",
        "promoted_at": now_iso,
        "metrics": verdict_data.get("metrics", {}).get("challenger", {}),
        "trained_at": meta.get("trained_at"),
        "evaluation_verdict": verdict_data.get("verdict"),
    }

    temp_manifest = models_path / "latest.json.tmp"
    with open(temp_manifest, "w") as f:
        json.dump(new_manifest, f, indent=2)
    temp_manifest.replace(latest_manifest)

    logger.info("Promoted %s to active Champion. Updated %s (Previous: %s)", target_version, latest_manifest, previous_version)

    # 6. Update Baseline Artifacts (Closed Loop)
    storage_io = StorageIO()
    try:
        with open(features_config_path, "r") as f:
            features_config = json.load(f)

        # Read retraining evaluation or training data to build new baseline
        eval_df = storage_io.read_parquet("models/challenger/eval_data.parquet")
        bins_meta, sample_df = build_baseline_artifacts(eval_df, features_config)

        # Write updated baseline to storage
        storage_io.write_json("baseline/bins.json", bins_meta)
        storage_io.write_parquet("baseline/ref_sample.parquet", sample_df)
        logger.info("Successfully refreshed baseline artifacts in baseline/ for new champion %s", target_version)
    except Exception as e:
        logger.warning("Failed to refresh baseline artifacts (%s). Existing baseline preserved.", e)

    # 7. Notify Serving Service for Hot Reload
    serving_url = serving_url or os.getenv("SERVING_RELOAD_URL", "http://localhost:8000/admin/reload-model")
    notify_serving_hot_reload(serving_url)

    return new_manifest


def rollback_champion(
    models_dir: str = "./data/models",
    serving_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Rolls back the active model to previous_version.
    """
    models_path = Path(models_dir)
    latest_manifest = models_path / "latest.json"

    if not latest_manifest.exists():
        raise FileNotFoundError("latest.json manifest not found for rollback")

    with open(latest_manifest, "r") as f:
        curr_manifest = json.load(f)

    prev_ver = curr_manifest.get("previous_version")
    if not prev_ver:
        raise ValueError("No previous_version recorded in latest.json. Rollback aborted.")

    prev_model_path = models_path / f"{prev_ver}/model.joblib"
    if not prev_model_path.exists():
        raise FileNotFoundError(f"Previous model artifact not found at {prev_model_path}")

    current_ver = curr_manifest.get("version")
    rollback_manifest = {
        "version": prev_ver,
        "previous_version": current_ver,
        "model_path": f"{prev_ver}/model.joblib",
        "promoted_at": datetime.now(timezone.utc).isoformat(),
        "is_rollback": True,
        "rolled_back_from": current_ver,
    }

    temp_manifest = models_path / "latest.json.tmp"
    with open(temp_manifest, "w") as f:
        json.dump(rollback_manifest, f, indent=2)
    temp_manifest.replace(latest_manifest)

    logger.info("Successfully rolled back Champion from %s to %s", current_ver, prev_ver)

    serving_url = serving_url or os.getenv("SERVING_RELOAD_URL", "http://localhost:8000/admin/reload-model")
    notify_serving_hot_reload(serving_url)

    return rollback_manifest


def notify_serving_hot_reload(serving_url: str):
    """Triggers hot-reload HTTP endpoint on FastAPI serving service."""
    try:
        resp = requests.post(serving_url, timeout=5)
        if resp.status_code == 200:
            logger.info("Serving container hot reload confirmed: %s", resp.text)
        else:
            logger.warning("Serving container reload returned status: %d", resp.status_code)
    except Exception as e:
        logger.info("Could not reach serving service at %s (%s). Serving will hot-reload on next poll.", serving_url, e)


def main():
    parser = argparse.ArgumentParser(description="Promote Challenger or Rollback Champion Model")
    parser.add_argument("--models-dir", default="./data/models", help="Directory where models are saved")
    parser.add_argument("--features-config", default="config/features.json", help="Path to features.json")
    parser.add_argument("--force", action="store_true", help="Bypass evaluation gate")
    parser.add_argument("--rollback", action="store_true", help="Roll back to previous champion version")
    parser.add_argument("--serving-url", default=None, help="URL to reload serving container")
    args = parser.parse_args()

    if args.rollback:
        rollback_champion(args.models_dir, args.serving_url)
    else:
        promote_challenger(args.models_dir, args.features_config, args.force, args.serving_url)


if __name__ == "__main__":
    main()
