"use client";

import React, { useState } from "react";

export interface HistogramData {
  bin_labels: string[];
  baseline_pct: number[];
  production_pct: number[];
  psi_components?: number[];
  bin_edges?: number[];
}

interface HistogramOverlayProps {
  featureName: string;
  data: HistogramData;
  height?: number;
}

export function HistogramOverlay({
  featureName,
  data,
  height = 320,
}: HistogramOverlayProps) {
  const [hoveredBin, setHoveredBin] = useState<number | null>(null);

  if (!data || !data.bin_labels || data.bin_labels.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400">
        No histogram distribution data available for {featureName}.
      </div>
    );
  }

  const { bin_labels, baseline_pct, production_pct, psi_components } = data;
  const numBins = bin_labels.length;

  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 25;
  const paddingBottom = 60;
  const svgWidth = 800;
  const svgHeight = height;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  const maxPct = Math.max(
    0.15,
    ...baseline_pct,
    ...production_pct
  ) * 1.15;

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / maxPct) * chartHeight;
  };

  const binSlotWidth = chartWidth / numBins;
  const barWidth = Math.max(6, Math.min(26, binSlotWidth * 0.36));
  const barGap = 3;

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Baseline vs. Production Histogram Overlay
          </h3>
          <p className="text-xs text-slate-500">
            Comparing reference training distribution (Baseline) against current 6h production window
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-blue-500" />
            <span className="text-slate-700 font-medium">Baseline Distribution</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-amber-500" />
            <span className="text-slate-700 font-medium">Production Current</span>
          </div>
        </div>
      </div>

      <div className="w-full">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto overflow-visible select-none"
        >
          {/* Grid lines */}
          {[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4].map((pct) => {
            const y = getY(pct);
            if (y < paddingTop - 5) return null;
            return (
              <g key={pct}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="text-[10px] fill-slate-400 font-mono"
                >
                  {(pct * 100).toFixed(0)}%
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {bin_labels.map((label, i) => {
            const slotCenterX = paddingLeft + (i + 0.5) * binSlotWidth;
            const bPct = baseline_pct[i] || 0;
            const pPct = production_pct[i] || 0;

            const bY = getY(bPct);
            const bHeight = Math.max(1, chartHeight - (bY - paddingTop));

            const pY = getY(pPct);
            const pHeight = Math.max(1, chartHeight - (pY - paddingTop));

            const bX = slotCenterX - barWidth - barGap / 2;
            const pX = slotCenterX + barGap / 2;

            const isHovered = hoveredBin === i;

            return (
              <g
                key={i}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredBin(i)}
                onMouseLeave={() => setHoveredBin(null)}
              >
                {/* Highlight background on hover */}
                {isHovered && (
                  <rect
                    x={slotCenterX - binSlotWidth / 2}
                    y={paddingTop}
                    width={binSlotWidth}
                    height={chartHeight}
                    fill="#f8fafc"
                    rx={4}
                  />
                )}

                {/* Baseline Bar */}
                <rect
                  x={bX}
                  y={bY}
                  width={barWidth}
                  height={bHeight}
                  fill="#3b82f6"
                  opacity={isHovered ? 1.0 : 0.85}
                  rx={2}
                />

                {/* Production Bar */}
                <rect
                  x={pX}
                  y={pY}
                  width={barWidth}
                  height={pHeight}
                  fill="#f59e0b"
                  opacity={isHovered ? 1.0 : 0.85}
                  rx={2}
                />

                {/* Bin Label */}
                <text
                  x={slotCenterX}
                  y={svgHeight - paddingBottom + 16}
                  textAnchor="end"
                  transform={`rotate(-35, ${slotCenterX}, ${svgHeight - paddingBottom + 16})`}
                  className={`text-[9px] font-mono transition-colors ${
                    isHovered ? "fill-slate-900 font-bold" : "fill-slate-500"
                  }`}
                >
                  {label.length > 14 ? label.slice(0, 12) + "…" : label}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Details */}
        {hoveredBin !== null && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-slate-500">Bin:</span>{" "}
              <strong className="font-mono text-slate-800">{bin_labels[hoveredBin]}</strong>
            </div>
            <div>
              <span className="text-blue-600 font-medium">Baseline:</span>{" "}
              <strong className="font-mono">
                {((baseline_pct[hoveredBin] || 0) * 100).toFixed(2)}%
              </strong>
            </div>
            <div>
              <span className="text-amber-600 font-medium">Production:</span>{" "}
              <strong className="font-mono">
                {((production_pct[hoveredBin] || 0) * 100).toFixed(2)}%
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Delta:</span>{" "}
              <strong
                className={`font-mono ${
                  (production_pct[hoveredBin] || 0) - (baseline_pct[hoveredBin] || 0) > 0
                    ? "text-rose-600"
                    : "text-emerald-600"
                }`}
              >
                {(
                  ((production_pct[hoveredBin] || 0) - (baseline_pct[hoveredBin] || 0)) *
                  100
                ).toFixed(2)}
                %
              </strong>
            </div>
            {psi_components && psi_components[hoveredBin] !== undefined && (
              <div>
                <span className="text-slate-500">PSI Contribution:</span>{" "}
                <strong className="font-mono text-purple-700">
                  {psi_components[hoveredBin].toFixed(5)}
                </strong>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
