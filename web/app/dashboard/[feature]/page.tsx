import React from "react";
import Link from "next/link";
import { query } from "@/lib/db";
import { StatusBadge } from "@/components/StatusBadge";
import { HistogramOverlay, HistogramData } from "@/components/HistogramOverlay";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sliders, CheckCircle2, AlertTriangle } from "lucide-react";

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
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <Link href="/dashboard">
                <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 mb-2 text-muted-foreground hover:text-foreground">
                  <ArrowLeft className="h-4 w-4" />
                  <span>Quay lại Dashboard Tổng quan</span>
                </Button>
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold font-mono text-foreground">
                  {detail.feature_name}
                </h1>
                <StatusBadge status={detail.status} size="md" />
                <Badge variant="outline" className="font-mono text-xs">
                  {detail.feature_type}
                </Badge>
                <Badge
                  variant={
                    detail.importance === "high" || detail.importance === "critical"
                      ? "destructive"
                      : "secondary"
                  }
                  className="uppercase text-[10px]"
                >
                  {detail.importance} importance
                </Badge>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/30 px-5 py-3 text-right">
              <span className="text-[11px] text-muted-foreground block">
                Population Stability Index (PSI)
              </span>
              <div
                className={`text-2xl font-bold font-mono ${
                  detail.psi >= 0.2
                    ? "text-rose-600 dark:text-rose-400"
                    : detail.psi >= 0.1
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {Number(detail.psi).toFixed(4)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Histogram Overlay Component */}
      <HistogramOverlay
        featureName={detail.feature_name}
        data={detail.histogram_data || {}}
      />

      {/* Summary Stats Comparison & Statistical Tests */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Statistical Test Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sliders className="h-4 w-4 text-primary" />
              Kiểm Định Giả Thuyết Thống Kê (Hypothesis Testing)
            </CardTitle>
            <CardDescription>
              Kiểm định độ sai biệt phân phối mẫu thực tế với phân phối mẫu chuẩn
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {detail.feature_type === "numerical" ? (
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Loại kiểm định:</span>
                  <span className="font-semibold text-foreground">
                    Two-Sample Kolmogorov-Smirnov (KS) Test
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Chỉ số KS Statistic:</span>
                  <span className="font-mono font-bold text-foreground">
                    {detail.ks_statistic ?? "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Mức ý nghĩa p-value:</span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                    {detail.ks_p_value !== undefined ? detail.ks_p_value.toFixed(6) : "N/A"}
                  </span>
                </div>
                <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <strong>Kết luận:</strong>{" "}
                  {detail.ks_p_value !== undefined && detail.ks_p_value < 0.05
                    ? "p < 0.05 — Bác bỏ giả thuyết đồng nhất (H0). Tồn tại sự biến động phân phối có ý nghĩa thống kê."
                    : "p >= 0.05 — Không đủ bằng chứng bác bỏ H0. Phân phối tương đối ổn định."}
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Loại kiểm định:</span>
                  <span className="font-semibold text-foreground">
                    Chi-Square Test of Homogeneity (χ²)
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Chỉ số χ² Statistic:</span>
                  <span className="font-mono font-bold text-foreground">
                    {detail.chi2_statistic ?? "N/A"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Mức ý nghĩa p-value:</span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                    {detail.chi2_p_value !== undefined ? detail.chi2_p_value.toFixed(6) : "N/A"}
                  </span>
                </div>
                <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <strong>Kết luận:</strong>{" "}
                  {detail.chi2_p_value !== undefined && detail.chi2_p_value < 0.05
                    ? "p < 0.05 — Phân phối tần suất các nhãn danh mục có sự thay đổi rõ rệt."
                    : "p >= 0.05 — Tỷ lệ giữa các nhãn phân loại ổn định."}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Descriptive Stats Comparison Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              Đối Chiếu Thống Kê Mô Tả (Descriptive Stats)
            </CardTitle>
            <CardDescription>
              So sánh các đại lượng đo lường vị trí và phân tán giữa 2 tập dữ liệu
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.baseline_stats && detail.current_stats ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="py-2">Đại lượng</th>
                      <th className="py-2 text-right">Baseline (Chuẩn)</th>
                      <th className="py-2 text-right">Mẻ Hiện Tại (6h)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-foreground font-mono">
                    <tr>
                      <td className="py-2 font-sans text-muted-foreground">Trung bình (Mean)</td>
                      <td className="py-2 text-right">{detail.baseline_stats.mean ?? "-"}</td>
                      <td className="py-2 text-right font-semibold">{detail.current_stats.mean ?? "-"}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-sans text-muted-foreground">Độ lệch chuẩn (Std)</td>
                      <td className="py-2 text-right">{detail.baseline_stats.std ?? "-"}</td>
                      <td className="py-2 text-right font-semibold">{detail.current_stats.std ?? "-"}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-sans text-muted-foreground">Trung vị (Median)</td>
                      <td className="py-2 text-right">{detail.baseline_stats.median ?? "-"}</td>
                      <td className="py-2 text-right font-semibold">{detail.current_stats.median ?? "-"}</td>
                    </tr>
                    <tr>
                      <td className="py-2 font-sans text-muted-foreground">Tỷ lệ khuyết (Missing)</td>
                      <td className="py-2 text-right">0.0%</td>
                      <td className="py-2 text-right font-semibold">
                        {detail.current_stats.missing_pct !== undefined
                          ? `${(detail.current_stats.missing_pct * 100).toFixed(1)}%`
                          : "0.0%"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Dữ liệu thống kê mô tả chưa khả dụng cho trường hợp này.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
