// heartland-sales-pull
// Daily pull of sales + inventory from Heartland Retail Analyzer/Inventory Values API.
// Default behavior (no body): pull yesterday's sales (America/Chicago) and current inventory.
// Body params (all optional):
//   start_date: YYYY-MM-DD (defaults to yesterday CT)
//   end_date:   YYYY-MM-DD (defaults to yesterday CT)
//   skip_sales: boolean
//   skip_inventory: boolean
//   dry_run: boolean (returns stats without writing)
// Auth: Bearer <heartland_pull_webhook_secret from vault>
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HEARTLAND_BASE = "https://sunshinedaydream.retail.heartland.us/api";
const MAX_INVENTORY_PAGES = 80;

type RunPayload = {
  start_date?: string;
  end_date?: string;
  skip_sales?: boolean;
  skip_inventory?: boolean;
  dry_run?: boolean;
};

function ctDate(offsetDays = 0): string {
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
  base.setUTCDate(base.getUTCDate() + offsetDays);
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

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // ---- Internal auth check ----
  const auth = req.headers.get("authorization") || "";
  const provided = auth.replace(/^Bearer\s+/i, "").trim();
  let expectedSecret: string | null = null;
  const { data: rpcData } = await supabase.rpc(
    "get_vault_secret",
    { secret_name: "heartland_pull_webhook_secret" },
  );
  if (typeof rpcData === "string") expectedSecret = rpcData;
  if (!expectedSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: "webhook secret not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (provided !== expectedSecret) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // ---- Parse body ----
  let body: RunPayload = {};
  if (req.method === "POST") {
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch (_) { /* allow empty body */ }
  }

  const start_date = body.start_date || ctDate(-1);
  const end_date = body.end_date || ctDate(-1);
  const dry_run = !!body.dry_run;

  const stats: any = {
    start_date,
    end_date,
    dry_run,
    sales: { ran: !body.skip_sales },
    inventory: { ran: !body.skip_inventory },
    started_at: new Date().toISOString(),
  };

  try {
    const { data: tokenData, error: tokenErr } = await supabase.rpc(
      "get_heartland_token",
    );
    if (tokenErr || !tokenData) {
      throw new Error(`token retrieval failed: ${tokenErr?.message ?? "no value"}`);
    }
    const token = tokenData as string;

    const { data: mapping, error: mapErr } = await supabase
      .from("heartland_location_mapping")
      .select("heartland_id, heartland_public_id, heartland_name, entity_id, is_channel, is_active")
      .eq("is_active", true);
    if (mapErr) throw new Error(`mapping load: ${mapErr.message}`);

    const byPubId = new Map<string, any>();
    const byNumId = new Map<number, any>();
    for (const m of mapping ?? []) {
      if (m.heartland_public_id) byPubId.set(String(m.heartland_public_id), m);
      byNumId.set(Number(m.heartland_id), m);
    }
    stats.mapping_locations = mapping?.length ?? 0;

    // ====================  SALES  ====================
    if (!body.skip_sales) {
      const u = new URL(`${HEARTLAND_BASE}/reporting/analyzer`);
      u.searchParams.set("start_date", start_date);
      u.searchParams.set("end_date", end_date);
      const metrics = [
        "location_sales.gross_sales",
        "location_sales.net_sales",
        "location_sales.gross_returns",
        "location_sales.net_markdowns",
        "location_sales.transaction_count",
        "location_sales.gross_qty_sold",
        "location_sales.net_qty_sold",
      ];
      for (const m of metrics) u.searchParams.append("metrics[]", m);
      u.searchParams.append("groups[]", "location.public_id");
      u.searchParams.append("groups[]", "date.date");
      u.searchParams.set("per_page", "1000");

      const res = await fetch(u.toString(), {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`analyzer http ${res.status}: ${t.slice(0, 500)}`);
      }
      const payload = await res.json();
      stats.sales.api_total = payload.total ?? null;
      stats.sales.api_pages = payload.pages ?? null;
      stats.sales.sample_row = payload.results?.[0] ?? null;
      stats.sales.sample_keys = payload.results?.[0]
        ? Object.keys(payload.results[0])
        : [];

      const rows: any[] = [];
      const unmapped = new Set<string>();
      for (const r of payload.results ?? []) {
        const pubId = pick(r, "location.public_id", "public_id");
        const dateStr = pick(r, "date.date", "date");
        if (!pubId || !dateStr) continue;
        const m = byPubId.get(String(pubId));
        if (!m) {
          unmapped.add(String(pubId));
          continue;
        }
        const gross_sales = Number(pick(r, "location_sales.gross_sales", "gross_sales") ?? 0);
        const net_sales = Number(pick(r, "location_sales.net_sales", "net_sales") ?? 0);
        const returns = Number(pick(r, "location_sales.gross_returns", "gross_returns") ?? 0);
        const discounts = Number(pick(r, "location_sales.net_markdowns", "net_markdowns") ?? 0);
        const txn = Number(pick(r, "location_sales.transaction_count", "transaction_count") ?? 0);
        const units = Number(pick(r, "location_sales.net_qty_sold", "net_qty_sold") ?? 0);

        rows.push({
          sales_date: dateStr,
          heartland_id: m.heartland_id,
          entity_id: m.entity_id,
          is_channel: m.is_channel,
          gross_sales,
          net_sales,
          returns,
          discounts,
          tax_collected: 0,
          transaction_count: Math.round(txn),
          units_sold: Math.round(units),
          raw_payload: r,
          source: "heartland_api",
        });
      }
      stats.sales.unmapped_public_ids = Array.from(unmapped);
      stats.sales.rows_prepared = rows.length;

      if (!dry_run && rows.length > 0) {
        const { error: upErr } = await supabase
          .from("daily_location_sales")
          .upsert(rows, { onConflict: "sales_date,heartland_id" });
        if (upErr) throw new Error(`sales upsert: ${upErr.message}`);
        stats.sales.upserted = rows.length;
      }
    }

    // ====================  INVENTORY  ====================
    // NOTE: full inventory pull exceeds 150s edge function idle timeout on this catalog size.
    // Daily cron deliberately calls with skip_inventory=true. Chunked inventory strategy is tracked
    // in agent_memory + system_alerts as next-session work (filed 2026-06-29).
    if (!body.skip_inventory) {
      const snapshot_date = end_date;
      const collected: any[] = [];
      let pageNum = 1;
      const perPage = 500;
      let totalPages = 1;

      while (pageNum <= totalPages && pageNum <= MAX_INVENTORY_PAGES) {
        const u = new URL(`${HEARTLAND_BASE}/inventory/values`);
        u.searchParams.append("group[]", "item_id");
        u.searchParams.append("group[]", "location_id");
        u.searchParams.set("per_page", String(perPage));
        u.searchParams.set("page", String(pageNum));
        u.searchParams.append("_include[]", "item");
        u.searchParams.set("exclude_empty_locations", "true");

        const res = await fetch(u.toString(), {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`inventory http ${res.status} page ${pageNum}: ${t.slice(0, 500)}`);
        }
        const payload = await res.json();
        if (pageNum === 1) {
          stats.inventory.api_total = payload.total ?? null;
          stats.inventory.api_pages = payload.pages ?? null;
          stats.inventory.sample_row = payload.results?.[0] ?? null;
          stats.inventory.sample_keys = payload.results?.[0]
            ? Object.keys(payload.results[0])
            : [];
          totalPages = Number(payload.pages ?? 1);
        }
        collected.push(...(payload.results ?? []));
        pageNum++;
      }
      stats.inventory.rows_fetched = collected.length;
      stats.inventory.pages_pulled = pageNum - 1;
      if (totalPages > MAX_INVENTORY_PAGES) {
        stats.inventory.truncated = true;
      }

      let skipped_wildberry = 0;
      let skipped_sale = 0;
      let unmapped = 0;
      let zero_qty = 0;
      const snapRows: any[] = [];

      for (const r of collected) {
        const item = r.item ?? {};
        const sku = item.public_id ?? null;
        const desc = item.description ?? null;
        const vendorId = item.primary_vendor_id ?? null;
        const qty = Number(r.qty_on_hand ?? 0);
        const cost = r.unit_cost != null ? Number(r.unit_cost) : null;

        if (vendorId === 100511) { skipped_wildberry++; continue; }
        if ((sku && /\bSALE\b/i.test(String(sku))) ||
            (desc && /\bSALE\b/i.test(String(desc)))) {
          skipped_sale++;
          continue;
        }
        const m = byNumId.get(Number(r.location_id));
        if (!m) { unmapped++; continue; }
        if (qty === 0 && (cost ?? 0) === 0) { zero_qty++; continue; }

        snapRows.push({
          entity_id: m.entity_id,
          location_id: null,
          heartland_id: m.heartland_id,
          snapshot_date,
          sku,
          item_name: desc,
          qty_on_hand: qty,
          avg_cost: cost,
          total_value: cost != null ? Math.round(qty * cost * 100) / 100 : null,
          source_file_path: "heartland_api:/inventory/values",
        });
      }
      stats.inventory.skipped_wildberry = skipped_wildberry;
      stats.inventory.skipped_sale_skus = skipped_sale;
      stats.inventory.unmapped_locations = unmapped;
      stats.inventory.skipped_zero = zero_qty;
      stats.inventory.rows_prepared = snapRows.length;

      if (!dry_run && snapRows.length > 0) {
        const { error: delErr } = await supabase
          .from("inventory_snapshots")
          .delete()
          .eq("snapshot_date", snapshot_date)
          .not("heartland_id", "is", null);
        if (delErr) throw new Error(`inventory wipe: ${delErr.message}`);

        const chunkSize = 1000;
        let inserted = 0;
        for (let i = 0; i < snapRows.length; i += chunkSize) {
          const chunk = snapRows.slice(i, i + chunkSize);
          const { error } = await supabase
            .from("inventory_snapshots")
            .insert(chunk);
          if (error) throw new Error(`inventory insert chunk @${i}: ${error.message}`);
          inserted += chunk.length;
        }
        stats.inventory.inserted = inserted;
      }
    }

    stats.finished_at = new Date().toISOString();
    return new Response(JSON.stringify({ ok: true, stats }, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    stats.finished_at = new Date().toISOString();
    stats.error = String(e?.message ?? e);
    return new Response(JSON.stringify({ ok: false, stats }, null, 2), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
