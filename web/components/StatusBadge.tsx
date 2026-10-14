import React from "react";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const normStatus = (status || "").toUpperCase();

  let bgClass = "bg-secondary text-secondary-foreground border-border";
  let dotClass = "bg-muted-foreground";
  let label = normStatus;

  if (normStatus === "STABLE") {
    bgClass = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60";
    dotClass = "bg-emerald-500";
    label = "Stable";
  } else if (normStatus === "WARNING") {
    bgClass = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60";
    dotClass = "bg-amber-500";
    label = "Warning";
  } else if (normStatus === "DRIFT" || normStatus === "DRIFT_DETECTED") {
    bgClass = "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60";
    dotClass = "bg-rose-500 animate-pulse";
    label = "Drift Detected";
  } else if (normStatus === "INSUFFICIENT_DATA") {
    bgClass = "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    dotClass = "bg-slate-400";
    label = "Low Data";
  }

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[11px]",
    md: "px-2.5 py-1 text-xs font-medium",
    lg: "px-3 py-1.5 text-sm font-semibold",
  }[size];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border shadow-sm transition-colors",
        bgClass,
        sizeClasses,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
      {label}
    </span>
  );
}
