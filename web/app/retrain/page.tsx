"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Rocket,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  History,
  Layers,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

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

interface ChampionMetadata {
  version: string;
  metrics?: {
    roc_auc?: number;
    pr_auc?: number;
    f1_score?: number;
    log_loss?: number;
    latency_ms?: number;
  };
  promoted_at?: string;
}

export default function RetrainPage() {
  const [jobs, setJobs] = useState<RetrainJobItem[]>([]);
  const [champion, setChampion] = useState<ChampionMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/retrain");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);
        if (data.champion) {
          setChampion(data.champion);
        }
      }
    } catch (e) {
      console.error("Failed to load retrain jobs:", e);
    }
  };

  const handleTriggerRetrain = async () => {
    setConfirmOpen(false);
    setLoading(true);

    const promise = (async () => {
      const res = await fetch("/api/retrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggered_by: "MANUAL_DASHBOARD",
          reason: "Manual trigger from Web Governance Center",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || "Retrain request failed");
      }
      fetchJobs();
      return data;
    })();

    toast.promise(promise, {
      loading: "Đang gửi tín hiệu kích hoạt quy trình lên GitHub Actions...",
      success: (data) =>
        `Đã kích hoạt Retrain Job #${data.job_id}! GitHub Actions đang xử lý huấn luyện Challenger.`,
      error: (err) => `Kích hoạt thất bại: ${err.message}`,
    });

    try {
      await promise;
    } catch {
      // handled by toast
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  Model Retraining &amp; Governance Center
                </h1>
                <Badge variant="info">Closed-Loop Automation</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Đánh giá ngoại tuyến mô hình Champion vs Challenger, điều phối workflow GitHub Actions,
                và hot-reload không downtime.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={loading}
                className="gap-2 shadow-sm font-semibold"
              >
                <Rocket className="h-4 w-4" />
                <span>{loading ? "Đang gửi tín hiệu..." : "Kích Hoạt Retrain Model"}</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model Governance Status Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Active Champion Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Active Champion
              </span>
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="flex items-baseline gap-3 pt-1">
              <span className="text-3xl font-extrabold text-foreground font-mono">
                {champion?.version || jobs[0]?.challenger_version || "v12"}
              </span>
              <Badge variant="stable">In Production</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Kiến trúc mô hình:</span>
              <span className="font-mono font-medium text-foreground">HistGradientBoosting</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Validation ROC-AUC:</span>
              <span className="font-mono font-bold text-foreground">
                {champion?.metrics?.roc_auc !== undefined
                  ? champion.metrics.roc_auc.toFixed(4)
                  : jobs[0]?.metrics?.roc_auc !== undefined
                  ? Number(jobs[0].metrics.roc_auc).toFixed(4)
                  : jobs[0]?.metrics?.challenger_auc !== undefined
                  ? Number(jobs[0].metrics.challenger_auc).toFixed(4)
                  : "0.9423"}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Validation F1-Score:</span>
              <span className="font-mono font-medium text-foreground">
                {champion?.metrics?.f1_score !== undefined
                  ? champion.metrics.f1_score.toFixed(4)
                  : jobs[0]?.metrics?.f1_score !== undefined
                  ? Number(jobs[0].metrics.f1_score).toFixed(4)
                  : "0.8268"}
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Cơ chế tải mô hình:</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                Atomic Zero-Downtime Hot Reload
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Retraining Gate Policy */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Promotion Gate Criteria
              </span>
              <CheckCircle2 className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-sm font-semibold pt-1">
              Tiêu Chuẩn Thăng Hạng Tự Động
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong className="text-foreground">ROC-AUC Delta:</strong> Challenger phải đạt Δ ≥ +0.005 so với Champion.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong className="text-foreground">Giới hạn suy giảm:</strong> Từ chối nếu ROC-AUC giảm quá 1.0%.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500 font-bold">✓</span>
              <span>
                <strong className="text-foreground">Làm mới Baseline:</strong> Tự động cập nhật <code>bins.json</code> và mẫu tham chiếu khi promote.
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Trigger Channels */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Kênh Kích Hoạt &amp; Phê Duyệt
              </span>
              <Layers className="h-4 w-4 text-purple-500" />
            </div>
            <CardTitle className="text-sm font-semibold pt-1">
              Đa Kênh Quản Trị MLOps
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs">
            <div className="rounded-lg border border-border bg-muted/30 p-2.5">
              <div className="font-semibold text-foreground">1. Phê duyệt 1-Click qua Telegram</div>
              <div className="text-muted-foreground text-[11px] mt-0.5">
                Kỹ sư nhận cảnh báo kèm nút bấm inline <code>[Approve Retrain]</code>.
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-2.5">
              <div className="font-semibold text-foreground">2. Kích hoạt tự động khi Drift nghiêm trọng</div>
              <div className="text-muted-foreground text-[11px] mt-0.5">
                Tự động gửi GitHub Actions khi ≥2 đặc trưng quan trọng vượt ngưỡng 0.20.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Retraining Jobs History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground">
                Nhật Ký &amp; Lịch Sử Huấn Luyện (Audit Trail)
              </CardTitle>
              <CardDescription>
                Toàn bộ lịch sử các phiên đánh giá Champion vs Challenger
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {jobs.length} Jobs
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground font-semibold">
                <tr>
                  <th className="px-4 py-3">Job ID</th>
                  <th className="px-4 py-3">Nguồn kích hoạt</th>
                  <th className="px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3">Phiên bản Đối sánh</th>
                  <th className="px-4 py-3">Độ lệch Đánh giá (Δ AUC)</th>
                  <th className="px-4 py-3">Người phê duyệt</th>
                  <th className="px-4 py-3">Thời gian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                      Chưa có phiên huấn luyện lại nào được ghi nhận.
                    </td>
                  </tr>
                ) : (
                  jobs.map((job) => (
                    <tr key={job.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-foreground">
                        #{job.id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                          {job.triggered_by}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            job.status === "COMPLETED"
                              ? "stable"
                              : job.status === "RUNNING"
                              ? "info"
                              : job.status === "PENDING"
                              ? "warning"
                              : "destructive"
                          }
                          className="font-mono"
                        >
                          {job.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">
                        {job.champion_version || "-"} → {job.challenger_version || "-"}
                      </td>
                      <td className="px-4 py-3 font-mono">
                        {job.metrics?.delta_auc !== undefined ? (
                          <span
                            className={
                              job.metrics.delta_auc >= 0
                                ? "text-emerald-600 dark:text-emerald-400 font-bold"
                                : "text-rose-600 dark:text-rose-400"
                            }
                          >
                            Δ AUC: {job.metrics.delta_auc >= 0 ? "+" : ""}
                            {job.metrics.delta_auc.toFixed(4)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Chờ đánh giá</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {job.approved_by || "System Auto"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono">
                        {new Date(job.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Radix Dialog Modal */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2 text-amber-500">
              <AlertTriangle className="h-5 w-5" />
              <DialogTitle className="text-base font-bold text-foreground">
                Xác Nhận Kích Hoạt Huấn Luyện Lại (Model Retraining)
              </DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-xs leading-relaxed">
              Bạn đang chuẩn bị phát tín hiệu <code>repository_dispatch</code> tới GitHub Actions để khởi động quy trình huấn luyện lại mô hình máy học:
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <span>Gộp dữ liệu sản xuất mới nhất trong cửa sổ giám sát</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <span>Huấn luyện mô hình Challenger bằng HistGradientBoosting</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <span>Thẩm định chất lượng trước cổng Promotion Gate (Δ ROC-AUC)</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              <span>Hot-reload mô hình Champion mới tức thì không gián đoạn</span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmOpen(false)}
            >
              Hủy bỏ
            </Button>
            <Button
              size="sm"
              className="gap-2"
              onClick={handleTriggerRetrain}
            >
              <Rocket className="h-3.5 w-3.5" />
              <span>Xác Nhận &amp; Kích Hoạt</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
