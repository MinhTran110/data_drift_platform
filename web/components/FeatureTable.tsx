"use client";

import React, { useState } from "react";
import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Eye,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  ExternalLink,
} from "lucide-react";

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
    std?: number;
    missing_pct?: number;
  };
  baseline_stats?: {
    mean?: number;
    std?: number;
  };
}

interface FeatureTableProps {
  features: FeatureRow[];
  warnThreshold?: number;
  severeThreshold?: number;
}

export function FeatureTable({
  features,
  warnThreshold = 0.1,
  severeThreshold = 0.2,
}: FeatureTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [selectedFeature, setSelectedFeature] = useState<FeatureRow | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Compute dynamic status based on current thresholds
  const computedFeatures = (features || []).map((f) => {
    let dynamicStatus = f.status;
    if (f.psi >= severeThreshold) {
      dynamicStatus = "DRIFT";
    } else if (f.psi >= warnThreshold) {
      dynamicStatus = "WARNING";
    } else {
      dynamicStatus = "STABLE";
    }
    return {
      ...f,
      dynamicStatus,
    };
  });

  // Filter
  const filtered = computedFeatures.filter((f) => {
    const matchesSearch = f.feature_name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesStatus =
      statusFilter === "ALL" || f.dynamicStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortOrder === "desc") {
      return (b.psi || 0) - (a.psi || 0);
    }
    return (a.psi || 0) - (b.psi || 0);
  });

  // Pagination
  const totalPages = Math.ceil(sorted.length / pageSize) || 1;
  const paginatedFeatures = sorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all">
      {/* Header and Controls */}
      <div className="border-b border-border p-4 sm:flex sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-semibold text-foreground">
              Bảng Phân Tích Độ Lệch Đặc Trưng (Feature Drift Breakdown)
            </h3>
            <Badge variant="outline" className="text-[11px] font-mono">
              {filtered.length} features
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            So sánh phân phối mẻ hiện tại với baseline. Ngưỡng cảnh báo:{" "}
            <span className="font-semibold text-amber-500">{warnThreshold.toFixed(2)}</span>,
            nghiêm trọng:{" "}
            <span className="font-semibold text-rose-500">{severeThreshold.toFixed(2)}</span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5 sm:mt-0">
          {/* Search Box */}
          <div className="relative flex-1 sm:w-48">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm kiếm feature..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Radix Status Select Filter */}
          <div className="w-36">
            <Select
              value={statusFilter}
              onValueChange={(val) => {
                setStatusFilter(val);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả ({computedFeatures.length})</SelectItem>
                <SelectItem value="DRIFT">🚨 Drift Only</SelectItem>
                <SelectItem value="WARNING">⚠️ Warning</SelectItem>
                <SelectItem value="STABLE">✅ Stable</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
            className="h-9 gap-1 text-xs px-2.5 text-muted-foreground hover:text-foreground"
            title="Đổi chiều sắp xếp theo PSI"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span>PSI {sortOrder.toUpperCase()}</span>
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border text-left text-xs">
          <thead className="bg-muted/50 text-muted-foreground font-semibold">
            <tr>
              <th scope="col" className="px-4 py-3">Feature Name</th>
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Importance</th>
              <th scope="col" className="px-4 py-3">PSI Metric</th>
              <th scope="col" className="px-4 py-3">Statistical Test (p-val)</th>
              <th scope="col" className="px-4 py-3">Null Rate</th>
              <th scope="col" className="px-4 py-3">Status</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {paginatedFeatures.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Không tìm thấy feature nào khớp với bộ lọc.
                </td>
              </tr>
            ) : (
              paginatedFeatures.map((f) => {
                const psiWidth = Math.min(100, (f.psi / 0.3) * 100);
                const psiColor =
                  f.psi >= severeThreshold
                    ? "bg-rose-500"
                    : f.psi >= warnThreshold
                    ? "bg-amber-500"
                    : "bg-emerald-500";

                return (
                  <tr
                    key={f.feature_name}
                    className="hover:bg-muted/40 transition-colors group"
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <Link
                        href={`/dashboard/${f.feature_name}`}
                        className="hover:text-primary hover:underline flex items-center gap-1.5"
                      >
                        {f.feature_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                        {f.feature_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-[11px] font-medium capitalize ${
                          f.importance === "high" || f.importance === "critical"
                            ? "text-rose-600 dark:text-rose-400 font-semibold"
                            : f.importance === "medium"
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {f.importance}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="w-12 font-mono font-medium text-foreground">
                          {Number(f.psi || 0).toFixed(4)}
                        </span>
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${psiColor}`}
                            style={{ width: `${psiWidth}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      {f.feature_type === "numerical" ? (
                        <span>
                          KS: {f.ks_statistic ?? "-"} (p=
                          {f.ks_p_value !== undefined
                            ? Number(f.ks_p_value).toFixed(4)
                            : "-"}
                          )
                        </span>
                      ) : (
                        <span>
                          Chi²: {f.chi2_statistic ?? "-"} (p=
                          {f.chi2_p_value !== undefined
                            ? Number(f.chi2_p_value).toFixed(4)
                            : "-"}
                          )
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono">
                      {f.current_stats?.missing_pct !== undefined
                        ? `${(f.current_stats.missing_pct * 100).toFixed(1)}%`
                        : "0.0%"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={f.dynamicStatus} size="sm" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedFeature(f)}
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                          title="Xem nhanh thông tin đặc trưng"
                        >
                          <Eye className="h-3 w-3" />
                          <span className="hidden sm:inline">Quick</span>
                        </Button>
                        <Link
                          href={`/dashboard/${f.feature_name}`}
                          className="inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors gap-1"
                        >
                          <span>Chi tiết</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 bg-muted/20 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Hiển thị</span>
          <Select
            value={String(pageSize)}
            onValueChange={(val) => {
              setPageSize(Number(val));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
            </SelectContent>
          </Select>
          <span>trên tổng số {sorted.length} bản ghi</span>
        </div>

        <div className="flex items-center gap-2">
          <span>
            Trang {currentPage} / {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quick View Radix Dialog Modal */}
      {selectedFeature && (
        <Dialog
          open={!!selectedFeature}
          onOpenChange={(open) => !open && setSelectedFeature(null)}
        >
          <DialogContent>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle className="font-mono text-base">
                  {selectedFeature.feature_name}
                </DialogTitle>
                <StatusBadge status={selectedFeature.dynamicStatus} size="sm" />
              </div>
              <DialogDescription>
                Tổng hợp chỉ số thống kê và mức độ dịch chuyển phân phối của thuộc tính
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-muted-foreground block mb-1">Loại thuộc tính</span>
                  <span className="font-semibold text-foreground capitalize">
                    {selectedFeature.feature_type} ({selectedFeature.importance})
                  </span>
                </div>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-muted-foreground block mb-1">Chỉ số PSI</span>
                  <span className="font-mono font-bold text-foreground text-sm">
                    {Number(selectedFeature.psi || 0).toFixed(4)}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border p-3 space-y-2 text-xs">
                <h5 className="font-semibold text-foreground flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
                  Kiểm định thống kê
                </h5>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground font-mono">
                  {selectedFeature.feature_type === "numerical" ? (
                    <>
                      <div>KS-Statistic: {selectedFeature.ks_statistic ?? "N/A"}</div>
                      <div>
                        p-value:{" "}
                        {selectedFeature.ks_p_value !== undefined
                          ? Number(selectedFeature.ks_p_value).toFixed(6)
                          : "N/A"}
                      </div>
                    </>
                  ) : (
                    <>
                      <div>Chi²-Statistic: {selectedFeature.chi2_statistic ?? "N/A"}</div>
                      <div>
                        p-value:{" "}
                        {selectedFeature.chi2_p_value !== undefined
                          ? Number(selectedFeature.chi2_p_value).toFixed(6)
                          : "N/A"}
                      </div>
                    </>
                  )}
                  <div>
                    Tỷ lệ khuyết thiếu (Null):{" "}
                    {selectedFeature.current_stats?.missing_pct !== undefined
                      ? `${(selectedFeature.current_stats.missing_pct * 100).toFixed(1)}%`
                      : "0.0%"}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedFeature(null)}
                >
                  Đóng
                </Button>
                <Link href={`/dashboard/${selectedFeature.feature_name}`}>
                  <Button size="sm" className="gap-1">
                    Xem Histogram Phân Phối
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
