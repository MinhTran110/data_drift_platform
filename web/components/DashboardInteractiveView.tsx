"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { PsiTrendChart, TrendPoint } from "@/components/PsiTrendChart";
import { FeatureTable, FeatureRow } from "@/components/FeatureTable";
import { ThresholdSlider } from "@/components/ThresholdSlider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRight,
  Activity,
  Database,
  AlertTriangle,
  ShieldCheck,
  Layers,
  Filter,
  Flame,
  CheckCircle2,
} from "lucide-react";
import sourceDriftData from "@/lib/source_drift_data.json";

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
  const [selectedSource, setSelectedSource] = useState<string>("ALL");
  const [warnThreshold, setWarnThreshold] = useState(0.10);
  const [severeThreshold, setSevereThreshold] = useState(0.20);

  // Source-specific data resolution
  const sourcesMap: Record<string, any> = sourceDriftData || {};
  const isSourceSelected = selectedSource !== "ALL" && sourcesMap[selectedSource];

  const currentFeatures: FeatureRow[] = isSourceSelected
    ? sourcesMap[selectedSource].features
    : features;

  const currentSampleCount = isSourceSelected
    ? sourcesMap[selectedSource].sample_count
    : Number(latestRun?.sample_count || 1100);

  const currentMaxPsi = isSourceSelected
    ? sourcesMap[selectedSource].max_psi
    : Number(latestRun?.max_psi || 7.4816);

  // Compute dynamic KPI metrics based on thresholds
  const severeDriftFeatures = currentFeatures.filter((f) => f.psi >= severeThreshold);
  const warningFeatures = currentFeatures.filter(
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
                Giám sát suy thoái dữ liệu mẻ cận thời gian thực • Mô hình chấm điểm:{" "}
                <code className="text-primary font-mono font-semibold">credit_risk_default</code>
                {isSourceSelected && (
                  <span className="ml-2 inline-flex items-center gap-1 font-semibold text-foreground">
                    • Đang lọc nguồn: <Badge variant="info">{sourcesMap[selectedSource]?.name}</Badge>
                  </span>
                )}
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

      {/* Multi-Source Segment Switcher & Drift Attribution */}
      <Card className="border-border bg-card">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Phân Đoạn &amp; Bóc Tách Nguồn Dữ Liệu (Multi-Source Drift Attribution)
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                Chọn nguồn để xem độ lệch phân phối riêng biệt của từng đối tác / kênh nạp
              </span>
            </div>

            {/* Source Segment Selection Tabs / Buttons */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 pt-1">
              <button
                type="button"
                onClick={() => setSelectedSource("ALL")}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                  selectedSource === "ALL"
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-blue-500" />
                    Tất Cả Các Nguồn (Combined)
                  </span>
                  <Badge variant="destructive" className="font-mono text-[10px]">PSI 7.48</Badge>
                </div>
                <span className="text-[11px] text-muted-foreground mt-1">1,100 mẫu • 7/9 đặc trưng drift chung</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedSource("lending_club")}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                  selectedSource === "lending_club"
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-emerald-500" />
                    LendingClub P2P Loans
                  </span>
                  <Badge variant="destructive" className="font-mono text-[10px]">PSI 6.88</Badge>
                </div>
                <span className="text-[11px] text-muted-foreground mt-1">500 mẫu • Nhà ở &amp; Thu nhập ổn định</span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedSource("economic_shock")}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                  selectedSource === "economic_shock"
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Flame className="h-3.5 w-3.5 text-rose-500" />
                    Bão Kinh Tế &amp; Lãi Suất
                  </span>
                  <Badge variant="destructive" className="font-mono text-[10px]">PSI 14.01</Badge>
                </div>
                <span className="text-[11px] text-rose-600 dark:text-rose-400 font-medium mt-1">
                  600 mẫu • Lãi suất &amp; DTI lệch nặng nhất
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSelectedSource("crm_sample")}
                className={`flex flex-col items-start p-3 rounded-lg border text-left transition-all ${
                  selectedSource === "crm_sample"
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-purple-500" />
                    CRM Tiêu Dùng (VN)
                  </span>
                  <Badge variant="destructive" className="font-mono text-[10px]">PSI 3.95</Badge>
                </div>
                <span className="text-[11px] text-muted-foreground mt-1">300 mẫu • Mục đích &amp; Thâm niên ổn định</span>
              </button>
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
                {latestRun?.champion_version || "v12"}
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
              <span className="text-2xl font-bold text-rose-600 dark:text-rose-400 font-mono">
                {currentMaxPsi.toFixed(4)}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {isSourceSelected ? sourcesMap[selectedSource]?.name : "credit_score"}
              </span>
            </div>
            <p className="mt-2 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {severeDriftFeatures.length} đặc trưng vượt ngưỡng ({severeThreshold.toFixed(2)})
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
              <span className="text-2xl font-bold text-foreground font-mono">
                {Number(currentSampleCount).toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">hồ sơ / mẻ</span>
            </div>
            <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              Đủ điều kiện thống kê tối thiểu (min 100)
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
              <span className="text-2xl font-bold text-amber-600 dark:text-amber-400 font-mono">
                {latestRun?.prediction_drift?.psi !== undefined
                  ? Number(latestRun.prediction_drift.psi).toFixed(4)
                  : "0.0000"}
              </span>
              <StatusBadge status={latestRun?.prediction_drift?.status || "STABLE"} size="sm" />
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
        features={currentFeatures}
        warnThreshold={warnThreshold}
        severeThreshold={severeThreshold}
      />
    </div>
  );
}
