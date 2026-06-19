// automation_runner / index.ts
// MVP v1 — Sunshine Daydream BCC automation runner.
//
// Modes:
//   { "mode": "poll" }                  -- pg_cron entrypoint; runs all due active recipes
//   { "mode": "run", "recipe_key":"X" } -- manual single-recipe trigger
//   { "mode": "ping" }                  -- liveness check (no auth)
//
// Auth: Bearer <secret> where secret is stored in vault as automation_runner_webhook_secret
//       and exposed via public.get_webhook_secret(secret_name) RPC.
// verify_jwt=false on deploy.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { runPoll, runRecipe, validateWebhookSecret } from "./runner.ts";

const VERSION = "v2";

Deno.serve(async (req: Request) => {
  let body: Record<string, unknown> = {};
  try {
    const txt = await req.text();
    if (txt.trim().length > 0) body = JSON.parse(txt);
  } catch (_e) {
    return errJson("invalid JSON body", 400);
  }
  const mode = String(body.mode ?? "poll");

  // ping: no auth, just proof of life
  if (mode === "ping") {
    return okJson({ ok: true, time: new Date().toISOString() });
  }

  // Webhook secret auth for everything else
  const ok = await validateWebhookSecret(req.headers.get("Authorization"));
  if (!ok) return errJson("unauthorized", 401);

  try {
    if (mode === "poll") {
      const r = await runPoll();
      return okJson(r);
    }
    if (mode === "run") {
      const recipeKey = body.recipe_key as string | undefined;
      if (!recipeKey) return errJson("recipe_key required for mode=run", 400);
      const r = await runRecipe(recipeKey, String(body.triggered_by ?? "manual"));
      return okJson(r);
    }
    return errJson(`unknown mode: ${mode}`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[automation_runner] fatal:", msg, stack);
    return errJson(msg, 500);
  }
});

function okJson(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ version: VERSION, ...payload }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
function errJson(message: string, status: number): Response {
  return new Response(JSON.stringify({ version: VERSION, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
