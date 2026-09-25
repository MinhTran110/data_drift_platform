import { Pool } from "pg";

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString =
      process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/drift_platform";

    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === "production" && !connectionString.includes("localhost") ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected database pool error:", err);
    });
  }
  return pool;
}

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const db = getDbPool();
  try {
    const res = await db.query(text, params);
    return res.rows as T[];
  } catch (error) {
    console.error(`Database query failed [${text}]:`, error);
    throw error;
  }
}

export interface DriftRun {
  id: number;
  created_at: string;
  window_start: string;
  window_end: string;
  sample_count: number;
  overall_status: "STABLE" | "WARNING" | "DRIFT_DETECTED" | "INSUFFICIENT_DATA";
  max_psi: number;
  severe_drift_count: number;
  warning_drift_count: number;
  quality_report: any;
  prediction_drift: any;
  summary: string | null;
}

export interface FeatureMetric {
  id: number;
  run_id: number;
  feature_name: string;
  feature_type: "numerical" | "categorical";
  importance: "high" | "medium" | "low" | "critical";
  psi: number;
  status: "STABLE" | "WARNING" | "DRIFT";
  ks_statistic?: number;
  ks_p_value?: number;
  chi2_statistic?: number;
  chi2_p_value?: number;
  baseline_stats: any;
  current_stats: any;
  histogram_data: any;
  created_at: string;
}

export interface RetrainJob {
  id: number;
  run_id?: number;
  triggered_by: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "REJECTED";
  champion_version?: string;
  challenger_version?: string;
  metrics?: any;
  approved_by?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}
