import logging
import math
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger("worker.metrics")


def compute_continuous_psi(
    ref_series: pd.Series,
    curr_series: pd.Series,
    bin_edges: Optional[List[float]] = None,
    num_bins: int = 10,
    epsilon: float = 0.0001,
) -> Tuple[float, Dict[str, Any]]:
    """
    Computes Population Stability Index (PSI) for continuous numerical features.
    Uses precomputed bin_edges (from baseline) if provided, or calculates quantiles.

    Formula: PSI = sum((actual_pct - expected_pct) * ln(actual_pct / expected_pct))
    """
    ref_clean = ref_series.dropna().to_numpy()
    curr_clean = curr_series.dropna().to_numpy()

    if len(ref_clean) == 0 or len(curr_clean) == 0:
        return 0.0, {"error": "Empty series for PSI computation"}

    if bin_edges is None or len(bin_edges) < 2:
        # Generate quantile bin edges from reference distribution
        quantiles = np.linspace(0, 1, num_bins + 1)
        bin_edges = np.unique(np.quantile(ref_clean, quantiles)).tolist()
        if len(bin_edges) < 2:
            # All values in reference are identical
            min_v = float(ref_clean[0])
            bin_edges = [min_v - 1.0, min_v + 1.0]

    # Replace outer bounds with -inf and +inf to cover extreme drift
    calc_edges = list(bin_edges)
    calc_edges[0] = -np.inf
    calc_edges[-1] = np.inf

    # Digitize counts
    ref_counts, _ = np.histogram(ref_clean, bins=calc_edges)
    curr_counts, _ = np.histogram(curr_clean, bins=calc_edges)

    k = len(ref_counts)
    total_ref = len(ref_clean)
    total_curr = len(curr_clean)

    # Apply epsilon smoothing
    q_pct = (ref_counts + epsilon) / (total_ref + k * epsilon)
    p_pct = (curr_counts + epsilon) / (total_curr + k * epsilon)

    psi_components = (p_pct - q_pct) * np.log(p_pct / q_pct)
    total_psi = float(np.sum(psi_components))

    # Construct human-readable bin descriptions
    bin_labels = []
    for i in range(k):
        low = "-inf" if i == 0 else f"{bin_edges[i]:.2f}"
        high = "+inf" if i == k - 1 else f"{bin_edges[i+1]:.2f}"
        bin_labels.append(f"[{low}, {high}]")

    breakdown = {
        "bin_labels": bin_labels,
        "baseline_pct": [round(float(x), 5) for x in (ref_counts / total_ref)],
        "production_pct": [round(float(x), 5) for x in (curr_counts / total_curr)],
        "psi_components": [round(float(x), 5) for x in psi_components],
        "bin_edges": bin_edges,
    }

    return round(total_psi, 5), breakdown


def compute_categorical_psi(
    ref_series: pd.Series,
    curr_series: pd.Series,
    baseline_categories: Optional[List[str]] = None,
    epsilon: float = 0.0001,
) -> Tuple[float, Dict[str, Any]]:
    """
    Computes PSI for discrete/categorical features.
    """
    ref_clean = ref_series.dropna().astype(str)
    curr_clean = curr_series.dropna().astype(str)

    if len(ref_clean) == 0 or len(curr_clean) == 0:
        return 0.0, {"error": "Empty series for categorical PSI"}

    if baseline_categories is not None:
        categories = list(baseline_categories)
    else:
        categories = sorted(list(set(ref_clean.unique()).union(set(curr_clean.unique()))))

    # Add an 'OTHER' bucket if not present to capture out-of-vocabulary categories
    all_seen = set(categories)
    curr_unseen_count = curr_clean[~curr_clean.isin(all_seen)].count()
    if curr_unseen_count > 0 and "__OTHER__" not in categories:
        categories.append("__OTHER__")

    ref_counts_map = ref_clean.value_counts().to_dict()
    curr_counts_map = curr_clean.value_counts().to_dict()

    ref_counts = []
    curr_counts = []

    for cat in categories:
        if cat == "__OTHER__":
            ref_counts.append(0)
            curr_counts.append(curr_unseen_count)
        else:
            ref_counts.append(ref_counts_map.get(cat, 0))
            curr_counts.append(curr_counts_map.get(cat, 0))

    ref_counts = np.array(ref_counts, dtype=float)
    curr_counts = np.array(curr_counts, dtype=float)

    k = len(categories)
    total_ref = len(ref_clean)
    total_curr = len(curr_clean)

    q_pct = (ref_counts + epsilon) / (total_ref + k * epsilon)
    p_pct = (curr_counts + epsilon) / (total_curr + k * epsilon)

    psi_components = (p_pct - q_pct) * np.log(p_pct / q_pct)
    total_psi = float(np.sum(psi_components))

    breakdown = {
        "bin_labels": categories,
        "baseline_pct": [round(float(x), 5) for x in (ref_counts / total_ref)],
        "production_pct": [round(float(x), 5) for x in (curr_counts / total_curr)],
        "psi_components": [round(float(x), 5) for x in psi_components],
    }

    return round(total_psi, 5), breakdown


def compute_ks_test(ref_series: pd.Series, curr_series: pd.Series) -> Tuple[float, float]:
    """
    Two-sample Kolmogorov-Smirnov test for continuous distributions.
    Returns: (ks_statistic, p_value)
    """
    ref_clean = ref_series.dropna().to_numpy()
    curr_clean = curr_series.dropna().to_numpy()

    if len(ref_clean) == 0 or len(curr_clean) == 0:
        return 0.0, 1.0

    stat, p_value = stats.ks_2samp(ref_clean, curr_clean)
    return round(float(stat), 5), round(float(p_value), 6)


def compute_chi2_test(ref_series: pd.Series, curr_series: pd.Series) -> Tuple[float, float]:
    """
    Chi-Square Test of Homogeneity for categorical features.
    Constructs contingency table of frequencies.
    Returns: (chi2_statistic, p_value)
    """
    ref_clean = ref_series.dropna().astype(str)
    curr_clean = curr_series.dropna().astype(str)

    if len(ref_clean) == 0 or len(curr_clean) == 0:
        return 0.0, 1.0

    all_categories = sorted(list(set(ref_clean.unique()).union(set(curr_clean.unique()))))

    ref_counts = [ref_clean.value_counts().get(cat, 0) for cat in all_categories]
    curr_counts = [curr_clean.value_counts().get(cat, 0) for cat in all_categories]

    contingency = np.array([ref_counts, curr_counts])
    # Add small constant 1 to avoid zero-frequency issues in chi2 contingency
    contingency = contingency + 1

    stat, p_value, _, _ = stats.chi2_contingency(contingency)
    return round(float(stat), 4), round(float(p_value), 6)


def compute_feature_metrics(
    feature_meta: Dict[str, Any],
    ref_df: pd.DataFrame,
    curr_df: pd.DataFrame,
    bins_meta: Optional[Dict[str, Any]] = None,
    rules: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Computes comprehensive drift and quality metrics for a single feature.
    """
    name = feature_meta["name"]
    f_type = feature_meta.get("type", "numerical")
    importance = feature_meta.get("importance", "medium")

    rules = rules or {}
    psi_rules = rules.get("metrics", {}).get("psi", {})
    no_drift_thresh = psi_rules.get("no_drift", 0.10)
    mod_drift_thresh = psi_rules.get("moderate_drift", 0.20)

    ref_col = ref_df[name] if name in ref_df.columns else pd.Series(dtype=float)
    curr_col = curr_df[name] if name in curr_df.columns else pd.Series(dtype=float)

    # Missing counts
    ref_missing = int(ref_col.isna().sum())
    curr_missing = int(curr_col.isna().sum())
    curr_null_pct = round(curr_missing / max(len(curr_df), 1), 4)

    ks_stat = None
    ks_p = None
    chi2_stat = None
    chi2_p = None

    if f_type == "numerical":
        # Numerical feature
        saved_edges = bins_meta.get(name, {}).get("bin_edges") if bins_meta else None
        psi, breakdown = compute_continuous_psi(ref_col, curr_col, bin_edges=saved_edges)
        ks_stat, ks_p = compute_ks_test(ref_col, curr_col)

        ref_stats = {
            "mean": round(float(ref_col.mean()), 2) if not ref_col.empty else 0.0,
            "std": round(float(ref_col.std()), 2) if not ref_col.empty else 0.0,
            "median": round(float(ref_col.median()), 2) if not ref_col.empty else 0.0,
            "min": round(float(ref_col.min()), 2) if not ref_col.empty else 0.0,
            "max": round(float(ref_col.max()), 2) if not ref_col.empty else 0.0,
            "missing_pct": round(ref_missing / max(len(ref_df), 1), 4),
        }
        curr_stats = {
            "mean": round(float(curr_col.mean()), 2) if not curr_col.empty else 0.0,
            "std": round(float(curr_col.std()), 2) if not curr_col.empty else 0.0,
            "median": round(float(curr_col.median()), 2) if not curr_col.empty else 0.0,
            "min": round(float(curr_col.min()), 2) if not curr_col.empty else 0.0,
            "max": round(float(curr_col.max()), 2) if not curr_col.empty else 0.0,
            "missing_pct": curr_null_pct,
        }
    else:
        # Categorical feature
        saved_cats = bins_meta.get(name, {}).get("categories") if bins_meta else None
        psi, breakdown = compute_categorical_psi(ref_col, curr_col, baseline_categories=saved_cats)
        chi2_stat, chi2_p = compute_chi2_test(ref_col, curr_col)

        ref_stats = {
            "top_category": str(ref_col.mode().iloc[0]) if not ref_col.empty else "N/A",
            "unique_count": int(ref_col.nunique()),
            "missing_pct": round(ref_missing / max(len(ref_df), 1), 4),
        }
        curr_stats = {
            "top_category": str(curr_col.mode().iloc[0]) if not curr_col.empty else "N/A",
            "unique_count": int(curr_col.nunique()),
            "missing_pct": curr_null_pct,
        }

    # Evaluate Drift Status
    if psi >= mod_drift_thresh:
        status = "DRIFT"
    elif psi >= no_drift_thresh:
        status = "WARNING"
    else:
        status = "STABLE"

    return {
        "feature_name": name,
        "feature_type": f_type,
        "importance": importance,
        "psi": psi,
        "status": status,
        "ks_statistic": ks_stat,
        "ks_p_value": ks_p,
        "chi2_statistic": chi2_stat,
        "chi2_p_value": chi2_p,
        "baseline_stats": ref_stats,
        "current_stats": curr_stats,
        "histogram_data": breakdown,
    }


def compute_prediction_drift(
    ref_scores: pd.Series,
    curr_scores: pd.Series,
    rules: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Quantifies prediction drift on model output scores [0.0 - 1.0].
    """
    fixed_edges = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    psi, breakdown = compute_continuous_psi(ref_scores, curr_scores, bin_edges=fixed_edges)
    ks_stat, ks_p = compute_ks_test(ref_scores, curr_scores)

    rules = rules or {}
    pred_psi_thresh = rules.get("metrics", {}).get("prediction_drift", {}).get("psi_threshold", 0.15)

    status = "DRIFT" if psi >= pred_psi_thresh else ("WARNING" if psi >= 0.10 else "STABLE")

    return {
        "feature_name": "prediction_score",
        "feature_type": "numerical",
        "importance": "critical",
        "psi": psi,
        "status": status,
        "ks_statistic": ks_stat,
        "ks_p_value": ks_p,
        "baseline_mean": round(float(ref_scores.mean()), 4) if not ref_scores.empty else 0.0,
        "production_mean": round(float(curr_scores.mean()), 4) if not curr_scores.empty else 0.0,
        "histogram_data": breakdown,
    }
