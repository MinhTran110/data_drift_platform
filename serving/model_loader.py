import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import joblib
import numpy as np
import pandas as pd

logger = logging.getLogger("serving.model_loader")


class ModelLoader:
    """
    Manages loading and zero-downtime hot-reloading of the Champion ML model.
    Monitors latest.json pointer to reload challenger when promoted.
    """

    def __init__(self, registry_path: Optional[str] = None):
        self.registry_path = Path(registry_path or os.getenv("MODEL_REGISTRY_PATH", "./data/models"))
        self._lock = threading.RLock()
        self.model = None
        self.metadata: Dict[str, Any] = {}
        self.version = "unloaded"
        self._last_loaded_mtime = 0.0

        # Load initial model if exists
        self.reload_if_updated(force=True)

    @property
    def latest_manifest_path(self) -> Path:
        return self.registry_path / "latest.json"

    def reload_if_updated(self, force: bool = False) -> bool:
        """
        Checks if latest.json has been modified or if forced.
        Atomically updates the active model pipeline.
        """
        manifest_file = self.latest_manifest_path
        if not manifest_file.exists():
            logger.warning("Manifest %s not found. Using fallback mock model.", manifest_file)
            with self._lock:
                self.version = "fallback-v0"
                self.metadata = {"version": "fallback-v0", "fallback": True}
                self.model = self._create_fallback_model()
            return False

        current_mtime = manifest_file.stat().st_mtime
        if not force and current_mtime <= self._last_loaded_mtime:
            return False

        with self._lock:
            try:
                with open(manifest_file, "r") as f:
                    manifest = json.load(f)

                target_version = manifest.get("version", "unknown")
                model_rel_path = manifest.get("model_path", f"{target_version}/model.joblib")
                model_full_path = self.registry_path / model_rel_path

                if not model_full_path.exists():
                    # Check absolute path or direct child
                    if (self.registry_path / f"{target_version}/model.joblib").exists():
                        model_full_path = self.registry_path / f"{target_version}/model.joblib"
                    else:
                        raise FileNotFoundError(f"Model artifact not found at {model_full_path}")

                loaded_pipeline = joblib.load(model_full_path)
                
                # Atomic assignment
                self.model = loaded_pipeline
                self.metadata = manifest
                self.version = target_version
                self._last_loaded_mtime = current_mtime
                logger.info("Successfully loaded champion model version: %s from %s", self.version, model_full_path)
                return True
            except Exception as e:
                logger.error("Failed to load model from manifest %s: %s", manifest_file, e, exc_info=True)
                if self.model is None:
                    self.model = self._create_fallback_model()
                    self.version = "fallback-v0"
                return False

    def predict(self, df: pd.DataFrame) -> Tuple[np.ndarray, np.ndarray]:
        """
        Executes inference on input DataFrame.
        Returns:
            scores: float probabilities of default [0.0 - 1.0]
            labels: binary integer prediction (0 or 1)
        """
        with self._lock:
            pipeline = self.model
            ver = self.version

        if pipeline is None:
            pipeline = self._create_fallback_model()

        try:
            if hasattr(pipeline, "predict_proba"):
                probs = pipeline.predict_proba(df)
                if probs.shape[1] > 1:
                    scores = probs[:, 1]
                else:
                    scores = probs[:, 0]
            else:
                preds = pipeline.predict(df)
                scores = preds.astype(float)
        except Exception as e:
            logger.warning("Pipeline inference failed (%s). Using fallback heuristic scoring.", e)
            scores = self._heuristic_score(df)

        scores = np.clip(np.asarray(scores, dtype=float), 0.0, 1.0)
        labels = (scores >= 0.5).astype(int)
        return scores, labels

    def _heuristic_score(self, df: pd.DataFrame) -> np.ndarray:
        """Heuristic risk score calculation when model pipeline is not ready."""
        scores = []
        for _, row in df.iterrows():
            score = 0.2
            # Lower credit score increases risk
            cs = row.get("credit_score", 650)
            if cs < 580:
                score += 0.35
            elif cs < 670:
                score += 0.15

            # Higher debt-to-income increases risk
            dti = row.get("debt_to_income_ratio", 0.3)
            if dti > 0.45:
                score += 0.25

            # Higher loan relative to income
            income = max(row.get("annual_income", 50000), 1000)
            loan = row.get("loan_amount", 10000)
            if loan / income > 0.4:
                score += 0.2

            scores.append(min(max(score, 0.01), 0.99))
        return np.array(scores)

    def _create_fallback_model(self):
        """Creates a dummy estimator to handle early requests before first training."""
        class FallbackEstimator:
            def predict_proba(self, X):
                probs = []
                for _, row in X.iterrows():
                    cs = float(row.get("credit_score", 650))
                    # baseline sigmoid around 650
                    prob = 1.0 / (1.0 + np.exp((cs - 620) / 60.0))
                    probs.append([1.0 - prob, prob])
                return np.array(probs)

            def predict(self, X):
                p = self.predict_proba(X)[:, 1]
                return (p >= 0.5).astype(int)

        return FallbackEstimator()
