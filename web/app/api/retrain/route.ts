import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAuth } from "@/lib/auth";
import { query } from "@/lib/db";
import { triggerGitHubRetrainDispatch } from "@/lib/github";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
  // 1. Đọc metadata model champion mới nhất từ file latest.json hoặc Neon DB
  let activeChampion = null;
  try {
    const candidatePaths = [
      path.join(process.cwd(), "public", "latest.json"),
      path.join(process.cwd(), "..", "data", "models", "latest.json"),
      path.join(process.cwd(), "data", "models", "latest.json"),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, "utf-8");
        activeChampion = JSON.parse(content);
        break;
      }
    }
  } catch (err) {
    console.warn("Could not read latest.json from disk:", err);
  }

  // Fallback: If not found on local disk (e.g. Vercel serverless), query Neon DB
  if (!activeChampion) {
    try {
      const dbChamp = await query(
        `SELECT challenger_version, metrics, updated_at, created_at 
         FROM retrain_jobs 
         WHERE status = 'COMPLETED' 
         ORDER BY id DESC LIMIT 1`
      );
      if (dbChamp && dbChamp.length > 0) {
        const row = dbChamp[0];
        const parsedMetrics = typeof row.metrics === "string" ? JSON.parse(row.metrics) : (row.metrics || {});
        activeChampion = {
          version: row.challenger_version || "v12",
          promoted_at: row.updated_at || row.created_at,
          metrics: parsedMetrics,
        };
      }
    } catch (dbErr) {
      console.warn("Could not fetch active champion from retrain_jobs:", dbErr);
    }
  }

  // 2. Lấy danh sách retrain jobs từ database
  try {
    const jobs = await query(
      `SELECT * FROM retrain_jobs ORDER BY created_at DESC LIMIT 50`
    );
    return NextResponse.json({ champion: activeChampion, jobs });
  } catch (error: any) {
    // If table doesn't exist yet in local development, return mock
    return NextResponse.json({
      champion: activeChampion,
      jobs: [
        {
          id: 1,
          run_id: 101,
          triggered_by: "AUTO_SEVERE",
          status: "COMPLETED",
          champion_version: "v1",
          challenger_version: "v2",
          metrics: { champion_auc: 0.842, challenger_auc: 0.865, delta_auc: 0.023 },
          created_at: new Date(Date.now() - 86400000).toISOString(),
          updated_at: new Date(Date.now() - 85000000).toISOString(),
        },
      ],
    });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAdminAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const runId = body.run_id ? parseInt(body.run_id, 10) : undefined;
    const triggeredBy = body.triggered_by || "MANUAL_DASHBOARD";
    const approvedBy = body.approved_by || "engineer";
    const reason = body.reason || "Manual retraining triggered from web dashboard";

    // 1. Dispatch GitHub Action
    const dispatch = await triggerGitHubRetrainDispatch({
      runId,
      triggeredBy,
      reason,
    });

    // 2. Persist job in database
    let jobId = Date.now();
    try {
      const res = await query(
        `INSERT INTO retrain_jobs (run_id, triggered_by, status, approved_by, error_message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [runId || null, triggeredBy, dispatch.success ? "PENDING" : "FAILED", approvedBy, dispatch.message]
      );
      if (res && res.length > 0) {
        jobId = res[0].id;
      }
    } catch (dbErr) {
      console.warn("Could not insert retrain_job into database:", dbErr);
    }

    return NextResponse.json({
      success: dispatch.success,
      job_id: jobId,
      message: dispatch.message,
      status: dispatch.success ? "PENDING" : "FAILED",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
