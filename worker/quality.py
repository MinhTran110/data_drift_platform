import logging
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
import pandas as pd

logger = logging.getLogger("worker.quality")


class DataQualityChecker:
    """
    Validates batch inference data quality against schema definitions and rules.
    Detects missing values, out-of-vocabulary categories, out-of-range values, and schema mismatches.
    """

    def __init__(self, features_config: Dict[str, Any], rules_config: Dict[str, Any]):
        self.features = features_config.get("features", [])
        self.feature_map = {f["name"]: f for f in self.features}
        self.quality_rules = rules_config.get("quality", {})
        self.max_null_pct = self.quality_rules.get("max_null_pct", 0.05)
        self.max_oov_pct = self.quality_rules.get("max_oov_pct", 0.02)

    def run_checks(self, df: pd.DataFrame) -> Dict[str, Any]:
        """
        Executes comprehensive suite of quality checks.
        Returns report with pass/fail status, violation details, and summary stats.
        """
        violations: List[Dict[str, Any]] = []
        metrics_by_feature: Dict[str, Any] = {}
        total_rows = len(df)

        if total_rows == 0:
            return {
                "passed": False,
                "error": "Dataset is empty",
                "violations": [{"check": "empty_dataset", "severity": "CRITICAL", "message": "Batch has 0 records"}],
                "feature_quality": {},
            }

        for f in self.features:
            name = f["name"]
            f_type = f.get("type", "numerical")

            # 1. Missing Column Check
            if name not in df.columns:
                violations.append({
                    "feature": name,
                    "check": "missing_column",
                    "severity": "CRITICAL",
                    "message": f"Expected column '{name}' is missing from inference logs",
                })
                continue

            series = df[name]
            null_count = int(series.isna().sum())
            null_pct = round(null_count / total_rows, 4)

            feat_report = {
                "null_count": null_count,
                "null_pct": null_pct,
                "passed": True,
            }

            # 2. Null Rate Threshold Check
            if null_pct > self.max_null_pct:
                violations.append({
                    "feature": name,
                    "check": "null_rate_exceeded",
                    "severity": "WARNING" if null_pct < 0.20 else "CRITICAL",
                    "message": f"Feature '{name}' null rate {null_pct:.1%} exceeds threshold {self.max_null_pct:.1%}",
                    "metric_value": null_pct,
                })
                feat_report["passed"] = False

            # 3. Categorical Out-Of-Vocabulary (OOV) Check
            if f_type == "categorical":
                allowed = set(f.get("allowed_values", []))
                if allowed:
                    non_nulls = series.dropna().astype(str)
                    oov_mask = ~non_nulls.isin(allowed)
                    oov_count = int(oov_mask.sum())
                    oov_pct = round(oov_count / max(len(non_nulls), 1), 4)
                    feat_report["oov_count"] = oov_count
                    feat_report["oov_pct"] = oov_pct

                    if oov_pct > self.max_oov_pct:
                        violations.append({
                            "feature": name,
                            "check": "oov_categories",
                            "severity": "WARNING",
                            "message": f"Feature '{name}' has {oov_pct:.1%} out-of-vocabulary values (allowed: {sorted(list(allowed))})",
                            "metric_value": oov_pct,
                        })
                        feat_report["passed"] = False

            # 4. Numerical Range Checks
            elif f_type == "numerical":
                min_bound = f.get("min")
                max_bound = f.get("max")
                num_vals = pd.to_numeric(series.dropna(), errors="coerce")
                
                # Check for parsing failures
                non_numeric_count = int(num_vals.isna().sum()) - int(series.isna().sum())
                if non_numeric_count > 0:
                    violations.append({
                        "feature": name,
                        "check": "type_mismatch",
                        "severity": "CRITICAL",
                        "message": f"Feature '{name}' contains {non_numeric_count} non-numeric values",
                    })
                    feat_report["passed"] = False

                valid_vals = num_vals.dropna()
                if not valid_vals.empty:
                    out_of_bounds = 0
                    if min_bound is not None:
                        out_of_bounds += int((valid_vals < min_bound).sum())
                    if max_bound is not None:
                        out_of_bounds += int((valid_vals > max_bound).sum())

                    oob_pct = round(out_of_bounds / max(len(valid_vals), 1), 4)
                    feat_report["out_of_bounds_pct"] = oob_pct

                    if oob_pct > 0.01:  # More than 1% extreme outliers
                        violations.append({
                            "feature": name,
                            "check": "out_of_range",
                            "severity": "WARNING",
                            "message": f"Feature '{name}' has {oob_pct:.1%} values outside expected range [{min_bound}, {max_bound}]",
                            "metric_value": oob_pct,
                        })

            metrics_by_feature[name] = feat_report

        has_critical = any(v["severity"] == "CRITICAL" for v in violations)
        return {
            "passed": not has_critical,
            "total_rows": total_rows,
            "violations_count": len(violations),
            "critical_violations": [v for v in violations if v["severity"] == "CRITICAL"],
            "warning_violations": [v for v in violations if v["severity"] == "WARNING"],
            "feature_quality": metrics_by_feature,
        }
