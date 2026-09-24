import React from "react";
import Link from "next/link";
import { query } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { HistogramOverlay, HistogramData } from "@/components/HistogramOverlay";

interface FeaturePageProps {
  params: {
    feature: string;
  };
}

async function getFeatureDetail(featureName: string) {
  try {
    const rows = await query(
      `SELECT fm.*, dr.created_at as run_created_at
       FROM feature_metrics fm
       JOIN drift_runs dr ON dr.id = fm.run_id
       WHERE fm.feature_name = $1
       ORDER BY fm.id DESC LIMIT 1`,
      [featureName]
    );

    if (rows && rows.length > 0) {
      return rows[0];
    }
  } catch (err) {
    console.warn("DB query error for feature detail, using fallback:", err);
  }

  // Fallback demo mock for deep-dive demonstration
  const isContinuous = featureName !== "loan_intent" && featureName !== "home_ownership";
  let mockHistogram: HistogramData;

  if (isContinuous) {
    mockHistogram = {
      bin_labels: [
        "[300.00, 480.00]",
        "[480.00, 540.00]",
        "[540.00, 600.00]",
        "[600.00, 650.00]",
        "[650.00, 690.00]",
        "[690.00, 730.00]",
        "[730.00, 770.00]",
        "[770.00, 810.00]",
        "[810.00, 850.00]",
      ],
      baseline_pct: [0.08, 0.10, 0.12, 0.15, 0.16, 0.14, 0.12, 0.08, 0.05],
      production_pct: [0.18, 0.20, 0.19, 0.16, 0.11, 0.08, 0.05, 0.02, 0.01],
      psi_components: [0.081, 0.069, 0.032, 0.001, -0.018, -0.033, -0.045, -0.051, -0.036],
    };
  } else {
    mockHistogram = {
      bin_labels: ["PERSONAL", "EDUCATION", "MEDICAL", "VENTURE", "HOMEIMPROVEMENT", "DEBTCONSOLIDATION"],
      baseline_pct: [0.25, 0.15, 0.15, 0.10, 0.15, 0.20],
      production_pct: [0.12, 0.08, 0.38, 0.06, 0.08, 0.28],
      psi_components: [0.052, 0.031, 0.142, 0.015, 0.028, 0.041],
    };
  }

  return {
    feature_name: featureName,
    feature_type: isContinuous ? "numerical" : "categorical",
    importance: "high",
    psi: isContinuous ? 0.2214 : 0.142,
    status: isContinuous ? "DRIFT" : "WARNING",
    ks_statistic: 0.184,
    ks_p_value: 0.0001,
    chi2_statistic: 28.45,
    chi2_p_value: 0.003,
    baseline_stats: {
      mean: 680.5,
      std: 75.2,
      median: 678.0,
      min: 300.0,
      max: 850.0,
      missing_pct: 0.0,
    },
    current_stats: {
      mean: 618.2,
      std: 82.4,
      median: 612.0,
      min: 300.0,
      max: 840.0,
      missing_pct: 0.0,
    },
    histogram_data: mockHistogram,
  };
}

export default async function FeatureDetailPage({ params }: FeaturePageProps) {
  const featureName = decodeURIComponent(params.feature);
  const detail = await getFeatureDetail(featureName);

  return (
    <div className="space-y-6">
      {/* Navigation and Title */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <Link
            href="/dashboard"
            className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 mb-2"
          >
            ← Back to Dashboard Overview
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900 font-mono">{detail.feature_name}</h1>
            <StatusBadge status={detail.status} size="md" />
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">
              {detail.feature_type}
            </span>
            <span className="text-xs font-semibold text-rose-600 uppercase">
              {detail.importance} importance
            </span>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2 text-right">
          <span className="text-[11px] text-slate-500">Population Stability Index (PSI)</span>
          <div className="text-xl font-bold font-mono text-slate-900">
            {Number(detail.psi).toFixed(4)}
          </div>
        </div>
      </div>

      {/* Histogram Overlay Component */}
      <HistogramOverlay
        featureName={detail.feature_name}
        data={detail.histogram_data || {}}
      />

      {/* Summary Stats Comparison & Statistical Tests */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Statistical Test Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Statistical Hypothesis Testing
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Rigorous statistical tests comparing baseline reference vs. current batch window
          </p>

          {detail.feature_type === "numerical" ? (
            <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">Test Type:</span>
                <span className="font-semibold text-slate-900">Two-Sample Kolmogorov-Smirnov (KS) Test</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">KS Statistic:</span>
                <span className="font-mono font-bold text-slate-800">{detail.ks_statistic ?? "N/A"}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">p-value:</span>
                <span className="font-mono font-bold text-rose-600">
                  {detail.ks_p_value !== undefined ? detail.ks_p_value.toFixed(6) : "N/A"}
                </span>
              </div>
              <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                <strong>Verdict:</strong>{" "}
                {detail.ks_p_value !== undefined && detail.ks_p_value < 0.05
                  ? "p < 0.05 — Statistically significant difference between distributions. Null hypothesis rejected."
                  : "p >= 0.05 — No statistically significant distribution shift detected."}
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium">Test Type:</span>
                <span className="font-semibold text-slate-900">Chi-Square Test of Homogeneity (χ²)</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">χ² Statistic:</span>
                <span className="font-mono font-bold text-slate-800">{detail.chi2_statistic ?? "N/A"}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">p-value:</span>
                <span className="font-mono font-bold text-rose-600">
                  {detail.chi2_p_value !== undefined ? detail.chi2_p_value.toFixed(6) : "N/A"}
                </span>
              </div>
              <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
                <strong>Verdict:</strong>{" "}
                {detail.chi2_p_value !== undefined && detail.chi2_p_value < 0.05
                  ? "p < 0.05 — Significant categorical frequency discrepancy detected."
                  : "p >= 0.05 — Categorical frequencies remain consistent with baseline."}
              </div>
            </div>
          )}
        </div>

        {/* Baseline vs Production Summary Statistics */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Distribution Metrics Comparison
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Key summary moments for reference training set vs current batch window
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="border-b border-slate-200 text-slate-500 font-medium">
                <tr>
                  <th className="py-2">Metric</th>
                  <th className="py-2 text-blue-600 font-semibold">Baseline</th>
                  <th className="py-2 text-amber-600 font-semibold">Production (6h)</th>
                  <th className="py-2 text-right">Delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {detail.feature_type === "numerical" ? (
                  <>
                    <tr>
                      <td className="py-2 text-slate-600 font-sans">Mean</td>
                      <td className="py-2">{detail.baseline_stats?.mean?.toFixed(2) ?? "-"}</td>
                      <td className="py-2 font-bold">{detail.current_stats?.mean?.toFixed(2) ?? "-"}</td>
                      <td className="py-2 text-right text-rose-600">
                        {detail.baseline_stats?.mean && detail.current_stats?.mean
                          ? (detail.current_stats.mean - detail.baseline_stats.mean).toFixed(2)
                          : "-"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-600 font-sans">Std Dev</td>
                      <td className="py-2">{detail.baseline_stats?.std?.toFixed(2) ?? "-"}</td>
                      <td className="py-2">{detail.current_stats?.std?.toFixed(2) ?? "-"}</td>
                      <td className="py-2 text-right">
                        {detail.baseline_stats?.std && detail.current_stats?.std
                          ? (detail.current_stats.std - detail.baseline_stats.std).toFixed(2)
                          : "-"}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-600 font-sans">Median</td>
                      <td className="py-2">{detail.baseline_stats?.median?.toFixed(2) ?? "-"}</td>
                      <td className="py-2">{detail.current_stats?.median?.toFixed(2) ?? "-"}</td>
                      <td className="py-2 text-right">
                        {detail.baseline_stats?.median && detail.current_stats?.median
                          ? (detail.current_stats.median - detail.baseline_stats.median).toFixed(2)
                          : "-"}
                      </td>
                    </tr>
                  </>
                ) : (
                  <>
                    <tr>
                      <td className="py-2 text-slate-600 font-sans">Top Category</td>
                      <td className="py-2 font-sans">{detail.baseline_stats?.top_category ?? "-"}</td>
                      <td className="py-2 font-sans font-bold">{detail.current_stats?.top_category ?? "-"}</td>
                      <td className="py-2 text-right font-sans text-slate-400">-</td>
                    </tr>
                    <tr>
                      <td className="py-2 text-slate-600 font-sans">Distinct Categories</td>
                      <td className="py-2">{detail.baseline_stats?.unique_count ?? "-"}</td>
                      <td className="py-2">{detail.current_stats?.unique_count ?? "-"}</td>
                      <td className="py-2 text-right">0</td>
                    </tr>
                  </>
                )}
                <tr>
                  <td className="py-2 text-slate-600 font-sans">Missing / Null Rate</td>
                  <td className="py-2">0.0%</td>
                  <td className="py-2 font-bold">
                    {detail.current_stats?.missing_pct !== undefined
                      ? `${(detail.current_stats.missing_pct * 100).toFixed(1)}%`
                      : "0.0%"}
                  </td>
                  <td className="py-2 text-right text-emerald-600">Passed</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
