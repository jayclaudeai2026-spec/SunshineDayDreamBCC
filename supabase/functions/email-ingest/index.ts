import { createServiceRoleClient } from "./_shared/supabase.ts";
import { ComposioClient } from "./_shared/composio.ts";
import { processMessage } from "./process_message.ts";
import { pollAndProcess } from "./poll.ts";

interface RequestBody {
  message_id?: string;
  mode?: "poll" | "single";
  lookback_days?: number;
  send_receipts?: boolean;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed; use POST" });
  }

  const expectedSecret = Deno.env.get("EMAIL_INGEST_WEBHOOK_SECRET");
  if (expectedSecret) {
    const auth = req.headers.get("authorization") ??
      req.headers.get("Authorization") ??
      "";
    const provided = auth.replace(/^Bearer\s+/i, "").trim();
    if (provided !== expectedSecret) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
  }

  const composioKey = Deno.env.get("COMPOSIO_API_KEY");
  if (!composioKey) {
    return jsonResponse(500, {
      error: "Server misconfigured: missing COMPOSIO_API_KEY",
    });
  }

  const composioUserId = Deno.env.get("COMPOSIO_USER_ID") ?? "default";

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const envSendReceipts = (Deno.env.get("EMAIL_INGEST_SEND_RECEIPTS") ?? "").toLowerCase() === "true";
  const sendReceipts = body.send_receipts === true ? true : (body.send_receipts === false ? false : envSendReceipts);

  const sb = createServiceRoleClient();
  const composio = new ComposioClient({ apiKey: composioKey, userId: composioUserId });

  try {
    if (body.mode === "poll") {
      const out = await pollAndProcess({ sb, composio, lookbackDays: body.lookback_days, sendReceipts });
      return jsonResponse(200, { mode: "poll", send_receipts: sendReceipts, ...out });
    }

    if (body.message_id) {
      const out = await processMessage({
        sb,
        composio,
        message_id: body.message_id,
        sendReceipts,
      });
      return jsonResponse(200, { mode: "single", send_receipts: sendReceipts, ...out });
    }

    return jsonResponse(400, {
      error:
        'Provide either { "message_id": "..." } or { "mode": "poll" } in the JSON body.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("email-ingest fatal:", msg);
    return jsonResponse(500, { error: msg.slice(0, 1000) });
  }
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
