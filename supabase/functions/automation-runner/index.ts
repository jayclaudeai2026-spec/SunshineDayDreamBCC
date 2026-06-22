// automation_runner / index.ts v5.1
// ---------------------------------------------------------------------------
// Thin HTTP dispatcher for the runner. All recipe execution logic lives in
// ./runner.ts. This file just authenticates the webhook and routes:
//   mode=ping  -> health check, no auth
//   mode=poll  -> sweep due recipes from automation_recipes (used by pg_cron)
//   mode=run   -> execute a single recipe by recipe_key (used by webapp /
//                 install playbook for one-off runs)
//
// AUTH: Authorization: Bearer <vault:automation_runner_webhook_secret>
// SECRET LOOKUP: validateWebhookSecret() -> rpc('get_webhook_secret', ...) (migration 019)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runPoll, runRecipe, validateWebhookSecret } from "./runner.ts";
const VERSION = "v5.1";
Deno.serve(async (req: Request) => {
  let body: Record<string, unknown> = {};
  try { const txt = await req.text(); if (txt.trim().length > 0) body = JSON.parse(txt); }
  catch (_e) { return errJson("invalid JSON body", 400); }
  const mode = String(body.mode ?? "poll");
  if (mode === "ping") return okJson({ ok: true, time: new Date().toISOString() });
  const ok = await validateWebhookSecret(req.headers.get("Authorization"));
  if (!ok) return errJson("unauthorized", 401);
  try {
    if (mode === "poll") return okJson(await runPoll());
    if (mode === "run") {
      const recipeKey = body.recipe_key as string | undefined;
      if (!recipeKey) return errJson("recipe_key required for mode=run", 400);
      return okJson(await runRecipe(recipeKey, String(body.triggered_by ?? "manual")));
    }
    return errJson(`unknown mode: ${mode}`, 400);
  } catch (e) { const msg = e instanceof Error ? e.message : String(e); console.error("[automation_runner] fatal:", msg); return errJson(msg, 500); }
});
function okJson(payload: Record<string, unknown>): Response { return new Response(JSON.stringify({ version: VERSION, ...payload }), { status: 200, headers: { "Content-Type": "application/json" } }); }
function errJson(message: string, status: number): Response { return new Response(JSON.stringify({ version: VERSION, error: message }), { status, headers: { "Content-Type": "application/json" } }); }
