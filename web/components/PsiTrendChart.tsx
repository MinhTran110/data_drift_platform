"use client";

import React, { useState } from "react";

export interface TrendPoint {
  id: number | string;
  timestamp: string;
  psi: number;
  status: string;
  sampleCount: number;
  maxFeature?: string;
}

interface PsiTrendChartProps {
  data: TrendPoint[];
  height?: number;
}

export function PsiTrendChart({ data, height = 260 }: PsiTrendChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400">
        No historical drift runs recorded yet.
      </div>
    );
  }

  const paddingLeft = 50;
  const paddingRight = 30;
  const paddingTop = 25;
  const paddingBottom = 45;
  const svgWidth = 800;
  const svgHeight = height;

  const chartWidth = svgWidth - paddingLeft - paddingRight;
  const chartHeight = svgHeight - paddingTop - paddingBottom;

  const maxVal = Math.max(0.35, ...data.map((d) => d.psi * 1.25));

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / maxVal) * chartHeight;
  };

  const getX = (index: number) => {
    if (data.length <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (data.length - 1)) * chartWidth;
  };

  // Generate SVG path points
  const points = data.map((d, i) => `${getX(i)},${getY(d.psi)}`).join(" ");
  const areaPoints = `${getX(0)},${getY(0)} ${points} ${getX(data.length - 1)},${getY(0)}`;

  const warnY = getY(0.1);
  const severeY = getY(0.2);

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">PSI Trend Over Time (Batch Windows)</h3>
          <p className="text-xs text-slate-500">Chronological history of maximum feature PSI across 6-hour monitoring batches</p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-emerald-500 border border-emerald-500" />
            <span className="text-slate-600">Stable (&lt;0.10)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-b-2 border-dashed border-amber-500" />
            <span className="text-slate-600">Warning (0.10)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-b-2 border-dashed border-rose-500" />
            <span className="text-slate-600">Severe Drift (0.20)</span>
          </div>
        </div>
      </div>

      <div className="w-full">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <defs>
            <linearGradient id="psiGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="50%" stopColor="#f59e0b" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Grid lines and Y-axis labels */}
          {[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((val) => {
            const y = getY(val);
            if (y < paddingTop - 5) return null;
            return (
              <g key={val}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={svgWidth - paddingRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth="1"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="text-[10px] fill-slate-400 font-mono"
                >
                  {val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Threshold Lines */}
          {warnY >= paddingTop && (
            <g>
              <line
                x1={paddingLeft}
                y1={warnY}
                x2={svgWidth - paddingRight}
                y2={warnY}
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={svgWidth - paddingRight + 5}
                y={warnY + 3}
                className="text-[9px] fill-amber-600 font-semibold"
              >
                0.10 Warning
              </text>
            </g>
          )}

          {severeY >= paddingTop && (
            <g>
              <line
                x1={paddingLeft}
                y1={severeY}
                x2={svgWidth - paddingRight}
                y2={severeY}
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
              <text
                x={svgWidth - paddingRight + 5}
                y={severeY + 3}
                className="text-[9px] fill-rose-600 font-semibold"
              >
                0.20 Alert
              </text>
            </g>
          )}

          {/* Area fill */}
          <polygon points={areaPoints} fill="url(#psiGradient)" />

          {/* Line */}
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />

          {/* Data Points */}
          {data.map((d, i) => {
            const cx = getX(i);
            const cy = getY(d.psi);
            const isHovered = hoveredIndex === i;
            const dotColor =
              d.psi >= 0.2 ? "#ef4444" : d.psi >= 0.1 ? "#f59e0b" : "#10b981";

            return (
              <g
                key={i}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 6 : 4}
                  fill={dotColor}
                  stroke="#ffffff"
                  strokeWidth="2"
                  className="transition-all duration-150"
                />
                {/* Tooltip trigger hitbox */}
                <circle cx={cx} cy={cy} r={14} fill="transparent" />
              </g>
            );
          })}

          {/* X-axis labels */}
          {data.map((d, i) => {
            // Render subset of labels to prevent crowding
            if (data.length > 8 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) {
              return null;
            }
            const cx = getX(i);
            const dateLabel = new Date(d.timestamp).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
            });
            return (
              <text
                key={i}
                x={cx}
                y={svgHeight - 12}
                textAnchor="middle"
                className="text-[10px] fill-slate-500 font-sans"
              >
                {dateLabel}
              </text>
            );
          })}
        </svg>

        {/* Hover Tooltip Popup */}
        {hoveredIndex !== null && data[hoveredIndex] && (
          <div
            className="absolute z-20 pointer-events-none rounded-lg border border-slate-200 bg-slate-900/90 p-2.5 text-xs text-white shadow-xl backdrop-blur-sm"
            style={{
              left: `${Math.min(Math.max(10, (getX(hoveredIndex) / svgWidth) * 100), 85)}%`,
              top: `${Math.max(10, getY(data[hoveredIndex].psi) - 50)}px`,
            }}
          >
            <div className="font-semibold text-slate-200">
              {new Date(data[hoveredIndex].timestamp).toLocaleString()}
            </div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-slate-400">Max PSI:</span>
              <span className="font-mono font-bold text-amber-400">
                {data[hoveredIndex].psi.toFixed(4)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Status:</span>
              <span className="font-medium">{data[hoveredIndex].status}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-400">Samples:</span>
              <span>{data[hoveredIndex].sampleCount.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
