#!/usr/bin/env bash
# ==============================================================================
# seed_baseline.sh
# Generates reference dataset, builds initial baseline artifacts,
# trains Champion v1 model, and generates sample inference logs.
# ==============================================================================

set -euo pipefail

PYTHON="${PYTHON:-.venv/bin/python}"
if [ ! -f "$PYTHON" ]; then
    PYTHON="python3"
fi

echo "============================================================"
echo "Seeding Baseline Data and Initial Champion Model"
echo "Python: $PYTHON"
echo "============================================================"

# Ensure directories exist
mkdir -p data/gcs_mock/baseline \
         data/gcs_mock/inference_logs \
         data/gcs_mock/reports \
         data/models \
         tests/fixtures

# 1. Generate Synthetic Reference Dataset
echo "[1/4] Generating synthetic reference training dataset..."
$PYTHON -c "
import pandas as pd
from worker.simulate_drift import generate_clean_sample

df = generate_clean_sample(n=3000, seed=42)
try:
    df.to_parquet('tests/fixtures/sample_train.parquet', index=False)
    print('Saved tests/fixtures/sample_train.parquet')
except Exception as e:
    print('Parquet export warning (pyarrow missing):', e)
df.to_csv('tests/fixtures/sample_train.csv', index=False)
print('Saved tests/fixtures/sample_train.csv')
"

# 2. Run Baseline Build
echo "[2/4] Computing quantile bin edges and baseline reference artifacts..."
$PYTHON -m worker.baseline_build \
    --input tests/fixtures/sample_train.parquet \
    --config-features config/features.json \
    --config-rules config/rules.yaml \
    --output-prefix baseline

# 3. Train Champion v1 Model
echo "[3/4] Training initial Champion v1 model..."
$PYTHON -m retrain.train --data-source baseline_only
$PYTHON -m retrain.evaluate || true
$PYTHON -m retrain.promote --force

# 4. Generate Initial Inference Partitions
echo "[4/4] Generating initial production inference log partitions..."
$PYTHON -m worker.simulate_drift --samples 350 --drift-types none
$PYTHON -m worker.simulate_drift --samples 250 --drift-types none

echo "============================================================"
echo "Baseline Seeding Successfully Completed!"
echo "Baseline bins: data/gcs_mock/baseline/bins.json"
echo "Champion model: data/models/latest.json"
echo "============================================================"
