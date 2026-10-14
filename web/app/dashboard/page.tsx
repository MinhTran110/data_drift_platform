import React from "react";
import { query } from "@/lib/db";
import { TrendPoint } from "@/components/PsiTrendChart";
import { FeatureRow } from "@/components/FeatureTable";
import { DashboardInteractiveView } from "@/components/DashboardInteractiveView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getDashboardData() {
  try {
    // 1. Fetch latest drift run
    const runs = await query(
      `SELECT * FROM drift_runs ORDER BY created_at DESC LIMIT 15`
    );

    if (runs && runs.length > 0) {
      const latestRun = runs[0];
      const features = await query(
        `SELECT * FROM feature_metrics WHERE run_id = $1 ORDER BY psi DESC`,
        [latestRun.id]
      );

      const trendPoints: TrendPoint[] = runs
        .map((r: any) => ({
          id: r.id,
          timestamp: r.created_at,
          psi: parseFloat(r.max_psi) || 0,
          status: r.overall_status,
          sampleCount: r.sample_count,
        }))
        .reverse();

      const formattedFeatures = (features || []).map((f: any) => ({
        ...f,
        psi: Number(f.psi) || 0,
        ks_statistic: f.ks_statistic != null ? Number(f.ks_statistic) : null,
        ks_p_value: f.ks_p_value != null ? Number(f.ks_p_value) : null,
      }));

      return {
        latestRun,
        features: formattedFeatures as FeatureRow[],
        trendPoints,
      };
    }
  } catch (err) {
    console.warn("DB query error in dashboard, using fallback demo data:", err);
  }

  // Realistic fallback demo data for initial load and development
  const now = Date.now();
  const mockTrendPoints: TrendPoint[] = [
    { id: 1, timestamp: new Date(now - 86400000 * 3.5).toISOString(), psi: 0.042, status: "STABLE", sampleCount: 1200 },
    { id: 2, timestamp: new Date(now - 86400000 * 3.0).toISOString(), psi: 0.058, status: "STABLE", sampleCount: 1150 },
    { id: 3, timestamp: new Date(now - 86400000 * 2.5).toISOString(), psi: 0.071, status: "STABLE", sampleCount: 1320 },
    { id: 4, timestamp: new Date(now - 86400000 * 2.0).toISOString(), psi: 0.089, status: "STABLE", sampleCount: 1280 },
    { id: 5, timestamp: new Date(now - 86400000 * 1.5).toISOString(), psi: 0.124, status: "WARNING", sampleCount: 1400 },
    { id: 6, timestamp: new Date(now - 86400000 * 1.0).toISOString(), psi: 0.168, status: "WARNING", sampleCount: 1390 },
    { id: 7, timestamp: new Date(now - 86400000 * 0.5).toISOString(), psi: 0.221, status: "DRIFT_DETECTED", sampleCount: 1450 },
  ];

  const mockFeatures: FeatureRow[] = [
    {
      feature_name: "credit_score",
      feature_type: "numerical",
      importance: "high",
      psi: 0.2214,
      status: "DRIFT",
      ks_statistic: 0.184,
      ks_p_value: 0.0001,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "debt_to_income_ratio",
      feature_type: "numerical",
      importance: "high",
      psi: 0.1642,
      status: "WARNING",
      ks_statistic: 0.122,
      ks_p_value: 0.015,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "loan_intent",
      feature_type: "categorical",
      importance: "high",
      psi: 0.1420,
      status: "WARNING",
      chi2_statistic: 28.45,
      chi2_p_value: 0.003,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "annual_income",
      feature_type: "numerical",
      importance: "high",
      psi: 0.0841,
      status: "STABLE",
      ks_statistic: 0.065,
      ks_p_value: 0.24,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "interest_rate",
      feature_type: "numerical",
      importance: "medium",
      psi: 0.0652,
      status: "STABLE",
      ks_statistic: 0.048,
      ks_p_value: 0.42,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "home_ownership",
      feature_type: "categorical",
      importance: "medium",
      psi: 0.0521,
      status: "STABLE",
      chi2_statistic: 4.12,
      chi2_p_value: 0.248,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "age",
      feature_type: "numerical",
      importance: "medium",
      psi: 0.0384,
      status: "STABLE",
      ks_statistic: 0.032,
      ks_p_value: 0.68,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "loan_amount",
      feature_type: "numerical",
      importance: "high",
      psi: 0.0315,
      status: "STABLE",
      ks_statistic: 0.029,
      ks_p_value: 0.75,
      current_stats: { missing_pct: 0.0 },
    },
    {
      feature_name: "employment_history_length",
      feature_type: "numerical",
      importance: "low",
      psi: 0.0245,
      status: "STABLE",
      ks_statistic: 0.021,
      ks_p_value: 0.89,
      current_stats: { missing_pct: 0.0 },
    },
  ];

  return {
    latestRun: {
      id: 7,
      created_at: new Date().toISOString(),
      sample_count: 1450,
      overall_status: "DRIFT_DETECTED",
      max_psi: 0.2214,
      severe_drift_count: 1,
      warning_drift_count: 2,
      prediction_drift: { psi: 0.165, status: "DRIFT" },
      summary: "Severe drift detected on credit_score (PSI 0.2214) and moderate shift on debt_to_income_ratio.",
    },
    features: mockFeatures,
    trendPoints: mockTrendPoints,
  };
}

export default async function DashboardPage() {
  const { latestRun, features, trendPoints } = await getDashboardData();

  return (
    <DashboardInteractiveView
      latestRun={latestRun}
      features={features}
      trendPoints={trendPoints}
    />
  );
}
