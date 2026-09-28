import os
import json
import psycopg2

def log_audit():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("[WARN] DATABASE_URL is not set. Skipping DB logging.")
        return

    latest_path = "data/models/latest.json"
    m = {}
    if os.path.exists(latest_path):
        try:
            with open(latest_path, "r") as f:
                m = json.load(f)
        except Exception as e:
            print(f"[WARN] Failed to read {latest_path}: {e}")

    metrics = m.get("metrics", {})
    verdict = m.get("evaluation_verdict", "UNKNOWN")
    status = "COMPLETED" if verdict == "APPROVED" else "REJECTED"

    approver = "System (Closed-Loop)"
    if os.getenv("FORCE_APPLIED") == "true":
        approver = "Manual Override (Force)"

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        # 1. Tìm xem có job nào gần nhất đang ở trạng thái PENDING không
        cur.execute("""
            SELECT id FROM retrain_jobs 
            WHERE status = 'PENDING' 
            ORDER BY created_at DESC 
            LIMIT 1;
        """)
        pending_job = cur.fetchone()

        if pending_job:
            job_id = pending_job[0]
            print(f"[INFO] Found pending job #{job_id}. Updating to {status}...")
            cur.execute("""
                UPDATE retrain_jobs
                SET status = %s,
                    champion_version = %s,
                    challenger_version = %s,
                    metrics = %s,
                    approved_by = %s,
                    updated_at = NOW()
                WHERE id = %s;
            """, (
                status,
                m.get("previous_version", "v1"),
                m.get("version", "v2"),
                json.dumps(metrics),
                approver,
                job_id
            ))
        else:
            # 2. Nếu không có job PENDING nào thì INSERT mới
            print(f"[INFO] No pending job found. Inserting new record...")
            event_name = os.getenv("EVENT_NAME", "workflow_dispatch")
            cur.execute("""
                INSERT INTO retrain_jobs (
                    run_id, triggered_by, status, champion_version,
                    challenger_version, metrics, approved_by, created_at, updated_at
                )
                VALUES (NULL, %s, %s, %s, %s, %s, %s, NOW(), NOW());
            """, (
                event_name,
                status,
                m.get("previous_version", "v1"),
                m.get("version", "v2"),
                json.dumps(metrics),
                approver
            ))

        conn.commit()
        cur.close()
        conn.close()
        print("[SUCCESS] Audit record synced with Neon DB successfully!")
    except Exception as err:
        print(f"[ERROR] Database sync failed: {err}")

if __name__ == "__main__":
    log_audit()
