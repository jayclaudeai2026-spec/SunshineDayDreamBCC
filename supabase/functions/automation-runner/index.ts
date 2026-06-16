// =========================================================================
// automation-runner — generic recipe executor for IA BCC
// =========================================================================
//
// PURPOSE
//   Generic executor for any row in public.automation_recipes. Triggered by:
//     (a) pg_cron tick hitting this Edge Function URL on a schedule, with
//         { mode: "due" } to sweep all due recipes, OR
//     (b) direct invocation with { recipe_id: N } or { recipe_key: "..." }
//         from the BCC webapp Automations module or from the install
//         playbook for one-off runs.
//
// DISPATCH BY recipe_type PREFIX
//   "INTERNAL:<handler>" — calls a built-in Postgres function or in-process
//                          handler. Args from input_config. Used for system
//                          operations (refresh_system_status, open_close_
//                          period, clone_coa_template, etc.) that don't need
//                          Composio.
//   "COMPOSIO:<shape>"   — runs the steps[] array in input_config. Each
//                          step is { tool, args, capture_as } OR
//                          { llm: true, prompt, capture_as } OR
//                          { write_to: "table", data, on_conflict }.
//                          Template strings {{ capture_name }} reference
//                          prior captures.
//
// AUTH
//   Authorization: Bearer <AUTOMATION_RUNNER_SECRET>
//
// LLM CALLS
//   Route through COMPOSIO_SEARCH_GROQ_CHAT — auth is just COMPOSIO_API_KEY.
//   No separate Groq/OpenAI/Anthropic key required.
//
// ERROR HANDLING
//   Errors are captured into automation_runs.error_message / error_stack and
//   the recipe's failure counter is bumped via record_automation_run_outcome.
//   No external alerting (Telegram/Slack) at v1 — operator monitors
//   system_alerts and the Automations module dashboard.

// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const COMPOSIO_API_KEY  = Deno.env.get("COMPOSIO_API_KEY")!;
const AUTOMATION_SECRET = Deno.env.get("AUTOMATION_RUNNER_SECRET") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const COMPOSIO_EXEC_URL  = "https://backend.composio.dev/api/v3/tools/execute";
const COMPOSIO_LLM_TOOL  = "COMPOSIO_SEARCH_GROQ_CHAT";
const LLM_MODEL_DEFAULT  = "llama-3.3-70b-versatile";
const RUN_TIMEOUT_MS     = 240_000; // 4 min cap per recipe; pg_cron tick is typically 5 min

// =========================================================================
// HTTP entry
// =========================================================================

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed; use POST" });
  }

  if (AUTOMATION_SECRET) {
    const auth = (req.headers.get("authorization") ?? "")
      .replace(/^Bearer\s+/i, "").trim();
    if (auth !== AUTOMATION_SECRET) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
  }
  if (!COMPOSIO_API_KEY) {
    return jsonResponse(500, { error: "Server misconfigured: missing COMPOSIO_API_KEY" });
  }

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  try {
    if (body.mode === "due") {
      return jsonResponse(200, await runDue());
    }
    if (body.recipe_id || body.recipe_key) {
      const recipe = await loadRecipe({ id: body.recipe_id, key: body.recipe_key });
      if (!recipe) return jsonResponse(404, { error: "Recipe not found" });
      const outcome = await executeRecipe(recipe, {
        input_override: body.input_override,
        triggered_by: body.triggered_by ?? "manual",
        dry_run: !!body.dry_run,
      });
      return jsonResponse(200, outcome);
    }
    return jsonResponse(400, {
      error: 'Provide one of: { recipe_id }, { recipe_key }, or { mode: "due" }',
    });
  } catch (err: any) {
    console.error("automation-runner fatal:", err?.message ?? err);
    return jsonResponse(500, { error: String(err?.message ?? err).slice(0, 1000) });
  }
});

// =========================================================================
// Run-due sweep
// =========================================================================

async function runDue(): Promise<any> {
  const { data: due, error } = await sb
    .from("automation_recipes")
    .select("*")
    .eq("is_active", true)
    .not("schedule_cron", "is", null)
    .or("next_run_at.is.null,next_run_at.lte." + new Date().toISOString())
    .order("next_run_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (error) throw new Error(`due sweep: ${error.message}`);
  const results: any[] = [];
  for (const recipe of due ?? []) {
    try {
      const r = await executeRecipe(recipe, { triggered_by: "cron" });
      results.push({ recipe_key: recipe.recipe_key, ...r });
    } catch (err: any) {
      results.push({ recipe_key: recipe.recipe_key, error: String(err?.message ?? err) });
    }
  }
  return { mode: "due", processed: results.length, results };
}

// =========================================================================
// Recipe execution
// =========================================================================

async function loadRecipe(args: { id?: number; key?: string }): Promise<any | null> {
  let q = sb.from("automation_recipes").select("*").limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (args.key) q = q.eq("recipe_key", args.key);
  else return null;
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`load recipe: ${error.message}`);
  return data;
}

interface ExecutionOptions {
  input_override?: any;
  triggered_by: string;
  dry_run?: boolean;
}

async function executeRecipe(recipe: any, opts: ExecutionOptions): Promise<any> {
  const t0 = Date.now();
  const recipeType: string = recipe.recipe_type ?? "";

  // Insert run row in "running" state
  const { data: runIns, error: runErr } = await sb
    .from("automation_runs")
    .insert({
      recipe_id: recipe.id,
      recipe_key: recipe.recipe_key,
      status: "running",
      triggered_by: opts.triggered_by,
      started_at: new Date().toISOString(),
      input_snapshot: opts.input_override ?? recipe.input_config ?? {},
    })
    .select("id")
    .single();
  if (runErr) throw new Error(`automation_runs insert: ${runErr.message}`);
  const runId: number = runIns.id;

  const callsAudit: any[] = [];
  let outputSummary: any = {};
  let recordsWritten = 0;

  try {
    const input = opts.input_override ?? recipe.input_config ?? {};

    if (opts.dry_run) {
      outputSummary = { dry_run: true, recipe_type: recipeType, input };
    } else if (recipeType.startsWith("INTERNAL:")) {
      const handler = recipeType.slice("INTERNAL:".length);
      outputSummary = await runInternalHandler(handler, input, callsAudit);
    } else if (recipeType.startsWith("COMPOSIO:")) {
      const result = await runComposioSteps(input, callsAudit);
      outputSummary = result.summary;
      recordsWritten = result.records_written;
    } else {
      throw new Error(
        `Unknown recipe_type prefix: ${recipeType}. ` +
        `Expected "INTERNAL:..." or "COMPOSIO:...".`,
      );
    }

    const dur = Date.now() - t0;
    await sb.from("automation_runs").update({
      status: "success",
      completed_at: new Date().toISOString(),
      duration_ms: dur,
      output_summary: outputSummary,
      records_written: recordsWritten,
      composio_calls: callsAudit,
    }).eq("id", runId);

    await sb.rpc("record_automation_run_outcome", {
      p_recipe_id: recipe.id,
      p_status: "success",
      p_error_message: null,
    });

    return { run_id: runId, status: "success", duration_ms: dur, output_summary: outputSummary, records_written: recordsWritten };

  } catch (err: any) {
    const dur = Date.now() - t0;
    const msg = String(err?.message ?? err).slice(0, 2000);
    const stack = String(err?.stack ?? "").slice(0, 4000);

    await sb.from("automation_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      duration_ms: dur,
      error_message: msg,
      error_stack: stack,
      composio_calls: callsAudit,
    }).eq("id", runId);

    await sb.rpc("record_automation_run_outcome", {
      p_recipe_id: recipe.id,
      p_status: "failed",
      p_error_message: msg,
    });

    // Raise a system_alerts row so the Dashboard surfaces it
    await sb.from("system_alerts").insert({
      severity: "error",
      category: "automation",
      message: `Recipe ${recipe.recipe_key} failed: ${msg.slice(0, 200)}`,
      context: { recipe_id: recipe.id, run_id: runId, error: msg },
    });

    return { run_id: runId, status: "failed", duration_ms: dur, error_message: msg };
  }
}

// =========================================================================
// INTERNAL handler dispatch
// =========================================================================

async function runInternalHandler(
  handler: string,
  input: any,
  audit: any[],
): Promise<any> {
  audit.push({ handler: `INTERNAL:${handler}`, input });

  switch (handler) {
    case "refresh_system_status": {
      const { error } = await sb.rpc("refresh_system_status");
      if (error) throw new Error(`refresh_system_status: ${error.message}`);
      return { ok: true };
    }
    case "open_close_period": {
      if (!input.entity_id || !input.period) {
        throw new Error("open_close_period requires { entity_id, period }");
      }
      const { data, error } = await sb.rpc("open_close_period", {
        p_entity_id: input.entity_id,
        p_period: input.period,
      });
      if (error) throw new Error(`open_close_period: ${error.message}`);
      return { checklist_id: data };
    }
    case "open_close_period_all_entities": {
      // Opens the current month's close cycle for every active entity.
      const period = input.period ?? firstOfThisMonth();
      const { data: entities, error } = await sb
        .from("entities")
        .select("id, entity_short_name")
        .eq("is_active", true);
      if (error) throw new Error(`list entities: ${error.message}`);
      const out: any[] = [];
      for (const e of entities ?? []) {
        const { data, error: rpcErr } = await sb.rpc("open_close_period", {
          p_entity_id: e.id, p_period: period,
        });
        if (rpcErr) out.push({ entity_id: e.id, error: rpcErr.message });
        else out.push({ entity_id: e.id, entity_short_name: e.entity_short_name, checklist_id: data });
      }
      return { period, opened: out.length, results: out };
    }
    case "clone_coa_template": {
      if (!input.entity_id) throw new Error("clone_coa_template requires { entity_id }");
      const { data, error } = await sb.rpc("clone_coa_template_to_entity", {
        p_entity_id: input.entity_id,
      });
      if (error) throw new Error(`clone_coa_template: ${error.message}`);
      return { accounts_inserted: data };
    }
    case "tax_calendar_due_soon": {
      // Marks tax_calendar rows as 'due_soon' if due_date <= today + reminder_lead_days
      const { data, error } = await sb
        .from("tax_calendar")
        .update({ status: "due_soon" })
        .eq("status", "upcoming")
        .lte("due_date", new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10))
        .select("id");
      if (error) throw new Error(`tax_calendar_due_soon: ${error.message}`);
      return { marked_due_soon: data?.length ?? 0 };
    }
    case "tax_calendar_overdue": {
      // Marks tax_calendar rows as 'overdue' if past due_date and not filed/paid
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await sb
        .from("tax_calendar")
        .update({ status: "overdue" })
        .in("status", ["upcoming", "due_soon"])
        .lt("due_date", today)
        .eq("extension_filed", false)
        .select("id");
      if (error) throw new Error(`tax_calendar_overdue: ${error.message}`);
      return { marked_overdue: data?.length ?? 0 };
    }
    default:
      throw new Error(`Unknown INTERNAL handler: ${handler}`);
  }
}

// =========================================================================
// COMPOSIO step chain execution
// =========================================================================

interface ComposioStepResult {
  summary: any;
  records_written: number;
}

async function runComposioSteps(input: any, audit: any[]): Promise<ComposioStepResult> {
  const steps: any[] = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length === 0) {
    throw new Error("COMPOSIO recipe has no steps[] in input_config");
  }

  const captures: Record<string, any> = {};
  let recordsWritten = 0;
  const stepResults: any[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepLabel = step.label || `step_${i}`;

    if (step.llm === true) {
      const prompt = renderTemplate(step.prompt ?? "", captures);
      const model = step.model ?? LLM_MODEL_DEFAULT;
      const expectJson = step.expect_json !== false;

      const llmResp = await callComposio(COMPOSIO_LLM_TOOL, {
        messages: [{ role: "user", content: prompt }],
        model,
        ...(step.composio_args ?? {}),
      });
      audit.push({ step: stepLabel, llm: true, model, response_preview: previewJson(llmResp, 1000) });

      const text = extractLlmText(llmResp);
      const parsed = expectJson ? safeJsonParse(text) : text;
      if (step.capture_as) captures[step.capture_as] = parsed;
      stepResults.push({ step: stepLabel, ok: true, kind: "llm" });

    } else if (step.write_to) {
      const tableName = step.write_to;
      const dataRaw = step.data !== undefined ? resolveDeep(step.data, captures) : null;
      if (dataRaw == null) throw new Error(`${stepLabel} write_to has no data`);
      const rows = Array.isArray(dataRaw) ? dataRaw : [dataRaw];
      if (rows.length === 0) {
        stepResults.push({ step: stepLabel, ok: true, kind: "write", rows: 0, note: "no rows" });
        continue;
      }

      const onConflict = step.on_conflict as string | undefined;
      let query = sb.from(tableName);
      const op = onConflict
        ? query.upsert(rows, { onConflict })
        : query.insert(rows);
      const { error, count } = await op;
      if (error) throw new Error(`${stepLabel} write_to ${tableName}: ${error.message}`);

      const written = count ?? rows.length;
      recordsWritten += written;
      audit.push({ step: stepLabel, write_to: tableName, rows_written: written });
      if (step.capture_as) captures[step.capture_as] = { rows_written: written };
      stepResults.push({ step: stepLabel, ok: true, kind: "write", rows: written });

    } else if (step.tool) {
      const tool = step.tool as string;
      const argsResolved = resolveDeep(step.args ?? {}, captures);
      const resp = await callComposio(tool, argsResolved);
      audit.push({ step: stepLabel, tool, args_preview: previewJson(argsResolved, 600), response_preview: previewJson(resp, 1500) });
      if (step.capture_as) captures[step.capture_as] = resp;
      stepResults.push({ step: stepLabel, ok: true, kind: "tool", tool });

    } else {
      throw new Error(`${stepLabel} has no recognized kind (llm | write_to | tool)`);
    }
  }

  return {
    summary: {
      steps_executed: stepResults.length,
      step_results: stepResults,
      captures_summary: Object.fromEntries(
        Object.entries(captures).map(([k, v]) => [k, previewJson(v, 200)])
      ),
    },
    records_written: recordsWritten,
  };
}

// =========================================================================
// Composio HTTP client (inline — does not import _shared/composio.ts so
// this Edge Function is self-contained on deploy)
// =========================================================================

async function callComposio(tool: string, args: any): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(COMPOSIO_EXEC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": COMPOSIO_API_KEY,
      },
      body: JSON.stringify({ tool_slug: tool, arguments: args }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(`Composio fetch failed (${tool}): ${err?.message ?? err}`);
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Composio HTTP ${resp.status} (${tool}): ${txt.slice(0, 500)}`);
  }
  const json = await resp.json();
  if (json?.successful === false) {
    throw new Error(
      `Composio tool ${tool} returned successful=false: ${
        json?.error ?? JSON.stringify(json).slice(0, 400)
      }`,
    );
  }
  return json;
}

// =========================================================================
// Template / capture resolution
// =========================================================================

/**
 * Replace {{ path.to.value }} in a string with the resolved value from captures.
 * Single-token references ({{ x }}) return the raw value (object/array/etc).
 * Multi-token strings interpolate string form of each value.
 */
function renderTemplate(input: string, captures: Record<string, any>): string {
  if (typeof input !== "string") return input;
  // If the whole input is a single {{ ... }} reference, return the raw value
  const wholeMatch = input.match(/^\{\{\s*([\w.\[\]]+)\s*\}\}$/);
  if (wholeMatch) {
    const val = lookupPath(captures, wholeMatch[1]);
    return typeof val === "string" ? val : JSON.stringify(val);
  }
  return input.replace(/\{\{\s*([\w.\[\]]+)\s*\}\}/g, (_, path) => {
    const v = lookupPath(captures, path);
    return v == null ? "" : (typeof v === "string" ? v : JSON.stringify(v));
  });
}

/** Recursively resolve templates inside any data structure. */
function resolveDeep(node: any, captures: Record<string, any>): any {
  if (node == null) return node;
  if (typeof node === "string") {
    const wholeMatch = node.match(/^\{\{\s*([\w.\[\]]+)\s*\}\}$/);
    if (wholeMatch) return lookupPath(captures, wholeMatch[1]);
    return renderTemplate(node, captures);
  }
  if (Array.isArray(node)) return node.map((n) => resolveDeep(n, captures));
  if (typeof node === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolveDeep(v, captures);
    return out;
  }
  return node;
}

function lookupPath(root: any, path: string): any {
  const parts = path.split(/[.\[\]]+/).filter(Boolean);
  let cur: any = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// =========================================================================
// LLM response parsing
// =========================================================================

function extractLlmText(resp: any): string {
  const root = resp?.data?.data ?? resp?.data ?? resp;
  // Composio's groq_chat tool typically returns { choices: [{ message: { content } }] }
  const c = root?.choices?.[0]?.message?.content
    ?? root?.message?.content
    ?? root?.content
    ?? root?.text
    ?? "";
  return typeof c === "string" ? c : JSON.stringify(c);
}

function safeJsonParse(s: string): any {
  if (!s) return null;
  const stripped = s.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  try { return JSON.parse(stripped); }
  catch {
    // Try to find the first JSON object/array in the string
    const m = stripped.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) {
      try { return JSON.parse(m[1]); } catch { /* fall through */ }
    }
    return { _parse_failed: true, raw: stripped.slice(0, 500) };
  }
}

// =========================================================================
// Misc helpers
// =========================================================================

function firstOfThisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function previewJson(v: any, max: number): any {
  try {
    const s = JSON.stringify(v);
    if (s.length <= max) return v;
    return { _truncated: true, preview: s.slice(0, max) + "..." };
  } catch {
    return String(v).slice(0, max);
  }
}

function jsonResponse(status: number, body: any): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
