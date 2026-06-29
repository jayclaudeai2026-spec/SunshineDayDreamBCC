// heartland-inventory-pull v2
// Chunked daily snapshot of Heartland /api/inventory/values.
// Self-orchestrating: pulls a bounded page-budget per invocation, then enqueues a continuation
// via pg_net (RPC: enqueue_heartland_inventory_continuation) until total_pages is reached.
// State lives in heartland_inventory_pull_state (one row per snapshot_date).
//
// Body params (all optional):
//   snapshot_date: YYYY-MM-DD     (default: yesterday CT)
//   dry_run: boolean              (no writes, no state mutation)
//   max_pages_per_chunk: number   (default 12)
//   max_seconds: number           (default 90)
//   force_restart: boolean        (wipe state row + re-init; use only for manual recovery)
//
// Skip rules:
//   - is_channel=true mapping rows (channels like Online Sales have no physical inventory)
//   - vendor 100511 (Wild Berry, inventory-untracked)
//   - SKU/desc containing whole-word "SALE" (clearance, not reorder candidates)
//   - zero qty + zero cost rows (noise)
//
// Auth: Bearer <heartland_pull_webhook_secret from vault>.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HEARTLAND_BASE = "https://sunshinedaydream.retail.heartland.us/api";
const PER_PAGE = 500;
const DEFAULT_MAX_PAGES_PER_CHUNK = 12;
const DEFAULT_MAX_SECONDS = 90;

type Body = {
  snapshot_date?: string;
  dry_run?: boolean;
  max_pages_per_chunk?: number;
  max_seconds?: number;
  force_restart?: boolean;
};

function ctYesterday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  const base = new Date(`${y}-${m}-${d}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() - 1);
  return base.toISOString().slice(0, 10);
}

function pick(row: Record<string, any>, ...keys: string[]): any {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return row[k];
    if (k.includes(".")) {
      const parts = k.split(".");
      let cur: any = row;
      let ok = true;
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in cur) cur = cur[p];
        else { ok = false; break; }
      }
      if (ok && cur !== undefined && cur !== null) return cur;
    }
  }
  return null;
}

async function fetchPage(
  token: string,
  page: number,
): Promise<{ results: any[]; total: number; pages: number }> {
  const u = new URL(`${HEARTLAND_BASE}/inventory/values`);
  u.searchParams.append("group[]", "item_id");
  u.searchParams.append("group[]", "location_id");
  u.searchParams.set("per_page", String(PER_PAGE));
  u.searchParams.set("page", String(page));
  u.searchParams.append("_include[]", "item");
  u.searchParams.set("exclude_empty_locations", "true");
  const res = await fetch(u.toString(), {
    headers: { "Authorization": `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`heartland page ${page} http ${res.status}: ${t.slice(0, 400)}`);
  }
  const j = await res.json();
  return {
    results: Array.isArray(j.results) ? j.results : [],
    total: Number(j.total ?? 0),
    pages: Number(j.pages ?? 0),
  };
}

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ----- Auth -----
  const auth = req.headers.get("authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  const { data: secret } = await supabase.rpc("get_vault_secret", {
    secret_name: "heartland_pull_webhook_secret",
  });
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, error: "webhook secret missing" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  if (provided !== secret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  // ----- Body -----
  let body: Body = {};
  if (req.method === "POST") {
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch (_) { /* allow empty body */ }
  }
  const snapshot_date = body.snapshot_date || ctYesterday();
  const dry_run = !!body.dry_run;
  const max_pages = body.max_pages_per_chunk ?? DEFAULT_MAX_PAGES_PER_CHUNK;
  const max_seconds = body.max_seconds ?? DEFAULT_MAX_SECONDS;
  const force_restart = !!body.force_restart;

  const t_start = Date.now();
  const elapsed = () => (Date.now() - t_start) / 1000;

  const stats: any = {
    snapshot_date,
    dry_run,
    invocation_started_at: new Date().toISOString(),
    pages_pulled_this_invocation: 0,
    rows_upserted_this_invocation: 0,
  };

  try {
    // ----- Token + mapping -----
    const { data: tokenData, error: tokenErr } = await supabase.rpc("get_heartland_token");
    if (tokenErr || !tokenData) {
      throw new Error(`token retrieval: ${tokenErr?.message ?? "no value"}`);
    }
    const token = tokenData as string;

    const { data: mapping, error: mapErr } = await supabase
      .from("heartland_location_mapping")
      .select("heartland_id, entity_id, is_channel, is_active")
      .eq("is_active", true);
    if (mapErr) throw new Error(`mapping load: ${mapErr.message}`);
    const byNumId = new Map<number, any>();
    for (const m of mapping ?? []) byNumId.set(Number(m.heartland_id), m);
    stats.mapping_locations = mapping?.length ?? 0;

    // ----- Force restart? wipe state row first -----
    if (force_restart && !dry_run) {
      await supabase.from("heartland_inventory_pull_state").delete().eq("snapshot_date", snapshot_date);
    }

    // ----- Load or initialize state -----
    let { data: state } = await supabase
      .from("heartland_inventory_pull_state")
      .select("*")
      .eq("snapshot_date", snapshot_date)
      .maybeSingle();

    if (state?.status === "complete") {
      stats.short_circuit = "already_complete";
      stats.state = state;
      return new Response(JSON.stringify({ ok: true, done: true, stats }, null, 2), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    if (!state) {
      // Discover: hit page 1 to learn total_pages, then wipe and initialize.
      const p1 = await fetchPage(token, 1);
      stats.discovery = {
        total: p1.total,
        total_pages: p1.pages,
        sample_keys: p1.results[0] ? Object.keys(p1.results[0]) : [],
        sample_item_keys: p1.results[0]?.item ? Object.keys(p1.results[0].item) : [],
      };
      stats.pages_pulled_this_invocation = 1;
      stats.elapsed_after_discovery = elapsed();

      if (dry_run) {
        return new Response(JSON.stringify({ ok: true, done: false, dry_run: true, stats }, null, 2), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      // Wipe any pre-existing heartland rows for this date (full re-snapshot semantics).
      const { error: wipeErr } = await supabase
        .from("inventory_snapshots")
        .delete()
        .eq("snapshot_date", snapshot_date)
        .not("heartland_id", "is", null);
      if (wipeErr) throw new Error(`wipe existing snapshot rows: ${wipeErr.message}`);

      // Process page 1 in-line so we don't waste it.
      const initial = await processAndUpsert(p1.results, snapshot_date, byNumId, supabase);

      const { data: inserted, error: insErr } = await supabase
        .from("heartland_inventory_pull_state")
        .insert({
          snapshot_date,
          total_pages: p1.pages,
          next_page: 2,
          pages_completed: 1,
          rows_inserted: initial.upserted,
          rows_skipped_wildberry: initial.skipped_wildberry,
          rows_skipped_sale: initial.skipped_sale,
          rows_skipped_unmapped: initial.skipped_unmapped,
          rows_skipped_zero: initial.skipped_zero,
          status: p1.pages <= 1 ? "complete" : "running",
          last_chunk_at: new Date().toISOString(),
          completed_at: p1.pages <= 1 ? new Date().toISOString() : null,
        })
        .select("*")
        .single();
      if (insErr) throw new Error(`state insert: ${insErr.message}`);
      state = inserted;
      stats.rows_upserted_this_invocation += initial.upserted;
      stats.skipped_this_invocation = initial;
    }

    // ----- Main chunk loop -----
    let totals = {
      upserted: 0,
      skipped_wildberry: 0,
      skipped_sale: 0,
      skipped_unmapped: 0,
      skipped_zero: 0,
    };
    let pages_this_chunk = 0;

    while (
      state!.status === "running" &&
      state!.next_page <= (state!.total_pages ?? 0) &&
      pages_this_chunk < max_pages &&
      elapsed() < max_seconds
    ) {
      const pg = await fetchPage(token, state!.next_page);
      stats.pages_pulled_this_invocation += 1;
      pages_this_chunk += 1;

      const result = dry_run
        ? { upserted: 0, skipped_wildberry: 0, skipped_sale: 0, skipped_unmapped: 0, skipped_zero: 0 }
        : await processAndUpsert(pg.results, snapshot_date, byNumId, supabase);

      totals.upserted += result.upserted;
      totals.skipped_wildberry += result.skipped_wildberry;
      totals.skipped_sale += result.skipped_sale;
      totals.skipped_unmapped += result.skipped_unmapped;
      totals.skipped_zero += result.skipped_zero;

      const next_page = state!.next_page + 1;
      const total_pages = state!.total_pages ?? pg.pages;
      const is_done = next_page > total_pages;

      if (!dry_run) {
        const { data: updated, error: updErr } = await supabase
          .from("heartland_inventory_pull_state")
          .update({
            next_page,
            pages_completed: state!.pages_completed + 1,
            rows_inserted: state!.rows_inserted + result.upserted,
            rows_skipped_wildberry: state!.rows_skipped_wildberry + result.skipped_wildberry,
            rows_skipped_sale: state!.rows_skipped_sale + result.skipped_sale,
            rows_skipped_unmapped: state!.rows_skipped_unmapped + result.skipped_unmapped,
            rows_skipped_zero: state!.rows_skipped_zero + result.skipped_zero,
            status: is_done ? "complete" : "running",
            last_chunk_at: new Date().toISOString(),
            completed_at: is_done ? new Date().toISOString() : null,
            last_error: null,
          })
          .eq("snapshot_date", snapshot_date)
          .select("*")
          .single();
        if (updErr) throw new Error(`state update: ${updErr.message}`);
        state = updated;
      } else {
        state!.next_page = next_page;
        state!.status = is_done ? "complete" : "running";
      }
    }

    stats.rows_upserted_this_invocation += totals.upserted;
    stats.skipped_loop = totals;
    stats.elapsed_seconds_total = elapsed();
    stats.state_final = state;
    stats.done = state!.status === "complete";

    // ----- Enqueue continuation if more pages remain -----
    if (!dry_run && state!.status === "running") {
      const { data: reqId, error: enqErr } = await supabase.rpc(
        "enqueue_heartland_inventory_continuation",
        { p_snapshot_date: snapshot_date },
      );
      if (enqErr) {
        stats.continuation_enqueue_error = enqErr.message;
      } else {
        stats.continuation_request_id = reqId;
      }
    }

    return new Response(JSON.stringify({ ok: true, done: stats.done, stats }, null, 2), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    stats.elapsed_seconds_total = elapsed();
    stats.error = msg;
    try {
      await supabase
        .from("heartland_inventory_pull_state")
        .update({ status: "failed", last_error: msg, last_chunk_at: new Date().toISOString() })
        .eq("snapshot_date", snapshot_date);
    } catch (_) { /* swallow */ }
    return new Response(JSON.stringify({ ok: false, stats }, null, 2), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

// ----- Helpers -----

async function processAndUpsert(
  results: any[],
  snapshot_date: string,
  byNumId: Map<number, any>,
  supabase: any,
): Promise<{
  upserted: number;
  skipped_wildberry: number;
  skipped_sale: number;
  skipped_unmapped: number;
  skipped_zero: number;
}> {
  let skipped_wildberry = 0;
  let skipped_sale = 0;
  let skipped_unmapped = 0;
  let skipped_zero = 0;

  const rows: any[] = [];
  for (const r of results) {
    const item = r.item ?? {};
    const sku = item.public_id ?? null;
    const desc = item.description ?? null;
    const vendorId = item.primary_vendor_id ?? null;
    const qty = Number(r.qty_on_hand ?? r.qty ?? 0);
    const cost = r.unit_cost != null
      ? Number(r.unit_cost)
      : (item.cost != null ? Number(item.cost) : null);

    if (vendorId === 100511) { skipped_wildberry++; continue; }
    if (
      (sku && /\bSALE\b/i.test(String(sku))) ||
      (desc && /\bSALE\b/i.test(String(desc)))
    ) { skipped_sale++; continue; }

    const locId = pick(r, "location_id", "location.id");
    const m = byNumId.get(Number(locId));
    if (!m) { skipped_unmapped++; continue; }

    // Channels (e.g. Online Sales) have no physical inventory; physical stock lives at the
    // mapped warehouse. Skip them so we don't try to write a NULL entity_id row.
    if (m.is_channel) { skipped_unmapped++; continue; }

    if (qty === 0 && (cost ?? 0) === 0) { skipped_zero++; continue; }

    rows.push({
      entity_id: m.entity_id,
      location_id: null,
      heartland_id: m.heartland_id,
      snapshot_date,
      sku,
      item_name: desc ?? "(unnamed)",
      qty_on_hand: qty,
      avg_cost: cost,
      total_value: cost != null ? Math.round(qty * cost * 100) / 100 : null,
      source_file_path: "heartland_api:/inventory/values",
    });
  }

  let upserted = 0;
  if (rows.length > 0) {
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("inventory_snapshots")
        .upsert(chunk, { onConflict: "snapshot_date,heartland_id,sku", ignoreDuplicates: false });
      if (error) throw new Error(`inventory upsert chunk @${i}: ${error.message}`);
      upserted += chunk.length;
    }
  }
  return { upserted, skipped_wildberry, skipped_sale, skipped_unmapped, skipped_zero };
}
