export interface TelegramAlertOptions {
  runId: number;
  overallStatus: string;
  sampleCount: number;
  maxPsi: number;
  driftedFeatures: Array<{ name: string; psi: number; pValue?: number; importance: string }>;
  predictionPsi?: number;
  qualityPassed: boolean;
  dashboardUrl?: string;
  enableRetrainButton?: boolean;
}

export async function sendTelegramDriftAlert(opts: TelegramAlertOptions): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const baseUrl = opts.dashboardUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  if (!token || !chatId) {
    console.log("[Telegram] Bot token or chat ID not set. Skipping notification.");
    return false;
  }

  const isSevere = opts.overallStatus === "DRIFT_DETECTED";
  const icon = isSevere ? "🚨" : "⚠️";
  const title = isSevere ? "CRITICAL DATA DRIFT DETECTED" : "DATA DRIFT WARNING";

  let featureLines = "";
  for (const f of opts.driftedFeatures.slice(0, 5)) {
    const pValStr = f.pValue !== undefined ? ` | p=${f.pValue}` : "";
    featureLines += `• <b>${f.name}</b> (${f.importance}): PSI = <code>${f.psi.toFixed(4)}</code>${pValStr}\n`;
  }

  const predLine = opts.predictionPsi !== undefined
    ? `🎯 <b>Prediction Drift PSI:</b> <code>${opts.predictionPsi.toFixed(4)}</code>\n`
    : "";

  const qualityLine = opts.qualityPassed
    ? "✅ <b>Data Quality:</b> All checks passed\n"
    : "❌ <b>Data Quality:</b> Violations detected\n";

  const messageText = `
${icon} <b>${title}</b>
━━━━━━━━━━━━━━━━━━━━
<b>Batch Window Run ID:</b> #${opts.runId}
<b>Samples Analyzed:</b> ${opts.sampleCount.toLocaleString()}
<b>Max Feature PSI:</b> <code>${opts.maxPsi.toFixed(4)}</code>
${qualityLine}${predLine}
<b>Drifted Features:</b>
${featureLines || "• None (Quality or prediction shift triggered alert)\n"}
━━━━━━━━━━━━━━━━━━━━
<i>Near-real-time batch monitoring (6-hour interval)</i>
`.trim();

  const inlineKeyboard: any[][] = [
    [
      {
        text: "📊 Open Dashboard",
        url: `${baseUrl}/dashboard`,
      },
    ],
  ];

  if (opts.enableRetrainButton) {
    inlineKeyboard[0].unshift({
      text: "🚀 Approve Retrain",
      callback_data: `approve_retrain:${opts.runId}`,
    });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: inlineKeyboard,
        },
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[Telegram] API error:", data);
      return false;
    }
    console.log("[Telegram] Alert sent successfully for Run #", opts.runId);
    return true;
  } catch (error) {
    console.error("[Telegram] Network exception:", error);
    return false;
  }
}
