// gl-bulk-insert: receives JSON array of GL rows, bulk-inserts to gl_entries_archive.
// Auth: shared secret in PARSER_WEBHOOK_SECRET (same secret pipeline as parser).
// Body: { "rows": [ { entity_id, transaction_date, period, granularity, account_name, account_type, description, memo, reference, debit, credit, vendor_customer, source_file_path }, ... ] }
// Returns: { inserted: N, error?: "..." }
//
// 2026-06-18: deployed as one-off helper for the historical-GL backfill.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const expected = Deno.env.get("PARSER_WEBHOOK_SECRET") ?? Deno.env.get("EMAIL_INGEST_WEBHOOK_SECRET");
  if (expected) {
    const auth = req.headers.get("authorization") ?? "";
    const provided = auth.replace(/^Bearer\s+/i, "").trim();
    if (provided !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    return new Response(JSON.stringify({ error: "server misconfigured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  let body: { rows?: unknown[] } = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } }); }
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) {
    return new Response(JSON.stringify({ inserted: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (rows.length > 5000) {
    return new Response(JSON.stringify({ error: "max 5000 rows per call" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { error } = await sb.from("gl_entries_archive").insert(rows as never[]);
  if (error) {
    return new Response(JSON.stringify({ error: error.message, details: error.details, hint: error.hint }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ inserted: rows.length }), { status: 200, headers: { "Content-Type": "application/json" } });
});
