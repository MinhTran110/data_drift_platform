import React from "react";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md" | "lg";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const normStatus = (status || "").toUpperCase();

  let bgClass = "bg-slate-100 text-slate-700 border-slate-300";
  let dotClass = "bg-slate-400";
  let label = normStatus;

  if (normStatus === "STABLE") {
    bgClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
    dotClass = "bg-emerald-500";
    label = "Stable";
  } else if (normStatus === "WARNING") {
    bgClass = "bg-amber-50 text-amber-700 border-amber-200";
    dotClass = "bg-amber-500";
    label = "Warning";
  } else if (normStatus === "DRIFT" || normStatus === "DRIFT_DETECTED") {
    bgClass = "bg-rose-50 text-rose-700 border-rose-200";
    dotClass = "bg-rose-500 animate-pulse";
    label = "Drift Detected";
  } else if (normStatus === "INSUFFICIENT_DATA") {
    bgClass = "bg-gray-100 text-gray-600 border-gray-200";
    dotClass = "bg-gray-400";
    label = "Low Data";
  }

  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-2.5 py-1 text-xs font-medium",
    lg: "px-3 py-1.5 text-sm font-semibold",
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border shadow-sm ${bgClass} ${sizeClasses}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}
