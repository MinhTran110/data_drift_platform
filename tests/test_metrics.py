import math
import numpy as np
import pandas as pd
import pytest
from scipy import stats

from worker.metrics import (
    compute_categorical_psi,
    compute_chi2_test,
    compute_continuous_psi,
    compute_feature_metrics,
    compute_ks_test,
    compute_prediction_drift,
)


def evidently_reference_psi(
    reference: np.ndarray,
    current: np.ndarray,
    num_bins: int = 10,
    epsilon: float = 0.0001,
) -> float:
    """
    Evidently AI's standard reference implementation of PSI for continuous data:
    1. Quantile binning on reference
    2. Bin counts with -inf and +inf outer bounds
    3. Laplace / epsilon smoothing
    4. sum((p - q) * ln(p / q))
    """
    quantiles = np.linspace(0, 1, num_bins + 1)
    bin_edges = np.unique(np.quantile(reference, quantiles))
    bin_edges[0] = -np.inf
    bin_edges[-1] = np.inf

    ref_counts, _ = np.histogram(reference, bins=bin_edges)
    curr_counts, _ = np.histogram(current, bins=bin_edges)

    k = len(ref_counts)
    q = (ref_counts + epsilon) / (len(reference) + k * epsilon)
    p = (curr_counts + epsilon) / (len(current) + k * epsilon)

    psi_val = np.sum((p - q) * np.log(p / q))
    return float(psi_val)


class TestMetrics:
    """Statistical and Drift Metrics Unit Test Suite."""

    def test_continuous_psi_identical_distributions(self):
        """PSI on identical distributions should be approximately 0.0."""
        rng = np.random.default_rng(42)
        ref = pd.Series(rng.normal(100, 15, 2000))
        curr = pd.Series(rng.normal(100, 15, 2000))

        psi, breakdown = compute_continuous_psi(ref, curr, num_bins=10)
        assert psi < 0.05, f"Expected PSI < 0.05 on identical distribution, got {psi}"
        assert len(breakdown["bin_labels"]) == 10
        assert sum(breakdown["production_pct"]) == pytest.approx(1.0, abs=1e-2)

    def test_continuous_psi_matches_evidently_methodology(self):
        """Verify our PSI implementation matches Evidently AI formula exactly."""
        rng = np.random.default_rng(123)
        ref_arr = rng.normal(50, 10, 1500)
        # Shift current distribution mean by 1.5 standard deviations
        curr_arr = rng.normal(65, 12, 1200)

        ref_series = pd.Series(ref_arr)
        curr_series = pd.Series(curr_arr)

        evidently_psi = evidently_reference_psi(ref_arr, curr_arr, num_bins=10)
        our_psi, _ = compute_continuous_psi(ref_series, curr_series, num_bins=10)

        assert our_psi == pytest.approx(evidently_psi, rel=1e-3), (
            f"Our PSI ({our_psi}) deviates from Evidently reference ({evidently_psi})"
        )
        assert our_psi > 0.20, f"Expected severe drift (PSI > 0.20), got {our_psi}"

    def test_continuous_psi_with_fixed_bin_edges(self):
        """Verify precomputed bin edges from baseline are respected."""
        ref = pd.Series([10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
        curr = pd.Series([15, 25, 35, 45, 55, 65, 75, 85, 95, 105])
        fixed_edges = [10.0, 30.0, 50.0, 70.0, 90.0, 110.0]

        psi, breakdown = compute_continuous_psi(ref, curr, bin_edges=fixed_edges)
        assert psi >= 0.0
        assert len(breakdown["bin_labels"]) == len(fixed_edges) - 1

    def test_continuous_psi_handles_empty_bins_gracefully(self):
        """Ensure no division by zero or log(0) when production distribution misses a bin."""
        ref = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] * 50)
        curr = pd.Series([1, 2, 3] * 50)  # completely missing higher values

        psi, breakdown = compute_continuous_psi(ref, curr, num_bins=5)
        assert not math.isnan(psi)
        assert not math.isinf(psi)
        assert psi > 0.20  # Extreme drift detected

    def test_ks_test_drift_detection(self):
        """Verify Two-sample KS Test detects statistical shift matching scipy/Evidently."""
        rng = np.random.default_rng(99)
        ref = pd.Series(rng.normal(0, 1, 1000))
        curr_same = pd.Series(rng.normal(0, 1, 1000))
        curr_drifted = pd.Series(rng.normal(0.4, 1, 1000))

        # Test on identical
        stat_same, p_same = compute_ks_test(ref, curr_same)
        assert p_same > 0.05, f"Expected p-value > 0.05 on identical sample, got {p_same}"

        # Test on shifted
        stat_drift, p_drift = compute_ks_test(ref, curr_drifted)
        assert p_drift < 0.01, f"Expected p-value < 0.01 on drifted sample, got {p_drift}"
        assert stat_drift > stat_same

    def test_categorical_psi(self):
        """Test PSI on categorical features with baseline categories."""
        ref = pd.Series(["RENT"] * 45 + ["MORTGAGE"] * 40 + ["OWN"] * 15)
        # Sizable shift
        curr = pd.Series(["RENT"] * 75 + ["MORTGAGE"] * 20 + ["OWN"] * 5)

        psi, breakdown = compute_categorical_psi(ref, curr, baseline_categories=["RENT", "MORTGAGE", "OWN"])
        assert psi > 0.10, f"Expected drift on shifted categorical data, got {psi}"
        assert "RENT" in breakdown["bin_labels"]

    def test_categorical_psi_with_out_of_vocabulary(self):
        """Test categorical PSI captures unseen categories without crashing."""
        ref = pd.Series(["RENT", "OWN", "MORTGAGE"] * 100)
        curr = pd.Series(["RENT", "OWN", "UNKNOWN_NEW_CAT"] * 100)

        psi, breakdown = compute_categorical_psi(ref, curr, baseline_categories=["RENT", "OWN", "MORTGAGE"])
        assert not math.isnan(psi)
        assert not math.isinf(psi)
        assert "__OTHER__" in breakdown["bin_labels"]

    def test_chi2_test_categorical(self):
        """Test Chi-Square test detects categorical distribution shifts."""
        ref = pd.Series(["A"] * 50 + ["B"] * 50)
        curr_same = pd.Series(["A"] * 48 + ["B"] * 52)
        curr_shifted = pd.Series(["A"] * 85 + ["B"] * 15)

        _, p_same = compute_chi2_test(ref, curr_same)
        assert p_same > 0.05

        _, p_shifted = compute_chi2_test(ref, curr_shifted)
        assert p_shifted < 0.01

    def test_prediction_drift(self):
        """Test prediction drift calculation on score distributions."""
        ref_scores = pd.Series(np.clip(np.random.beta(2, 5, 500), 0.0, 1.0))
        # Severe upward shift in risk predictions
        curr_scores = pd.Series(np.clip(np.random.beta(5, 2, 500), 0.0, 1.0))

        drift_result = compute_prediction_drift(ref_scores, curr_scores)
        assert drift_result["status"] == "DRIFT"
        assert drift_result["psi"] > 0.15
        assert drift_result["ks_p_value"] < 0.05
