import { query } from "./db";
import crypto from "crypto";

export interface AlertCandidate {
  feature_name: string;
  alert_type: "FEATURE_DRIFT" | "PREDICTION_DRIFT" | "QUALITY_VIOLATION";
  severity: "WARNING" | "CRITICAL";
  message: string;
  dedup_key: string;
  cooldown_hours: number;
}

export interface RetrainDecision {
  shouldTrigger: boolean;
  mode: "manual" | "threshold_approval" | "auto_on_severe";
  reasons: string[];
}

/**
 * Evaluates whether an alert should be suppressed due to active cooldown or deduplication.
 */
export async function shouldSendAlert(candidate: AlertCandidate): Promise<boolean> {
  try {
    const existing = await query(
      `SELECT id, cooldown_until FROM alerts 
       WHERE dedup_key = $1 AND cooldown_until > NOW() 
       ORDER BY id DESC LIMIT 1`,
      [candidate.dedup_key]
    );

    if (existing && existing.length > 0) {
      console.log(`[Alert Suppressed] Cooldown active until ${existing[0].cooldown_until} for key ${candidate.dedup_key}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Could not check alert cooldown in DB:", err);
    // On DB failure, allow alert to ensure critical signals aren't lost
    return true;
  }
}

/**
 * Records alert in the database with cooldown window.
 */
export async function recordAlert(runId: number, candidate: AlertCandidate): Promise<void> {
  try {
    const cooldownUntil = new Date(Date.now() + candidate.cooldown_hours * 60 * 60 * 1000).toISOString();
    await query(
      `INSERT INTO alerts (run_id, feature_name, alert_type, severity, message, dedup_key, cooldown_until, delivered)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
      [
        runId,
        candidate.feature_name,
        candidate.alert_type,
        candidate.severity,
        candidate.message,
        candidate.dedup_key,
        cooldownUntil,
      ]
    );
  } catch (err) {
    console.error("Failed to record alert in DB:", err);
  }
}

/**
 * Generates alert candidates from drift run payload.
 */
export function generateAlertCandidates(payload: any): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const cooldownHours = 12;

  // 1. Feature Drift Alerts
  for (const f of payload.features || []) {
    if (f.status === "DRIFT") {
      const dedup = crypto
        .createHash("sha256")
        .update(`${f.feature_name}:DRIFT:${new Date().toISOString().slice(0, 10)}`)
        .digest("hex")
        .slice(0, 32);

      candidates.append?.({
        feature_name: f.feature_name,
        alert_type: "FEATURE_DRIFT",
        severity: "CRITICAL",
        message: `🚨 Critical Drift in *${f.feature_name}* (PSI: ${f.psi.toFixed(4)}, KS p-val: ${f.ks_p_value ?? "N/A"})`,
        dedup_key: dedup,
        cooldown_hours: cooldownHours,
      }) || candidates.push({
        feature_name: f.feature_name,
        alert_type: "FEATURE_DRIFT",
        severity: "CRITICAL",
        message: `🚨 Critical Drift in *${f.feature_name}* (PSI: ${f.psi.toFixed(4)}, KS p-val: ${f.ks_p_value ?? "N/A"})`,
        dedup_key: dedup,
        cooldown_hours: cooldownHours,
      });
    } else if (f.status === "WARNING") {
      const dedup = crypto
        .createHash("sha256")
        .update(`${f.feature_name}:WARNING:${new Date().toISOString().slice(0, 10)}`)
        .digest("hex")
        .slice(0, 32);

      candidates.push({
        feature_name: f.feature_name,
        alert_type: "FEATURE_DRIFT",
        severity: "WARNING",
        message: `⚠️ Moderate Drift in *${f.feature_name}* (PSI: ${f.psi.toFixed(4)})`,
        dedup_key: dedup,
        cooldown_hours: cooldownHours,
      });
    }
  }

  // 2. Prediction Drift Alerts
  if (payload.prediction_drift && payload.prediction_drift.status === "DRIFT") {
    const dedup = crypto
      .createHash("sha256")
      .update(`prediction_score:DRIFT:${new Date().toISOString().slice(0, 10)}`)
      .digest("hex")
      .slice(0, 32);

    candidates.push({
      feature_name: "prediction_score",
      alert_type: "PREDICTION_DRIFT",
      severity: "CRITICAL",
      message: `🎯 Significant Prediction Drift: Output probability distribution shifted (PSI: ${payload.prediction_drift.psi.toFixed(4)})`,
      dedup_key: dedup,
      cooldown_hours: cooldownHours,
    });
  }

  // 3. Quality Violations
  const quality = payload.quality_report;
  if (quality && quality.critical_violations) {
    for (const cv of quality.critical_violations) {
      const dedup = crypto
        .createHash("sha256")
        .update(`${cv.feature || "dataset"}:QUALITY:${cv.check}`)
        .digest("hex")
        .slice(0, 32);

      candidates.push({
        feature_name: cv.feature || "dataset",
        alert_type: "QUALITY_VIOLATION",
        severity: "CRITICAL",
        message: `❌ Data Quality Violation: ${cv.message}`,
        dedup_key: dedup,
        cooldown_hours: 6,
      });
    }
  }

  return candidates;
}

/**
 * Checks policy rules to decide if retraining should be triggered.
 */
export function evaluateRetrainConditions(payload: any, rulesConfig?: any): RetrainDecision {
  const severeDriftFeatures = (payload.features || []).filter((f: any) => f.status === "DRIFT");
  const severeCount = severeDriftFeatures.length;
  const isPredDrift = payload.prediction_drift?.status === "DRIFT";

  const reasons: string[] = [];

  if (severeCount >= 2) {
    reasons.push(`${severeCount} features have severe drift (PSI >= 0.20): ${severeDriftFeatures.map((f: any) => f.feature_name).join(", ")}`);
  }

  if (isPredDrift) {
    reasons.push(`Model prediction score distribution has severe drift (PSI: ${payload.prediction_drift.psi.toFixed(4)})`);
  }

  const highImportanceSevere = severeDriftFeatures.find((f: any) => f.importance === "high" && f.psi >= 0.25);
  if (highImportanceSevere) {
    reasons.push(`High-importance feature *${highImportanceSevere.feature_name}* drifted severely (PSI: ${highImportanceSevere.psi.toFixed(4)})`);
  }

  const shouldTrigger = reasons.length > 0;
  const mode = rulesConfig?.retraining?.mode || "threshold_approval";

  return {
    shouldTrigger,
    mode,
    reasons,
  };
}
