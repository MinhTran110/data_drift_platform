import { NextRequest, NextResponse } from "next/server";
import { verifyHmacSignature } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  evaluateRetrainConditions,
  generateAlertCandidates,
  recordAlert,
  shouldSendAlert,
} from "@/lib/rules";
import { sendTelegramDriftAlert } from "@/lib/telegram";
import { triggerGitHubRetrainDispatch } from "@/lib/github";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-signature-sha256");

    // 1. Verify HMAC Signature
    const isAuthentic = verifyHmacSignature(rawBody, signature);
    if (!isAuthentic) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid HMAC signature" },
        { status: 401 }
      );
    }

    const payload = JSON.parse(rawBody);

    // 2. Persist Drift Run
    let runId = Date.now();
    try {
      const runInsert = await query(
        `INSERT INTO drift_runs (
          window_start, window_end, sample_count, overall_status, max_psi,
          severe_drift_count, warning_drift_count, quality_report, prediction_drift, summary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          payload.window_start,
          payload.window_end,
          payload.sample_count,
          payload.overall_status,
          payload.max_psi,
          payload.severe_drift_count || 0,
          payload.warning_drift_count || 0,
          JSON.stringify(payload.quality_report || {}),
          JSON.stringify(payload.prediction_drift || null),
          payload.summary || null,
        ]
      );
      if (runInsert && runInsert.length > 0) {
        runId = runInsert[0].id;
      }
    } catch (dbErr) {
      console.warn("DB insert for drift_runs failed (using fallback in-memory ID):", dbErr);
    }

    // 3. Persist Feature Metrics
    if (payload.features && Array.isArray(payload.features)) {
      for (const f of payload.features) {
        try {
          await query(
            `INSERT INTO feature_metrics (
              run_id, feature_name, feature_type, importance, psi, status,
              ks_statistic, ks_p_value, chi2_statistic, chi2_p_value,
              baseline_stats, current_stats, histogram_data
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              runId,
              f.feature_name,
              f.feature_type,
              f.importance,
              f.psi,
              f.status,
              f.ks_statistic,
              f.ks_p_value,
              f.chi2_statistic,
              f.chi2_p_value,
              JSON.stringify(f.baseline_stats || {}),
              JSON.stringify(f.current_stats || {}),
              JSON.stringify(f.histogram_data || {}),
            ]
          );
        } catch (fErr) {
          // Non-blocking on single feature insert
        }
      }
    }

    // 4. Alerting & Cooldown Evaluation
    const alertCandidates = generateAlertCandidates(payload);
    let alertsDelivered = 0;
    const driftedForTelegram: Array<{ name: string; psi: number; pValue?: number; importance: string }> = [];

    for (const cand of alertCandidates) {
      const canSend = await shouldSendAlert(cand);
      if (canSend) {
        await recordAlert(runId, cand);
        alertsDelivered++;
      }
    }

    // Collect drifted features for Telegram summary
    for (const f of payload.features || []) {
      if (f.status === "DRIFT" || f.status === "WARNING") {
        driftedForTelegram.push({
          name: f.feature_name,
          psi: f.psi,
          pValue: f.ks_p_value ?? f.chi2_p_value,
          importance: f.importance,
        });
      }
    }

    // Retrain decision
    const retrainDecision = evaluateRetrainConditions(payload);

    // Send Telegram alert if any drift or warning occurred and not suppressed
    if (alertsDelivered > 0 || payload.overall_status === "DRIFT_DETECTED") {
      await sendTelegramDriftAlert({
        runId,
        overallStatus: payload.overall_status,
        sampleCount: payload.sample_count,
        maxPsi: payload.max_psi,
        driftedFeatures: driftedForTelegram,
        predictionPsi: payload.prediction_drift?.psi,
        qualityPassed: payload.quality_report?.passed ?? true,
        enableRetrainButton: retrainDecision.shouldTrigger,
      });
    }

    // 5. Automated Closed-Loop Retrain Trigger if configured for "auto_on_severe"
    let retrainDispatched = false;
    if (retrainDecision.shouldTrigger && retrainDecision.mode === "auto_on_severe") {
      const dispatch = await triggerGitHubRetrainDispatch({
        runId,
        triggeredBy: "AUTO_SEVERE",
        reason: retrainDecision.reasons.join("; "),
      });
      retrainDispatched = dispatch.success;

      try {
        await query(
          `INSERT INTO retrain_jobs (run_id, triggered_by, status, error_message)
           VALUES ($1, 'AUTO_SEVERE', $2, $3)`,
          [runId, dispatch.success ? "RUNNING" : "FAILED", dispatch.message]
        );
      } catch (err) {
        // ignore
      }
    }

    return NextResponse.json({
      success: true,
      run_id: runId,
      overall_status: payload.overall_status,
      alerts_evaluated: alertCandidates.length,
      alerts_delivered: alertsDelivered,
      retrain_decision: retrainDecision,
      retrain_dispatched: retrainDispatched,
    });
  } catch (error: any) {
    console.error("Error in /api/drift/ingest:", error);
    return NextResponse.json(
      { error: "Internal Server Error", detail: error.message },
      { status: 500 }
    );
  }
}
