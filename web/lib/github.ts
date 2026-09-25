export interface TriggerRetrainParams {
  runId?: number;
  triggeredBy: string; // 'AUTO_SEVERE', 'TELEGRAM_APPROVE', 'MANUAL_DASHBOARD'
  reason?: string;
}

export interface DispatchResult {
  success: boolean;
  message: string;
  statusCode?: number;
}

/**
 * Dispatches a repository_dispatch event to GitHub Actions to execute retrain.yml.
 */
export async function triggerGitHubRetrainDispatch(params: TriggerRetrainParams): Promise<DispatchResult> {
  const repo = process.env.GITHUB_REPO; // format: "owner/repo"
  const token = process.env.GITHUB_TOKEN;

  if (!repo || !token) {
    console.warn("[GitHub Dispatch] GITHUB_REPO or GITHUB_TOKEN not configured. Emulating dispatch locally.");
    return {
      success: true,
      message: `Emulated dispatch for ${params.triggeredBy} (GitHub credentials not set in environment)`,
    };
  }

  const url = `https://api.github.com/repos/${repo}/dispatches`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_type: "retrain_trigger",
        client_payload: {
          run_id: params.runId ?? null,
          triggered_by: params.triggeredBy,
          reason: params.reason ?? "Triggered by Data Drift Monitoring closed-loop policy",
          timestamp: new Date().toISOString(),
        },
      }),
    });

    if (res.status === 204) {
      console.log(`[GitHub Dispatch] Successfully dispatched 'retrain_trigger' event to ${repo}`);
      return {
        success: true,
        statusCode: 204,
        message: `Successfully dispatched retraining workflow to ${repo}`,
      };
    } else {
      const errText = await res.text();
      console.error(`[GitHub Dispatch] Error response ${res.status}:`, errText);
      return {
        success: false,
        statusCode: res.status,
        message: `GitHub API returned ${res.status}: ${errText}`,
      };
    }
  } catch (error: any) {
    console.error("[GitHub Dispatch] Network error:", error);
    return {
      success: false,
      message: `Failed to connect to GitHub API: ${error.message}`,
    };
  }
}
