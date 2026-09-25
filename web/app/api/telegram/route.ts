import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { triggerGitHubRetrainDispatch } from "@/lib/github";

export async function POST(req: NextRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  try {
    const update = await req.json();

    // Check if this is a callback_query (inline button click)
    const callbackQuery = update.callback_query;
    if (!callbackQuery) {
      return NextResponse.json({ ok: true });
    }

    const callbackId = callbackQuery.id;
    const data = callbackQuery.data || "";
    const user = callbackQuery.from;
    const username = user?.username ? `@${user.username}` : user?.first_name || "Engineer";
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;

    if (data.startsWith("approve_retrain:")) {
      const runIdStr = data.replace("approve_retrain:", "");
      const runId = parseInt(runIdStr, 10);

      console.log(`[Telegram Webhook] Approval received for Run #${runId} from ${username}`);

      // 1. Dispatch GitHub Action
      const dispatchResult = await triggerGitHubRetrainDispatch({
        runId,
        triggeredBy: "TELEGRAM_APPROVE",
        reason: `Approved by ${username} via Telegram inline button`,
      });

      // 2. Persist retrain job
      try {
        await query(
          `INSERT INTO retrain_jobs (run_id, triggered_by, status, approved_by, error_message)
           VALUES ($1, 'TELEGRAM_APPROVE', $2, $3, $4)`,
          [runId, dispatchResult.success ? "RUNNING" : "FAILED", username, dispatchResult.message]
        );
      } catch (dbErr) {
        console.warn("DB insert error for telegram retrain job:", dbErr);
      }

      // 3. Acknowledge callback query to stop loading spinner on user's Telegram client
      if (token) {
        await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            callback_query_id: callbackId,
            text: dispatchResult.success ? "Retraining workflow dispatched! " : "Retraining failed to dispatch.",
            show_alert: true,
          }),
        }).catch(() => {});

        // 4. Update the message in Telegram to show confirmation
        if (chatId && messageId) {
          const updateText = `✅ <b>Model Retraining Dispatched!</b>\nApproved by: <b>${username}</b> for Run #${runId}\nWorkflow: <code>retrain.yml</code> (GitHub Actions)\nStatus: <code>RUNNING</code>`;
          await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: messageId,
              text: updateText,
              parse_mode: "HTML",
            }),
          }).catch(() => {});
        }
      }

      return NextResponse.json({ success: true, message: "Retraining dispatched" });
    }

    // Default response for other callbacks
    if (token) {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text: "Acknowledged",
        }),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("Error in /api/telegram webhook:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
