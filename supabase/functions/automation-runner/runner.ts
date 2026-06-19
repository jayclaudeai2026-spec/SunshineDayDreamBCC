// automation_runner / runner.ts
// Core execution: pick due recipes, dispatch INTERNAL handlers or COMPOSIO step chains,
// log to automation_runs, update counters + next_run_at.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import cronParser from "npm:cron-parser@4.9.0";

// ---- Supabase client (service_role) ----
function sb(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---- Webhook secret (cached in worker memory; pulled from vault on cold start) ----
let cachedSecret: string | null = null;
export async function validateWebhookSecret(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!provided) return false;
  if (!cachedSecret) {
    const c = sb();
    const { data, error } = await c.rpc("get_webhook_secret", {
      secret_name: "automation_runner_webhook_secret",
    });
    if (error || !data) {
      console.error("[runner] get_webhook_secret rpc failed:", error?.message ?? "no data");
      return false;
    }
    cachedSecret = String(data);
  }
  return provided === cachedSecret;
}


// ---- Cron evaluation ----
function computeNextRun(cron: string | null | undefined, after: Date): Date | null {
  if (!cron) return null;
  try {
    const it = cronParser.parseExpression(cron, { currentDate: after, utc: true });
    return it.next().toDate();
  } catch (e) {
    console.error(`[runner] bad cron "${cron}":`, e);
    return null;
  }
}

// ---- INTERNAL handlers ----
// recipe_type prefix "INTERNAL:" — handlers keyed by suffix.
const INTERNAL_HANDLERS: Record<string, (c: SupabaseClient) => Promise<Record<string, unknown>>> = {
  refresh_system_status,
  tax_calendar_due_soon,
  tax_calendar_overdue,
  open_close_period_all_entities,
};

async function refresh_system_status(c: SupabaseClient): Promise<Record<string, unknown>> {
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [lastIngest, lastParse, lastAuto, ingestPending, autoFailed24, activeEnts] = await Promise.all([
    c.from("ingest_log").select("received_at").order("received_at", { ascending: false }).limit(1).maybeSingle(),
    c.from("ingest_log").select("updated_at").not("parse_result", "is", null).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    c.from("automation_runs").select("started_at").eq("status", "success").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    c.from("ingest_log").select("*", { count: "exact", head: true }).eq("parse_result", "pending"),
    c.from("automation_runs").select("*", { count: "exact", head: true }).eq("status", "failed").gte("started_at", dayAgo),
    c.from("entities").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const ingestQueue = ingestPending.count ?? 0;
  const failed24 = autoFailed24.count ?? 0;
  let health: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (ingestQueue > 20 || failed24 > 5) health = "degraded";
  if (ingestQueue > 50 || failed24 > 20) health = "unhealthy";

  const nowIso = new Date().toISOString();
  const { error } = await c
    .from("system_status")
    .update({
      last_email_ingest_at: lastIngest.data?.received_at ?? null,
      last_parser_run_at: lastParse.data?.updated_at ?? null,
      last_automation_run_at: lastAuto.data?.started_at ?? null,
      ingest_queue_depth: ingestQueue,
      parser_pending_count: ingestQueue,
      automation_failed_24h: failed24,
      active_entities_count: activeEnts.count ?? 0,
      overall_health: health,
      last_health_check_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", 1);
  if (error) throw new Error(`system_status update: ${error.message}`);

  return {
    health,
    ingest_queue_depth: ingestQueue,
    automation_failed_24h: failed24,
    active_entities: activeEnts.count ?? 0,
  };
}

async function tax_calendar_due_soon(c: SupabaseClient): Promise<Record<string, unknown>> {
  // status='upcoming' AND due_date BETWEEN today AND today+reminder_lead_days -> due_soon
  const today = new Date().toISOString().slice(0, 10);
  const { data: candidates, error } = await c
    .from("tax_calendar")
    .select("id, due_date, reminder_lead_days")
    .eq("status", "upcoming")
    .gte("due_date", today);
  if (error) throw new Error(`tax_calendar select: ${error.message}`);

  const todayMs = new Date(today + "T00:00:00Z").getTime();
  const toUpdate = (candidates ?? []).filter((r) => {
    const lead = (r as { reminder_lead_days?: number }).reminder_lead_days ?? 14;
    const dueMs = new Date(((r as { due_date: string }).due_date) + "T00:00:00Z").getTime();
    return (dueMs - todayMs) / 86400000 <= lead;
  });
  if (toUpdate.length === 0) return { updated: 0 };
  const ids = toUpdate.map((r) => (r as { id: number }).id);
  const { error: e2 } = await c
    .from("tax_calendar")
    .update({ status: "due_soon", updated_at: new Date().toISOString() })
    .in("id", ids);
  if (e2) throw new Error(`tax_calendar update: ${e2.message}`);
  return { updated: toUpdate.length };
}

async function tax_calendar_overdue(c: SupabaseClient): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: candidates, error } = await c
    .from("tax_calendar")
    .select("id")
    .in("status", ["upcoming", "due_soon"])
    .lt("due_date", today);
  if (error) throw new Error(`tax_calendar overdue select: ${error.message}`);
  if (!candidates || candidates.length === 0) return { updated: 0 };
  const ids = candidates.map((r) => (r as { id: number }).id);
  const { error: e2 } = await c
    .from("tax_calendar")
    .update({ status: "overdue", updated_at: new Date().toISOString() })
    .in("id", ids);
  if (e2) throw new Error(`tax_calendar overdue update: ${e2.message}`);
  return { updated: ids.length };
}

async function open_close_period_all_entities(c: SupabaseClient): Promise<Record<string, unknown>> {
  // Prior month for each active entity
  const now = new Date();
  const prior = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const period = prior.toISOString().slice(0, 10);

  const { data: ents, error } = await c.from("entities").select("id").eq("is_active", true);
  if (error) throw new Error(`entities select: ${error.message}`);
  const entityRows = (ents ?? []) as Array<{ id: number }>;
  if (entityRows.length === 0) return { opened: 0, period };

  const rows = entityRows.map((e) => ({
    entity_id: e.id,
    period,
    status: "open",
    opened_at: new Date().toISOString(),
    checklist_items: [],
    blocking_issues: [],
  }));
  const { error: e2 } = await c
    .from("monthly_close_checklist")
    .upsert(rows, { onConflict: "entity_id,period", ignoreDuplicates: true });
  if (e2) throw new Error(`monthly_close_checklist upsert: ${e2.message}`);
  return { opened: rows.length, period };
}

// ---- Step-chain executor (COMPOSIO:step_chain recipes) ----
type StepCtx = Record<string, unknown>;

function substituteVars(value: unknown, ctx: StepCtx): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
      const v = ctx[key];
      if (v === undefined || v === null) return "";
      return typeof v === "string" ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substituteVars(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteVars(v, ctx);
    }
    return out;
  }
  return value;
}

function containsPlaceholder(step: unknown): boolean {
  return JSON.stringify(step).includes("[INSTALL TIME:");
}

interface StepChainResult {
  steps_run: number;
  steps_skipped: number;
  notes: string[];
}

async function executeStepChain(
  c: SupabaseClient,
  recipe: { input_config?: { steps?: unknown[] } },
): Promise<StepChainResult> {
  const steps = (recipe.input_config?.steps ?? []) as Array<Record<string, unknown>>;
  const ctx: StepCtx = {};
  const notes: string[] = [];
  let stepsRun = 0;
  let stepsSkipped = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const label = (step.label as string) || `step_${i}`;

    // DUMMY_INLINE placeholder
    if (step.tool === "DUMMY_INLINE") {
      stepsSkipped++;
      notes.push(`[${label}] DUMMY_INLINE placeholder — skipped`);
      continue;
    }

    // [INSTALL TIME: ...] placeholder anywhere in the step
    if (containsPlaceholder(step)) {
      stepsSkipped++;
      notes.push(`[${label}] contains [INSTALL TIME:] placeholder — skipped`);
      continue;
    }

    // LLM step
    if (step.llm === true) {
      const groqKey = Deno.env.get("GROQ_API_KEY");
      if (!groqKey) {
        stepsSkipped++;
        notes.push(`[${label}] LLM step, GROQ_API_KEY not set — skipped`);
        continue;
      }
      const prompt = substituteVars(step.prompt ?? "", ctx) as string;
      const model = (step.model as string) || "llama-3.3-70b-versatile";
      const expectJson = step.expect_json === true;
      const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          response_format: expectJson ? { type: "json_object" } : undefined,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Groq ${resp.status}: ${t.slice(0, 300)}`);
      }
      const j = await resp.json();
      const content = (j?.choices?.[0]?.message?.content ?? "") as string;
      const captured: unknown = expectJson ? JSON.parse(content) : content;
      if (typeof step.capture_as === "string") ctx[step.capture_as] = captured;
      stepsRun++;
      notes.push(`[${label}] LLM ok (${content.length} chars)`);
      continue;
    }

    // Composio tool step
    if (typeof step.tool === "string") {
      const composioKey = Deno.env.get("COMPOSIO_API_KEY");
      if (!composioKey) {
        stepsSkipped++;
        notes.push(`[${label}] Composio step, COMPOSIO_API_KEY not set — skipped`);
        continue;
      }
      const args = substituteVars(step.args ?? {}, ctx);
      const userId = Deno.env.get("COMPOSIO_USER_ID") ?? "pg-test-0d5c469e-5bc9-4212-a081-09b738e5a2de";
      const resp = await fetch(
        `https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(step.tool)}`,
        {
          method: "POST",
          headers: {
            "x-api-key": composioKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ user_id: userId, arguments: args }),
        },
      );
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`Composio ${step.tool} ${resp.status}: ${t.slice(0, 300)}`);
      }
      const j = await resp.json();
      // v3 unwrap: { data: { response_data?: {...}, ... } } — defensive both ways
      const data = (j?.data ?? j) as Record<string, unknown>;
      const unwrapped = (data?.response_data ?? data) as unknown;
      if (typeof step.capture_as === "string") ctx[step.capture_as] = unwrapped;
      stepsRun++;
      notes.push(`[${label}] Composio ${step.tool} ok`);
      continue;
    }

    // DB write step
    if (typeof step.write_to === "string") {
      const data = substituteVars(step.data, ctx);
      const rows = Array.isArray(data) ? data : [data];
      const onConflict = typeof step.on_conflict === "string" ? step.on_conflict : undefined;
      const q = c.from(step.write_to).upsert(rows as Record<string, unknown>[], onConflict ? { onConflict } : undefined);
      const { error } = await q;
      if (error) throw new Error(`db_write ${step.write_to}: ${error.message}`);
      stepsRun++;
      notes.push(`[${label}] wrote ${rows.length} rows to ${step.write_to}`);
      continue;
    }

    stepsSkipped++;
    notes.push(`[${label}] unknown step shape — skipped`);
  }

  return { steps_run: stepsRun, steps_skipped: stepsSkipped, notes };
}

// ---- Recipe execution ----
interface RecipeRow {
  id: number;
  recipe_key: string;
  recipe_type: string;
  is_active: boolean;
  schedule_cron: string | null;
  input_config: { steps?: unknown[] } | null;
  success_count: number;
  failure_count: number;
}

async function executeRecipe(
  c: SupabaseClient,
  recipe: RecipeRow,
  triggeredBy: string,
): Promise<Record<string, unknown>> {
  const startedAt = new Date();

  // Create automation_runs row (status=running)
  const { data: runRow, error: eRun } = await c
    .from("automation_runs")
    .insert({
      recipe_id: recipe.id,
      recipe_key: recipe.recipe_key,
      status: "running",
      triggered_by: triggeredBy,
      started_at: startedAt.toISOString(),
      input_snapshot: {
        recipe_type: recipe.recipe_type,
        schedule_cron: recipe.schedule_cron,
      },
    })
    .select("id")
    .single();
  if (eRun) throw new Error(`automation_runs insert: ${eRun.message}`);
  const runId = (runRow as { id: number }).id;

  let status: "success" | "failed" | "skipped" = "success";
  let outputSummary: Record<string, unknown> = {};
  let errorMessage: string | null = null;
  let errorStack: string | null = null;
  let recordsWritten = 0;
  let recordsSkipped = 0;

  try {
    if (recipe.recipe_type?.startsWith("INTERNAL:")) {
      const handlerKey = recipe.recipe_type.slice("INTERNAL:".length);
      const handler = INTERNAL_HANDLERS[handlerKey];
      if (!handler) {
        status = "skipped";
        outputSummary = { reason: `no INTERNAL handler registered for "${handlerKey}"` };
      } else {
        outputSummary = await handler(c);
        const n = outputSummary.updated ?? outputSummary.opened ?? 0;
        recordsWritten = typeof n === "number" ? n : 0;
      }
    } else if (recipe.recipe_type === "COMPOSIO:step_chain") {
      const r = await executeStepChain(c, recipe);
      outputSummary = { steps_run: r.steps_run, steps_skipped: r.steps_skipped, notes: r.notes };
      recordsWritten = r.steps_run;
      recordsSkipped = r.steps_skipped;
      if (r.steps_run === 0 && r.steps_skipped > 0) status = "skipped";
    } else {
      status = "skipped";
      outputSummary = { reason: `unknown recipe_type "${recipe.recipe_type}"` };
    }
  } catch (e) {
    status = "failed";
    errorMessage = e instanceof Error ? e.message : String(e);
    errorStack = e instanceof Error ? (e.stack ?? null) : null;
    console.error(`[runner] recipe ${recipe.recipe_key} failed:`, errorMessage);
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const nextRun = computeNextRun(recipe.schedule_cron, completedAt);

  // Update automation_runs row
  await c
    .from("automation_runs")
    .update({
      status,
      completed_at: completedAt.toISOString(),
      duration_ms: durationMs,
      output_summary: outputSummary,
      records_written: recordsWritten,
      records_skipped: recordsSkipped,
      error_message: errorMessage,
      error_stack: errorStack,
    })
    .eq("id", runId);

  // Update recipe counters
  const recipeUpdate: Record<string, unknown> = {
    last_run_at: completedAt.toISOString(),
    next_run_at: nextRun ? nextRun.toISOString() : null,
    updated_at: completedAt.toISOString(),
  };
  if (status === "success") {
    recipeUpdate.success_count = (recipe.success_count ?? 0) + 1;
    recipeUpdate.last_error = null;
  } else if (status === "failed") {
    recipeUpdate.failure_count = (recipe.failure_count ?? 0) + 1;
    recipeUpdate.last_error = errorMessage;
  }
  await c.from("automation_recipes").update(recipeUpdate).eq("id", recipe.id);

  return {
    recipe_key: recipe.recipe_key,
    run_id: runId,
    status,
    duration_ms: durationMs,
    output_summary: outputSummary,
    next_run_at: nextRun?.toISOString() ?? null,
    error_message: errorMessage,
  };
}

// ---- Public entry points ----
export async function runRecipe(recipeKey: string, triggeredBy: string): Promise<Record<string, unknown>> {
  const c = sb();
  const { data, error } = await c
    .from("automation_recipes")
    .select("*")
    .eq("recipe_key", recipeKey)
    .maybeSingle();
  if (error) throw new Error(`recipe lookup: ${error.message}`);
  if (!data) throw new Error(`recipe not found: ${recipeKey}`);
  return await executeRecipe(c, data as RecipeRow, triggeredBy);
}

export async function runPoll(): Promise<Record<string, unknown>> {
  const c = sb();
  const nowIso = new Date().toISOString();

  // Active recipes with a schedule, where next_run_at is null (uninitialized) or due now.
  // null-cron recipes (e.g. gl_entry_writer_generic) are excluded — they're manual-only.
  const { data, error } = await c
    .from("automation_recipes")
    .select("*")
    .eq("is_active", true)
    .not("schedule_cron", "is", null)
    .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
    .order("id");
  if (error) throw new Error(`recipe select: ${error.message}`);

  const recipes = (data ?? []) as RecipeRow[];
  const results: Array<Record<string, unknown>> = [];

  for (const r of recipes) {
    try {
      // First-observation initialization: if next_run_at is null, this is the first
      // time the runner sees this recipe — just schedule it, don't fire immediately.
      // Protects against blasting a recipe whose nominal schedule passed long ago
      // (e.g. monthly_close_kickoff deployed mid-month).
      const nextRunAt = (r as RecipeRow & { next_run_at?: string | null }).next_run_at;
      if (nextRunAt == null) {
        const next = computeNextRun(r.schedule_cron, new Date());
        await c
          .from("automation_recipes")
          .update({ next_run_at: next?.toISOString() ?? null, updated_at: new Date().toISOString() })
          .eq("id", r.id);
        results.push({
          recipe_key: r.recipe_key,
          status: "initialized",
          next_run_at: next?.toISOString() ?? null,
        });
        continue;
      }
      const res = await executeRecipe(c, r, "cron");
      results.push(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ recipe_key: r.recipe_key, status: "runner_error", error: msg });
    }
  }

  return { polled_at: nowIso, recipes_examined: recipes.length, results };
}
