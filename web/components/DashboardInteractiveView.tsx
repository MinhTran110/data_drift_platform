"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { PsiTrendChart, TrendPoint } from "@/components/PsiTrendChart";
import { FeatureTable, FeatureRow } from "@/components/FeatureTable";
import { ThresholdSlider } from "@/components/ThresholdSlider";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Activity, Database, AlertTriangle, ShieldCheck } from "lucide-react";

interface DashboardInteractiveViewProps {
  latestRun: any;
  features: FeatureRow[];
  trendPoints: TrendPoint[];
}

export function DashboardInteractiveView({
  latestRun,
  features,
  trendPoints,
}: DashboardInteractiveViewProps) {
  const [warnThreshold, setWarnThreshold] = useState(0.10);
  const [severeThreshold, setSevereThreshold] = useState(0.20);

  // Compute dynamic KPI metrics based on thresholds
  const severeDriftFeatures = features.filter((f) => f.psi >= severeThreshold);
  const warningFeatures = features.filter(
    (f) => f.psi >= warnThreshold && f.psi < severeThreshold
  );

  let overallStatus = "STABLE";
  if (severeDriftFeatures.length > 0) {
    overallStatus = "DRIFT_DETECTED";
  } else if (warningFeatures.length > 0) {
    overallStatus = "WARNING";
  }

  const handleReset = () => {
    setWarnThreshold(0.10);
    setSevereThreshold(0.20);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Status Overview */}
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  Drift Overview &amp; Health Dashboard
                </h1>
                <StatusBadge status={overallStatus} size="lg" />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Giám sát suy thoái dữ liệu mẻ cận thời gian thực (Cửa sổ 6 giờ) • Mô hình chấm điểm:{" "}
                <code className="text-primary font-mono font-semibold">credit_risk_default</code>
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/retrain">
                <Button className="gap-2 shadow-sm font-semibold">
                  <span>Trung Tâm Retrain &amp; Quản Trị</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Champion Model Version</span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">
                {latestRun?.champion_version || "v10"}
              </span>
              <Badge variant="stable">In-Production</Badge>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Zero-downtime hot reload active</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Max Feature PSI</span>
              <AlertTriangle className="h-4 w-4 text-rose-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                {Number(latestRun.max_psi).toFixed(4)}
              </span>
              <span className="text-xs font-mono text-muted-foreground">credit_score</span>
            </div>
            <p className="mt-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {severeDriftFeatures.length} đặc trưng vượt ngưỡng nghiêm trọng ({severeThreshold.toFixed(2)})
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Batch Monitored Samples</span>
              <Database className="h-4 w-4 text-blue-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">
                {Number(latestRun.sample_count).toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">rows / 6h</span>
            </div>
            <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Vượt ngưỡng tối thiểu min_samples (100)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">Prediction Drift PSI</span>
              <Activity className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {latestRun.prediction_drift?.psi !== undefined
                  ? Number(latestRun.prediction_drift.psi).toFixed(4)
                  : "0.0000"}
              </span>
              <StatusBadge status={latestRun.prediction_drift?.status || "STABLE"} size="sm" />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Độ lệch phân phối xác suất dự đoán</p>
          </CardContent>
        </Card>
      </div>

      {/* Interactive Threshold Slider */}
      <ThresholdSlider
        warnThreshold={warnThreshold}
        severeThreshold={severeThreshold}
        onChange={(warn, severe) => {
          setWarnThreshold(warn);
          setSevereThreshold(severe);
        }}
        onReset={handleReset}
      />

      {/* Historical PSI Trend Chart */}
      <PsiTrendChart data={trendPoints} />

      {/* Feature Breakdown Table with Dynamic Thresholds & Pagination */}
      <FeatureTable
        features={features}
        warnThreshold={warnThreshold}
        severeThreshold={severeThreshold}
      />
    </div>
  );
}
