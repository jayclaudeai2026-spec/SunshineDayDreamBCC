// HTTP entry point for the email-ingest Edge Function.
//
// Two modes:
//
//   1. Single (webhook path):
//      POST / with body { "message_id": "..." }
//      Wired to Composio Gmail Trigger at install Phase 6. Trigger pushes the
//      new message ID; this function fetches, archives, identifies, logs, and
//      sends the receipt.
//
//   2. Poll (backstop path):
//      POST / with body { "mode": "poll" }
//      Wired to pg_cron at install Phase 6 (suggested cadence: every 10 min).
//      Catches anything the trigger missed. Idempotent against the webhook
//      path via gmail_message_id dedupe.
//
// Auth:
//   If EMAIL_INGEST_WEBHOOK_SECRET is set, all requests must present it as
//   `Authorization: Bearer <secret>`. Deploy with `--no-verify-jwt` since the
//   Composio Trigger will not have a Supabase JWT.

import { createServiceRoleClient } from "../_shared/supabase.ts";
import { ComposioClient } from "../_shared/composio.ts";
import { processMessage } from "./process_message.ts";
import { pollAndProcess } from "./poll.ts";

interface RequestBody {
  message_id?: string;
  mode?: "poll" | "single";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed; use POST" });
  }

  // Auth check (only if secret configured)
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

  // Env
  const composioKey = Deno.env.get("COMPOSIO_API_KEY");
  if (!composioKey) {
    return jsonResponse(500, {
      error: "Server misconfigured: missing COMPOSIO_API_KEY",
    });
  }

  // Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const sb = createServiceRoleClient();
  const composio = new ComposioClient({ apiKey: composioKey });

  try {
    if (body.mode === "poll") {
      const out = await pollAndProcess({ sb, composio });
      return jsonResponse(200, { mode: "poll", ...out });
    }

    if (body.message_id) {
      const out = await processMessage({
        sb,
        composio,
        message_id: body.message_id,
      });
      return jsonResponse(200, { mode: "single", ...out });
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
