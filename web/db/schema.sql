-- Data Drift Monitoring and Closed-Loop Retraining Database Schema
-- Compatible with PostgreSQL 14+ and Neon Serverless Postgres

CREATE TABLE IF NOT EXISTS drift_runs (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    sample_count INTEGER NOT NULL,
    overall_status VARCHAR(32) NOT NULL, -- 'STABLE', 'WARNING', 'DRIFT_DETECTED', 'INSUFFICIENT_DATA'
    max_psi NUMERIC(8, 4) NOT NULL DEFAULT 0.0,
    severe_drift_count INTEGER NOT NULL DEFAULT 0,
    warning_drift_count INTEGER NOT NULL DEFAULT 0,
    quality_report JSONB,
    prediction_drift JSONB,
    summary TEXT
);

CREATE INDEX IF NOT EXISTS idx_drift_runs_created_at ON drift_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drift_runs_status ON drift_runs (overall_status);

CREATE TABLE IF NOT EXISTS feature_metrics (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL REFERENCES drift_runs(id) ON DELETE CASCADE,
    feature_name VARCHAR(64) NOT NULL,
    feature_type VARCHAR(32) NOT NULL, -- 'numerical' or 'categorical'
    importance VARCHAR(16) NOT NULL DEFAULT 'medium',
    psi NUMERIC(8, 4) NOT NULL,
    status VARCHAR(32) NOT NULL, -- 'STABLE', 'WARNING', 'DRIFT'
    ks_statistic NUMERIC(8, 5),
    ks_p_value NUMERIC(8, 6),
    chi2_statistic NUMERIC(8, 4),
    chi2_p_value NUMERIC(8, 6),
    baseline_stats JSONB,
    current_stats JSONB,
    histogram_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_metrics_run_id ON feature_metrics (run_id);
CREATE INDEX IF NOT EXISTS idx_feature_metrics_feature ON feature_metrics (feature_name);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES drift_runs(id) ON DELETE CASCADE,
    feature_name VARCHAR(64) NOT NULL,
    alert_type VARCHAR(32) NOT NULL, -- 'FEATURE_DRIFT', 'PREDICTION_DRIFT', 'QUALITY_VIOLATION'
    severity VARCHAR(16) NOT NULL, -- 'WARNING', 'CRITICAL'
    message TEXT NOT NULL,
    dedup_key VARCHAR(128) NOT NULL,
    cooldown_until TIMESTAMPTZ NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT FALSE,
    channel VARCHAR(32) NOT NULL DEFAULT 'TELEGRAM',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_dedup ON alerts (dedup_key, cooldown_until DESC);

CREATE TABLE IF NOT EXISTS retrain_jobs (
    id SERIAL PRIMARY KEY,
    run_id INTEGER REFERENCES drift_runs(id) ON DELETE SET NULL,
    triggered_by VARCHAR(32) NOT NULL, -- 'AUTO_SEVERE', 'TELEGRAM_APPROVE', 'MANUAL_DASHBOARD'
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'REJECTED'
    champion_version VARCHAR(32),
    challenger_version VARCHAR(32),
    metrics JSONB,
    approved_by VARCHAR(64),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrain_jobs_created ON retrain_jobs (created_at DESC);
