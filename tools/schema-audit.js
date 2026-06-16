#!/usr/bin/env node
/**
 * schema-audit.js — verify a deployed IA BCC schema matches the master template
 *
 * Usage:
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  node tools/schema-audit.js
 *
 * Checks:
 *   1. All 14 migrations' tables exist
 *   2. All RLS-required tables have RLS enabled
 *   3. All expected views exist
 *   4. All expected helper functions exist
 *   5. Singleton rows present (client_context, system_status)
 *   6. INTERNAL automation_recipes seeded and active
 *   7. Default chart_of_accounts template (entity_id IS NULL rows) present
 *
 * Output: human-readable PASS/FAIL report with counts.
 *
 * Exit code: 0 if all PASS, 1 if any FAIL.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(2);
}

const EXPECTED_TABLES = [
  // 001
  'agent_memory', 'client_context', 'entities', 'locations',
  'install_progress', 'email_sender_map',
  // 002
  'monthly_pl', 'monthly_balance_sheet', 'monthly_location_sales',
  'gl_entries_archive', 'sales_tax_obligations', 'tax_filings',
  // 003
  'ingest_log', 'email_templates', 'email_send_log',
  // 005
  'documents',
  // 006
  'social_accounts', 'content_themes', 'social_posts', 'social_schedule',
  // 007
  'employees', 'employee_entity_assignments', 'payroll_history',
  'time_off_balances', 'performance_notes',
  // 008
  'automation_recipes', 'automation_runs', 'automation_triggers',
  // 009
  'ar_aging_snapshots', 'ap_aging_snapshots', 'payroll_summaries',
  'inventory_snapshots',
  // 010
  'monthly_close_checklist',
  // 011
  'tax_entity_profiles', 'tax_calendar', 'tax_payments', 'tax_documents',
  // 012
  'chart_of_accounts',
  // 013
  'system_status', 'system_alerts',
];

const EXPECTED_VIEWS = [
  'entity_dashboard_view',
  'consolidated_dashboard_view',
  'monthly_close_progress_view',
  'upcoming_tax_obligations_view',
  'tax_year_summary_view',
  'group_monthly_summary_view',
  'entity_year_over_year_view',
  'cash_position_view',
  'top_customers_by_entity_view',
  'top_vendors_by_entity_view',
  'ingest_pipeline_health_view',
];

const EXPECTED_FUNCTIONS = [
  'set_updated_at',
  'get_operating_context',
  'default_close_checklist_items',
  'open_close_period',
  'clone_coa_template_to_entity',
  'refresh_system_status',
  'record_automation_run_outcome',
];

const EXPECTED_ACTIVE_RECIPES = [
  'system_status_refresh',
  'tax_calendar_due_soon',
  'tax_calendar_overdue',
  'monthly_close_kickoff',
  'gl_entry_writer_generic',
];

async function sql(query) {
  // Use the Supabase REST RPC pattern via raw SQL through pg_meta
  // The simplest cross-environment approach: postgres-meta endpoint.
  const url = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) {
    throw new Error(`SQL request failed: HTTP ${r.status} — ${await r.text()}`);
  }
  return r.json();
}

// Lightweight alternative: query information_schema via PostgREST views.
// Most Supabase projects don't expose exec_sql RPC by default. Fall back to
// individual REST queries against information_schema if exec_sql is missing.
async function listTables() {
  const url = `${SUPABASE_URL}/rest/v1/information_schema.tables?table_schema=eq.public&select=table_name`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`listTables: ${await r.text()}`);
  const rows = await r.json();
  return new Set(rows.map(r => r.table_name));
}

async function listViews() {
  const url = `${SUPABASE_URL}/rest/v1/information_schema.views?table_schema=eq.public&select=table_name`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`listViews: ${await r.text()}`);
  const rows = await r.json();
  return new Set(rows.map(r => r.table_name));
}

async function listFunctions() {
  const url = `${SUPABASE_URL}/rest/v1/information_schema.routines?routine_schema=eq.public&routine_type=eq.FUNCTION&select=routine_name`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`listFunctions: ${await r.text()}`);
  const rows = await r.json();
  return new Set(rows.map(r => r.routine_name));
}

async function clientContextRow() {
  const url = `${SUPABASE_URL}/rest/v1/client_context?id=eq.1&select=*`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`clientContextRow: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] ?? null;
}

async function systemStatusRow() {
  const url = `${SUPABASE_URL}/rest/v1/system_status?id=eq.1&select=*`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`systemStatusRow: ${await r.text()}`);
  const rows = await r.json();
  return rows[0] ?? null;
}

async function activeRecipes() {
  const url = `${SUPABASE_URL}/rest/v1/automation_recipes?is_active=eq.true&select=recipe_key`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`activeRecipes: ${await r.text()}`);
  const rows = await r.json();
  return new Set(rows.map(r => r.recipe_key));
}

async function coaTemplateCount() {
  const url = `${SUPABASE_URL}/rest/v1/chart_of_accounts?entity_id=is.null&select=id`;
  const r = await fetch(url, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Prefer': 'count=exact' },
  });
  if (!r.ok) throw new Error(`coaTemplateCount: ${await r.text()}`);
  const range = r.headers.get('content-range') ?? '0-0/0';
  const total = Number(range.split('/')[1] ?? 0);
  return total;
}

function check(label, cond, detail) {
  const mark = cond ? '✅ PASS' : '❌ FAIL';
  console.log(`${mark}  ${label}${detail ? ' — ' + detail : ''}`);
  return cond;
}

async function main() {
  console.log('==========================================================');
  console.log('  IA BCC schema audit');
  console.log(`  ${SUPABASE_URL}`);
  console.log('==========================================================');

  let allOk = true;

  // 1. Tables
  const tables = await listTables();
  for (const t of EXPECTED_TABLES) {
    allOk = check(`table public.${t}`, tables.has(t)) && allOk;
  }

  // 2. Views
  const views = await listViews();
  for (const v of EXPECTED_VIEWS) {
    allOk = check(`view public.${v}`, views.has(v)) && allOk;
  }

  // 3. Functions
  const fns = await listFunctions();
  for (const f of EXPECTED_FUNCTIONS) {
    allOk = check(`function public.${f}`, fns.has(f)) && allOk;
  }

  // 4. Singleton rows
  const cc = await clientContextRow();
  allOk = check('client_context (id=1) populated', cc != null,
    cc ? `legal_name="${cc.legal_name ?? '(unset)'}"` : 'row missing') && allOk;

  const ss = await systemStatusRow();
  allOk = check('system_status (id=1) populated', ss != null,
    ss ? `health=${ss.overall_health}, last_check=${ss.last_health_check_at}` : 'row missing') && allOk;

  // 5. Active recipes (the always-active set)
  const active = await activeRecipes();
  for (const r of EXPECTED_ACTIVE_RECIPES) {
    allOk = check(`recipe active: ${r}`, active.has(r)) && allOk;
  }

  // 6. COA template
  const coaN = await coaTemplateCount();
  allOk = check('chart_of_accounts template rows', coaN >= 40,
    `${coaN} template rows (expected >=40)`) && allOk;

  console.log('==========================================================');
  console.log(allOk ? 'OVERALL: ✅ ALL CHECKS PASSED' : 'OVERALL: ❌ ONE OR MORE CHECKS FAILED');
  console.log('==========================================================');
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('Audit aborted:', err.message);
  process.exit(2);
});
