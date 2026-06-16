// HTTP entry point for the parser Edge Function.
//
// Three modes:
//
//   1. Single ingest (production-path):
//      POST / with body { "ingest_id": 123 }
//      Fetches the ingest_log row, walks drive_file_ids, downloads each CSV
//      via fetchCsvText(), parses, writes to financial tables.
//
//   2. Poll (production-path; pg_cron-driven, picks up pending ingest_log rows):
//      POST / with body { "mode": "poll" }
//      Sweeps `ingest_log WHERE parse_result='pending' AND entity_id IS NOT NULL`,
//      runs single-ingest pipeline on each. Wired to pg_cron once Drive
//      download is live.
//
//   3. Direct CSV (TEST MODE - works in v1):
//      POST / with body {
//        "mode": "test",
//        "entity_id": 1,
//        "csv_text": "Account,Jan 2026,Feb 2026,...",
//        "reporting_period": "2026-05-01",  // optional, for single-period reports
//        "source_file_name": "test.csv"     // optional, audit only
//      }
//      Bypasses Drive entirely. Used to validate parser logic against sample
//      CSVs before Step 2 smokes green.
//
// Auth: same shared-secret pattern as email-ingest.

import { createServiceRoleClient } from "../_shared/supabase.ts";
import { ComposioClient } from "../_shared/composio.ts";
import { processIngest } from "./process_ingest.ts";
import { processSingleCsv } from "./process_ingest.ts";

interface RequestBody {
  mode?: "poll" | "single" | "test";
  ingest_id?: number;
  // test-mode fields
  entity_id?: number;
  csv_text?: string;
  reporting_period?: string;
  source_file_name?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed; use POST" });
  }

  const expectedSecret = Deno.env.get("PARSER_WEBHOOK_SECRET") ??
    Deno.env.get("EMAIL_INGEST_WEBHOOK_SECRET");
  if (expectedSecret) {
    const auth = req.headers.get("authorization") ??
      req.headers.get("Authorization") ?? "";
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

  let body: RequestBody;
  try { body = await req.json(); } catch { body = {}; }

  const sb = createServiceRoleClient();
  const composio = new ComposioClient({ apiKey: composioKey });

  try {
    if (body.mode === "test") {
      if (!body.entity_id || !body.csv_text) {
        return jsonResponse(400, {
          error: 'test mode requires { entity_id, csv_text }',
        });
      }
      const out = await processSingleCsv({
        sb,
        csvText: body.csv_text,
        entity_id: body.entity_id,
        ingest_id: null,
        fallbackPeriod: body.reporting_period ?? null,
        source_file_path: body.source_file_name ?? "test",
      });
      return jsonResponse(200, { mode: "test", ...out });
    }

    if (body.mode === "poll") {
      const out = await pollPending({ sb, composio });
      return jsonResponse(200, { mode: "poll", ...out });
    }

    if (body.ingest_id) {
      const out = await processIngest({ sb, composio, ingest_id: body.ingest_id });
      return jsonResponse(200, { mode: "single", ...out });
    }

    return jsonResponse(400, {
      error:
        'Provide { "ingest_id": N } OR { "mode": "poll" } OR { "mode": "test", "entity_id": N, "csv_text": "..." }',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("parser fatal:", msg);
    return jsonResponse(500, { error: msg.slice(0, 1000) });
  }
});

// ----------------------------------------------------------------------------
// Poll mode: find pending ingest_log rows with entity_id set, process each.
// ----------------------------------------------------------------------------

async function pollPending(args: {
  sb: ReturnType<typeof createServiceRoleClient>;
  composio: ComposioClient;
}) {
  const { sb, composio } = args;
  const POLL_MAX = 20;

  const { data: pending, error } = await sb
    .from("ingest_log")
    .select("id")
    .eq("parse_result", "pending")
    .not("entity_id", "is", null)
    .order("received_at", { ascending: true })
    .limit(POLL_MAX);
  if (error) throw new Error(`pending sweep failed: ${error.message}`);

  const results = [];
  for (const row of pending ?? []) {
    try {
      const r = await processIngest({ sb, composio, ingest_id: row.id as number });
      results.push(r);
    } catch (err) {
      results.push({
        ingest_id: row.id,
        parse_result: "failed" as const,
        row_counts: {},
        per_file: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { processed: results.length, results };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
