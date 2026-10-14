"use client";

import React from "react";
import { Slider } from "@/components/ui/slider";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sliders, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThresholdSliderProps {
  warnThreshold: number;
  severeThreshold: number;
  onChange: (warn: number, severe: number) => void;
  onReset: () => void;
}

export function ThresholdSlider({
  warnThreshold,
  severeThreshold,
  onChange,
  onReset,
}: ThresholdSliderProps) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Bộ Điều Chỉnh Ngưỡng Drift Tương Tác (Real-time PSI Thresholds)
              </h4>
              <p className="text-[11px] text-muted-foreground">
                Kéo thanh trượt để thử nghiệm độ nhạy cảnh báo trực tiếp trên toàn bộ bảng đặc trưng
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="warning" className="font-mono text-[11px]">
              Warning: {warnThreshold.toFixed(2)}
            </Badge>
            <Badge variant="severe" className="font-mono text-[11px]">
              Severe: {severeThreshold.toFixed(2)}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              className="h-7 text-[11px] gap-1 px-2 text-muted-foreground hover:text-foreground"
              title="Đặt lại về ngưỡng chuẩn 0.10 và 0.20"
            >
              <RotateCcw className="h-3 w-3" />
              Reset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Warning Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-amber-600 dark:text-amber-400">
                1. Ngưỡng Cảnh Báo (Warning Threshold)
              </span>
              <span className="font-mono font-semibold text-foreground">
                {warnThreshold.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[warnThreshold]}
              min={0.02}
              max={0.18}
              step={0.01}
              onValueChange={(vals) => {
                const val = vals[0];
                if (val < severeThreshold) {
                  onChange(val, severeThreshold);
                }
              }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.02 (Rất nhạy)</span>
              <span>0.10 (Chuẩn Basel)</span>
              <span>0.18 (Dung sai cao)</span>
            </div>
          </div>

          {/* Severe Slider */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="font-medium text-rose-600 dark:text-rose-400">
                2. Ngưỡng Nghiêm Trọng / Alert Retrain
              </span>
              <span className="font-mono font-semibold text-foreground">
                {severeThreshold.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[severeThreshold]}
              min={0.12}
              max={0.35}
              step={0.01}
              onValueChange={(vals) => {
                const val = vals[0];
                if (val > warnThreshold) {
                  onChange(warnThreshold, val);
                }
              }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0.12 (Khắt khe)</span>
              <span>0.20 (Chuẩn Basel)</span>
              <span>0.35 (Cho phép lệch lớn)</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
