import os
import json
import psycopg2

def log_audit():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("[WARN] DATABASE_URL is not set. Skipping DB logging.")
        return

    # Đọc thông tin model vừa train & promote
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

    event_name = os.getenv("EVENT_NAME", "workflow_dispatch")

    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        query = """
            INSERT INTO retrain_jobs (
                run_id, triggered_by, status, champion_version,
                challenger_version, metrics, approved_by, created_at, updated_at
            )
            VALUES (NULL, %s, %s, %s, %s, %s, %s, NOW(), NOW());
        """
        cur.execute(query, (
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
        print("[SUCCESS] Audit record inserted into Neon DB successfully!")
    except Exception as err:
        print(f"[ERROR] Database insertion failed: {err}")

if __name__ == "__main__":
    log_audit()
