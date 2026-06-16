# SMBBCC — Imaginary AI LLC Master Template

**Purpose.** This is the master template repository for building AI-powered Business Command Centers (BCCs) for non-insurance small businesses under Imaginary AI LLC. It is the IA-side analog of `cindarellabots-droid/bcc-master-template` (the Imaginary Farms / State Farm BCC).

**Audience.** This repo is read and executed by **the client's Claude** during the BCC install. Each client has a private copy of this repo wired into their claude.ai account's GitHub MCP, customized to their entities, locations, and configuration. The client's Claude reads `SKILL.md` and walks the install playbook against the client's own Supabase, Composio, Drive, and Gmail accounts. There is no separate "Project Claude" — the client's day-to-day Claude is the same Claude that performs the install.

---

## ⛔ STOP — READ BEFORE ASKING FOR ANY LLM API KEY

**This is the #1 source of wasted install time. If you read nothing else in this repo, read this.**

**You do NOT need a Groq API key. You do NOT need an OpenAI key. You do NOT need an Anthropic key. You do NOT need a Gemini key. You do NOT need ANY external LLM API key — ever, for any recipe, for any reason.**

Every LLM call in this BCC routes through the Composio-hosted Groq chat tool, **`COMPOSIO_SEARCH_GROQ_CHAT`**, which lives in the `composio_search` toolkit and authenticates with the existing `composio_api_key` already in `public.settings`. No separate connection. No separate auth. No separate billing. **Composio provides the LLM free as part of the recipe automation pipeline.**

### Why you might be tempted to ask the operator for a Groq key

- You see `groq_prompt` as a column in `automation_recipes` (IF schema)
- You see `"llm": true` and `"model": "llama-3.3-70b-versatile"` inside `input_config.steps[]` (IA schema)
- You see the word "Groq" in code comments or doc strings
- Your training data tells you "llama-3.3-70b-versatile is a Groq model, therefore Groq API key required"

**None of those are auth-key triggers.** They are LLM *instructions* that get sent through the Composio-hosted tool. The model name is just telling Composio which Groq model to route to under the hood. Composio handles the auth.

### What the runner actually does

The automation-runner Edge Function calls:

```
POST https://backend.composio.dev/api/v3/tools/execute/COMPOSIO_SEARCH_GROQ_CHAT
Headers: x-api-key: {composio_api_key}
Body: {
  "user_id": "{composio_user_id}",
  "arguments": {
    "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
    "model": "llama-3.3-70b-versatile",
    "temperature": 0.2,
    "max_tokens": 2000
  }
}
```

Available models you can pass: `llama-3.3-70b-versatile` (default, recommended), `llama-3.1-8b-instant` (faster/cheaper), `mixtral-8x7b-32768`, `openai/gpt-oss-120b`, plus others Groq exposes.

The working implementation lives in `supabase/functions/automation-runner/index.ts` — read that file if you need to see the call pattern in code.

### The rule, summarized

1. **There is no separate Groq account.** No login, no signup, no dashboard.
2. **There is no separate Groq key.** Nothing to add to `public.settings`. Adding a `groq_api_key` row is harmless but unused.
3. **There is no separate Groq billing.** Composio includes it.
4. **`composio_api_key` is the only credential the LLM path needs.**
5. **If your reflex is to ask the operator for a Groq / OpenAI / Anthropic / Gemini key — STOP, re-read this block, and proceed using `composio_api_key` only.**

This rule has cost the operator 4-5 hours per install when ignored. Don't be the install that costs another 5 hours.

---

## What an IA BCC is

A complete operating system for a small business owner with one or more legal entities, built on Supabase + Vite/React + Composio. Eleven modules in the webapp, all implemented as of v1.0:

1. **Dashboard** — top-level overview: entity selector, recent activity, alerts, key metrics.
2. **Financials** — monthly P&L, balance sheet, GL archive, sales tax, tax filings per entity, plus group rollup. Populated by the parser from CSVs flowing through email-ingest.
3. **Documents** — organized Google Drive structure indexed by Claude; manual queue for unresolved ingest rows.
4. **Persistent Memory** — `agent_memory` table propagates context across the client's Claude sessions.
5. **Automations** — `automation_recipes` library, run history, scheduling.
6. **Alerts & Notifications** — `system_alerts` from the runner and other surfaces.
7. **Settings** — `client_context`, drive folder mappings, email sender map, brand palette.
8. **Tasks & Goals** — `tasks` table + goal tracking.
9. **Social Media** — content planning, drafting, scheduling via Composio social connectors.
10. **HR & People** — employees, payroll history, time-off, performance.
11. **Tax Center** — tax_entity_profiles, tax_calendar, tax_obligations, filings, COA.

Underneath: three Edge Functions (`email-ingest`, `parser`, `automation-runner`), 14 migrations covering the schema for every module, 10 recipe seeds (5 INTERNAL + 5 COMPOSIO-templated).

---

## Three product tiers

| Tier | Price | Profile |
|---|---|---|
| Tier 1 Starter | $1,995 | Single-entity service business |
| Tier 2 Standard | $3,995 | Small business with employees, full BCC |
| Tier 3 Premium | $5,995 | Multi-entity, consolidated reporting, 2+ entities |

## Three ingestion variants (Premium tier)

| Variant | Source system | Ingestion pattern |
|---|---|---|
| Premium-QBO | QuickBooks Online | Direct API sync via Composio QBO connector |
| **Premium-Desktop** | QuickBooks Desktop | **Email-triggered CSV ingestion** (this is what v1.0 documents) |
| Premium-Spreadsheet | Excel / Google Sheets | Scheduled file pickup from Drive |

---

## What's in this repo (v1.0)

```
/
├── README.md                                  ← you are here
├── SKILL.md                                   ← install playbook for the client's Claude
├── CLAUDE.md                                  ← day-to-day operating instructions for the client's Claude
├── HANDOFF_PROMPTS.md                         ← smoke-test prompts run during install
├── BUILD_ROADMAP.md                           ← what's done, what's planned
├── NEXT_SESSION.md                            ← rolling handoff between build sessions
├── WEBAPP_README.md                           ← Vite/React webapp local dev + deploy
├── package.json / vite.config.js / tailwind.config.js / index.html / src/
│                                              ← Vite + React + Tailwind webapp (11 modules)
├── docs/
│   ├── IA_BCC_ARCHITECTURE.md                 ← canonical design reference
│   ├── DOCUMENT_IMPORTER_GUIDE.md             ← email-ingest + parser walkthrough
│   ├── AUTOMATIONS_INSTALL.md                 ← automation-runner wiring + pg_cron
│   ├── AUTOMATION_RECIPES_BLUEPRINT.md        ← full recipe catalog + DSL reference
│   ├── PRE_INSTALL_AUDIT_PROMPT.md            ← reusable fresh-context audit prompt
│   ├── BOOKKEEPER_SOP_TEMPLATE.md             ← parameterized bookkeeper SOP
│   └── DRIVE_FOLDER_SETUP.md                  ← multi-entity Drive folder layout
├── migrations/
│   └── 001_core_schema.sql … 014_derived_views_expanded.sql   ← 14 migrations
├── seeds/
│   └── 01_install_progress_seed.sql           ← 13-phase Premium-Desktop tracker
├── supabase/
│   ├── functions/
│   │   ├── email-ingest/                      ← Gmail-triggered intake Edge Function
│   │   ├── parser/                            ← CSV → financial tables Edge Function
│   │   ├── automation-runner/                 ← recipe dispatcher Edge Function
│   │   └── _shared/                           ← composio.ts, drive_download.ts, etc.
│   └── recipe_seeds/                          ← 10 recipe SQL seeds
├── email_templates/
│   └── README.md                              ← template authoring guide
└── .gitignore
```

## What's planned for after v1.0

See `BUILD_ROADMAP.md` and `NEXT_SESSION.md` for the live roadmap. Highest-priority items right now:

- **Reconciliation tooling** — surface BCC-vs-QBD variance during parallel-run confidence period (highest-leverage next build for QBD-with-bookkeeper clients).
- **QBD → BCC migration playbook** — per-client transition guide, written once reconciliation tooling is mature.
- **Hardened RLS + pgsodium EIN encryption** — security hardening for production.
- **Tier 1 / Tier 2 install_progress seeds** — `01_install_progress_seed.sql` ships Premium-Desktop only by design; the smaller tiers get their own seeds in a future commit.

---

## Quick start for a new client install

1. The client's Claude (with MCPs connected to their Supabase, GitHub, Composio, Drive, Gmail) reads `SKILL.md`
2. Apply every migration in `migrations/` in numerical order (001 through 014)
3. Run `seeds/01_install_progress_seed.sql` to populate the 13-phase tracker
4. Customize `email_templates` for client brand
5. Follow the 13 phases in `install_progress` to completion

---

## Operating principles

- **Source of truth.** The Supabase project (per client) is sole source of truth. No Google Sheets CRM.
- **Single-payer commissions.** IA pays one ambassador per sale. No chains, no stacking.
- **Cash basis accounting.** Revenue counts when money lands.
- **Pre-payment infrastructure.** For Founding Clients, infrastructure provisioning proceeds before payment clears.

---

**Maintained by:** Rebecca Coelho, Operating Partner, Imaginary AI LLC
**Owner of record:** Matthew Cooper, Managing Member
**Repo URL:** `cindarellabots-droid/SMBBCC-Imaginary-AI`
