import numpy as np
import pandas as pd
import pytest
from worker.baseline_build import build_baseline_artifacts


class TestBaselineBuild:
    def test_build_baseline_artifacts(self):
        rng = np.random.default_rng(42)
        n = 500

        df = pd.DataFrame({
            "age": rng.normal(35, 10, n),
            "income": rng.lognormal(10, 0.5, n),
            "home_ownership": rng.choice(["RENT", "OWN", "MORTGAGE"], size=n),
            "prediction_score": rng.uniform(0.0, 1.0, n),
        })

        features_meta = {
            "dataset_name": "test_dataset",
            "features": [
                {"name": "age", "type": "numerical", "importance": "medium"},
                {"name": "income", "type": "numerical", "importance": "high"},
                {"name": "home_ownership", "type": "categorical", "importance": "low", "allowed_values": ["RENT", "OWN", "MORTGAGE"]},
            ],
        }

        bins_meta, sample_df = build_baseline_artifacts(df, features_meta, num_bins=10)

        assert "age" in bins_meta["features"]
        assert "income" in bins_meta["features"]
        assert "home_ownership" in bins_meta["features"]
        assert "prediction_score" in bins_meta["features"]

        # Check numerical properties
        age_bins = bins_meta["features"]["age"]
        assert len(age_bins["bin_edges"]) >= 2
        # Edges should be non-decreasing
        edges = age_bins["bin_edges"]
        assert all(edges[i] <= edges[i + 1] for i in range(len(edges) - 1))
        assert "mean" in age_bins
        assert "std" in age_bins

        # Check categorical properties
        home_bins = bins_meta["features"]["home_ownership"]
        assert "RENT" in home_bins["categories"]
        assert sum(home_bins["category_percentages"].values()) == pytest.approx(1.0, abs=1e-3)

        # Check sample DataFrame
        assert len(sample_df) == n
        assert not sample_df.empty
