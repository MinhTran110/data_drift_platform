"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

interface RetrainJobItem {
  id: number;
  run_id?: number;
  triggered_by: string;
  status: string;
  champion_version?: string;
  challenger_version?: string;
  metrics?: any;
  approved_by?: string;
  error_message?: string;
  created_at: string;
}

export default function RetrainPage() {
  const [jobs, setJobs] = useState<RetrainJobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/retrain");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
      }
    } catch (e) {
      console.error("Failed to load retrain jobs:", e);
    }
  };

  const handleTriggerRetrain = async () => {
    if (!confirm("Are you sure you want to trigger the model retraining workflow on GitHub Actions?")) {
      return;
    }
    setLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/retrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggered_by: "MANUAL_DASHBOARD",
          reason: "Manual trigger from Web Governance Center",
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage(`Retrain job #${data.job_id} successfully queued! Workflow dispatched to GitHub Actions.`);
        fetchJobs();
      } else {
        setActionMessage(`Retrain failed: ${data.message || data.error}`);
      }
    } catch (e: any) {
      setActionMessage(`Network error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900">Model Retraining &amp; Governance Center</h1>
            <span className="rounded bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              Closed-Loop Automation
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Automated Champion vs Challenger offline evaluation, GitHub Actions workflow dispatch, and zero-downtime hot reload.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleTriggerRetrain}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {loading ? "Dispatching..." : "🚀 Trigger Retrain Workflow"}
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs font-medium text-blue-800">
          {actionMessage}
        </div>
      )}

      {/* Model Governance Status Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Active Champion Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Active Champion
          </span>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-3xl font-extrabold text-slate-900">v1</span>
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              In Production
            </span>
          </div>
          <div className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Model Architecture:</span>
              <span className="font-mono font-medium text-slate-800">HistGradientBoosting</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Validation ROC-AUC:</span>
              <span className="font-mono font-bold text-slate-900">0.8420</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Validation F1-Score:</span>
              <span className="font-mono font-medium text-slate-800">0.7812</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Hot Reload Mode:</span>
              <span className="text-emerald-600 font-medium">Atomic Zero-Downtime</span>
            </div>
          </div>
        </div>

        {/* Retraining Gate Policy */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Promotion Gate Criteria
          </span>
          <div className="mt-4 space-y-2.5 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong>ROC-AUC Delta:</strong> Challenger must achieve \(\Delta \ge 0.005\) over Champion.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong>Max Degradation:</strong> Reject if validation AUC drops by \(&gt; 1.0\%\).
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong>Baseline Refresh:</strong> Automatically updates <code>bins.json</code> and reference samples on promotion.
              </span>
            </div>
          </div>
        </div>

        {/* Trigger Channels */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Approval &amp; Trigger Channels
          </span>
          <div className="mt-4 space-y-2.5 text-xs">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <div className="font-semibold text-slate-900">1. Telegram 1-Click Approval</div>
              <div className="text-slate-500 text-[11px]">
                Engineers receive critical alerts with inline <code>[Approve Retrain]</code> button.
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
              <div className="font-semibold text-slate-900">2. Automated Severe Trigger</div>
              <div className="text-slate-500 text-[11px]">
                Dispatches workflow automatically when &ge;2 high-importance features drift.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Retraining Jobs History */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-4">
          <h3 className="text-base font-semibold text-slate-900">Retraining Jobs &amp; Audit Trail</h3>
          <p className="text-xs text-slate-500">History of champion vs challenger retraining workflows</p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-semibold">
              <tr>
                <th className="px-4 py-3">Job ID</th>
                <th className="px-4 py-3">Triggered By</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Champion vs Challenger</th>
                <th className="px-4 py-3">Evaluation Delta</th>
                <th className="px-4 py-3">Approved By</th>
                <th className="px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No retraining jobs recorded yet.
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono font-medium text-slate-900">#{job.id}</td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-700">
                        {job.triggered_by}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          job.status === "COMPLETED"
                            ? "bg-emerald-50 text-emerald-700"
                            : job.status === "RUNNING"
                            ? "bg-blue-50 text-blue-700 animate-pulse"
                            : job.status === "PENDING"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {job.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-700">
                      {job.champion_version || "v1"} → {job.challenger_version || "v2"}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {job.metrics?.delta_auc !== undefined ? (
                        <span className={job.metrics.delta_auc >= 0 ? "text-emerald-600 font-bold" : "text-rose-600"}>
                          Δ AUC: {job.metrics.delta_auc >= 0 ? "+" : ""}
                          {job.metrics.delta_auc.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-slate-400">Pending Evaluation</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{job.approved_by || "System"}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono">
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
