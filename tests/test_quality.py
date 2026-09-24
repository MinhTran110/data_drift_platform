import pandas as pd
import pytest
from worker.quality import DataQualityChecker


@pytest.fixture
def mock_features_config():
    return {
        "dataset_name": "test_dataset",
        "features": [
            {
                "name": "income",
                "type": "numerical",
                "importance": "high",
                "min": 1000,
                "max": 1000000,
            },
            {
                "name": "category",
                "type": "categorical",
                "importance": "medium",
                "allowed_values": ["A", "B", "C"],
            },
        ],
    }


@pytest.fixture
def mock_rules_config():
    return {
        "quality": {
            "max_null_pct": 0.05,
            "max_oov_pct": 0.02,
        }
    }


class TestDataQuality:
    def test_clean_data_passes_checks(self, mock_features_config, mock_rules_config):
        checker = DataQualityChecker(mock_features_config, mock_rules_config)
        df = pd.DataFrame({
            "income": [50000, 60000, 75000, 80000, 95000],
            "category": ["A", "B", "A", "C", "B"],
        })
        result = checker.run_checks(df)
        assert result["passed"] is True
        assert result["violations_count"] == 0

    def test_high_null_rate_triggers_violation(self, mock_features_config, mock_rules_config):
        checker = DataQualityChecker(mock_features_config, mock_rules_config)
        # 4 out of 10 values null = 40% (exceeds 5%)
        df = pd.DataFrame({
            "income": [50000, None, 75000, None, 95000, None, 60000, 70000, None, 80000],
            "category": ["A"] * 10,
        })
        result = checker.run_checks(df)
        assert len(result["critical_violations"]) > 0 or len(result["warning_violations"]) > 0
        violations = result["critical_violations"] + result["warning_violations"]
        assert any(v["check"] == "null_rate_exceeded" for v in violations)

    def test_oov_category_triggers_violation(self, mock_features_config, mock_rules_config):
        checker = DataQualityChecker(mock_features_config, mock_rules_config)
        # 5 out of 10 values are "UNKNOWN_CAT" (not in A, B, C)
        df = pd.DataFrame({
            "income": [50000] * 10,
            "category": ["A", "B", "C", "UNKNOWN_CAT", "UNKNOWN_CAT", "UNKNOWN_CAT", "UNKNOWN_CAT", "UNKNOWN_CAT", "A", "B"],
        })
        result = checker.run_checks(df)
        violations = result["warning_violations"] + result["critical_violations"]
        assert any(v["check"] == "oov_categories" for v in violations)

    def test_missing_column_triggers_critical_violation(self, mock_features_config, mock_rules_config):
        checker = DataQualityChecker(mock_features_config, mock_rules_config)
        # 'income' column missing
        df = pd.DataFrame({
            "category": ["A", "B", "C"],
        })
        result = checker.run_checks(df)
        assert result["passed"] is False
        assert any(v["check"] == "missing_column" for v in result["critical_violations"])
