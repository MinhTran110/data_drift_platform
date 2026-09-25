"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "./StatusBadge";

export interface FeatureRow {
  feature_name: string;
  feature_type: string;
  importance: string;
  psi: number;
  status: string;
  ks_statistic?: number;
  ks_p_value?: number;
  chi2_statistic?: number;
  chi2_p_value?: number;
  current_stats?: {
    mean?: number;
    missing_pct?: number;
  };
  baseline_stats?: {
    mean?: number;
  };
}

interface FeatureTableProps {
  features: FeatureRow[];
}

export function FeatureTable({ features }: FeatureTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = (features || []).filter((f) => {
    const matchesSearch = f.feature_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "ALL" ||
      (statusFilter === "DRIFT" && f.status === "DRIFT") ||
      (statusFilter === "WARNING" && f.status === "WARNING") ||
      (statusFilter === "STABLE" && f.status === "STABLE");
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header and Controls */}
      <div className="border-b border-slate-200 p-4 sm:flex sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Monitored Features Drift Breakdown</h3>
          <p className="text-xs text-slate-500">
            Comparison against baseline reference distribution. Click any feature for detailed histogram overlay.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-3 sm:mt-0">
          <input
            type="text"
            placeholder="Search features..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRIFT">Drift Only (🚨)</option>
            <option value="WARNING">Warning (⚠️)</option>
            <option value="STABLE">Stable (✅)</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-semibold">
            <tr>
              <th scope="col" className="px-4 py-3">Feature</th>
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Importance</th>
              <th scope="col" className="px-4 py-3">PSI Value</th>
              <th scope="col" className="px-4 py-3">Statistical Test (p-val)</th>
              <th scope="col" className="px-4 py-3">Null Rate</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No features match the selected filter.
                </td>
              </tr>
            ) : (
              filtered.map((f) => {
                const psiWidth = Math.min(100, (f.psi / 0.3) * 100);
                const psiColor =
                  f.psi >= 0.2 ? "bg-rose-500" : f.psi >= 0.1 ? "bg-amber-500" : "bg-emerald-500";

                return (
                  <tr key={f.feature_name} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <Link
                        href={`/dashboard/${f.feature_name}`}
                        className="hover:text-blue-600 hover:underline flex items-center gap-1.5"
                      >
                        {f.feature_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-mono text-slate-600">
                        {f.feature_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[11px] font-medium capitalize ${
                          f.importance === "high" || f.importance === "critical"
                            ? "text-rose-600 font-semibold"
                            : f.importance === "medium"
                            ? "text-slate-700"
                            : "text-slate-400"
                        }`}
                      >
                        {f.importance}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-12 font-mono font-medium text-slate-800">
                          {Number(f.psi || 0).toFixed(4)}
                        </span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${psiColor}`}
                            style={{ width: `${psiWidth}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">
                      {f.feature_type === "numerical" ? (
                        <span>
                          KS: {f.ks_statistic ?? "-"} (p={f.ks_p_value !== undefined ? Number(f.ks_p_value).toFixed(4) : "-"})
                        </span>
                      ) : (
                        <span>
                          Chi²: {f.chi2_statistic ?? "-"} (p={f.chi2_p_value !== undefined ? Number(f.chi2_p_value).toFixed(4) : "-"})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono">
                      {f.current_stats?.missing_pct !== undefined
                        ? `${(f.current_stats.missing_pct * 100).toFixed(1)}%`
                        : "0.0%"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={f.status} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/${f.feature_name}`}
                        className="font-medium text-blue-600 hover:text-blue-800 text-xs inline-flex items-center gap-1"
                      >
                        Inspect →
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
