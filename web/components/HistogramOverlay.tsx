"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

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
      <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 text-muted-foreground">
        Không có dữ liệu phân phối histogram cho {featureName}.
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

  const maxPct =
    Math.max(0.15, ...baseline_pct, ...production_pct) * 1.15;

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / maxPct) * chartHeight;
  };

  const binSlotWidth = chartWidth / numBins;
  const barWidth = Math.max(6, Math.min(26, binSlotWidth * 0.36));
  const barGap = 3;

  return (
    <Card className="relative overflow-hidden border-border bg-card shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              So Sánh Trực Quan Phân Phối (Baseline vs. Production Histogram Overlay)
            </h3>
            <p className="text-xs text-muted-foreground">
              Đối chiếu phân phối tham chiếu huấn luyện (Baseline) với mẻ dữ liệu sản xuất hiện tại (6h)
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-blue-500" />
              <span className="text-foreground font-medium">Baseline (Huấn luyện)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-sm bg-amber-500" />
              <span className="text-foreground font-medium">Production (Mẻ 6h)</span>
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
                    stroke="currentColor"
                    className="text-border/60"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="text-[10px] fill-muted-foreground font-mono"
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
                      fill="currentColor"
                      className="text-muted/40"
                    />
                  )}

                  {/* Baseline bar */}
                  <rect
                    x={bX}
                    y={bY}
                    width={barWidth}
                    height={bHeight}
                    fill="#3b82f6"
                    opacity={isHovered ? 1.0 : 0.85}
                    rx="2"
                    className="transition-all duration-150"
                  />

                  {/* Production bar */}
                  <rect
                    x={pX}
                    y={pY}
                    width={barWidth}
                    height={pHeight}
                    fill="#f59e0b"
                    opacity={isHovered ? 1.0 : 0.85}
                    rx="2"
                    className="transition-all duration-150"
                  />

                  {/* Bin label on X-axis */}
                  <text
                    x={slotCenterX}
                    y={svgHeight - 20}
                    textAnchor="middle"
                    className={`text-[9px] font-sans transition-colors ${
                      isHovered
                        ? "fill-foreground font-bold"
                        : "fill-muted-foreground"
                    }`}
                    transform={
                      bin_labels.length > 6
                        ? `rotate(-30, ${slotCenterX}, ${svgHeight - 20})`
                        : undefined
                    }
                  >
                    {label.length > 15 ? label.slice(0, 14) + "…" : label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover Tooltip Details */}
          {hoveredBin !== null && (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                <span className="font-semibold text-foreground">
                  Phân vị / Nhãn: <code className="text-primary">{bin_labels[hoveredBin]}</code>
                </span>
                {psi_components && psi_components[hoveredBin] !== undefined && (
                  <span className="font-mono text-muted-foreground">
                    PSI Component:{" "}
                    <strong
                      className={
                        psi_components[hoveredBin] > 0.05
                          ? "text-rose-500"
                          : psi_components[hoveredBin] > 0.02
                          ? "text-amber-500"
                          : "text-emerald-500"
                      }
                    >
                      {psi_components[hoveredBin].toFixed(4)}
                    </strong>
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                  <span className="text-muted-foreground">Tỷ lệ Baseline:</span>
                  <span className="font-mono font-medium text-foreground">
                    {((baseline_pct[hoveredBin] || 0) * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />
                  <span className="text-muted-foreground">Tỷ lệ Production:</span>
                  <span className="font-mono font-medium text-foreground">
                    {((production_pct[hoveredBin] || 0) * 100).toFixed(2)}%
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
