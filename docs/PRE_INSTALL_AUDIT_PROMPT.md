# Pre-Install Audit Prompt — Fresh Context Reviewer

**Purpose:** A reusable, copy-pasteable prompt for kicking off a fresh-context Claude session to audit the IA BCC master template before pushing to a client repo. The goal is to catch issues that the build session was too close to the code to see.

**When to use:**
- Before pushing the master template to any client''s GitHub for the first time
- After any major master-template refactor (e.g., parser Drive wiring, new module category)
- When you want a sanity check that the install playbook actually works for someone who isn''t already in your head

**How to use:**
1. Open a fresh Claude.ai chat (new conversation, no project)
2. Make sure the chat has Supabase MCP + GitHub via Composio connected
3. Copy everything in the **PROMPT** section below and paste as your first message
4. Let it run; review the report it produces
5. Discuss findings with Rebecca; fix the ones that matter; re-push

---

## PROMPT — copy from here

You are an independent pre-install code reviewer for the IA BCC master template at `cindarellabots-droid/SMBBCC-Imaginary-AI`. Your job is to find issues a setup technician would hit before they hit them. You are NOT the original author. Read the repo cold.

### Context you may use
- Master template is install-ready for the first client install (Jay Trudeau, Tier 3 Premium, 12 entities, currently uses QuickBooks Desktop with external bookkeeper)
- Setup Technicians named Darian and Katha will run installs from this repo
- IA Supabase project (operational, NOT a client BCC instance): `thtzapanliqgvjzldylh`
- All GitHub operations route through Composio (account `cindarellabots-droid`)

### Step 0 — Load operating context
Before reading any repo files, query IA Supabase:

```sql
SELECT get_operating_context(''main'');
```

Read the returned `operational_rules` carefully — especially anything tagged `infrastructure_status`, `process`, or `pre_install_audit`. These tell you what was already verified and what was deliberately deferred. They do NOT exempt you from re-verifying — they orient you.

### Step 1 — Read canonical sources of truth FIRST
Before reading any install doc or marketing-style file, read these source-of-truth files:

- `supabase/functions/automation-runner/README.md` + `automation-runner/index.ts`
- `supabase/functions/email-ingest/README.md` + `email-ingest/index.ts`
- `supabase/functions/parser/README.md` + `parser/index.ts`
- `supabase/functions/_shared/drive_download.ts` + `composio.ts` (these have caused doc-vs-code inversions in the past — never trust the README without checking the .ts file)
- All migration files in `migrations/` (001 through the highest-numbered)
- `src/lib/hooks.js`, `src/lib/utils.js`, `src/lib/supabase.js` (what is actually exported)
- `src/index.css` (what CSS classes actually exist)
- `tailwind.config.js` (what color tokens are defined)
- `package.json` (what framework — Vite vs Next.js — and what dependencies)

**Critical operating rule #1:** Always fetch the current HEAD version of any file you reason about. Never assume the file in working memory matches what is on `main`. Commits land between sessions.

**Critical operating rule #2:** READMEs can drift from the code they describe. If a README says "this is a stub" or "this is deferred," **open the actual source file (.ts / .py / .jsx) before believing the README**. The 2026-06-16 audit caught a case where `parser/README.md` claimed Drive download was stubbed, but the underlying `_shared/drive_download.ts` had been wired 40 minutes after the README was last edited. The prior audit trusted the README and cascaded the stale claim into multiple downstream docs + an `agent_memory` operational_rule. Don't repeat that. **Source code is the ground truth; READMEs are at best a lagging indicator.**

### Step 1.5 — Mechanical doc-vs-code grep sweep
Before deep-reading any docs, run these mechanical checks across every `.md`, `.sql`, and `.jsx` file in the repo. Any hit is a candidate finding — confirm against current source before classifying severity.

Patterns that have caused real bugs in past audits (extend this list as new patterns surface):

| Grep pattern | What a hit means | Verify against |
|---|---|---|
| `Next.js` | Possibly stale — repo is Vite. Only legit hits are explicit negations ("not Next.js") | `package.json` |
| `from \`/web\`` or `web/` | Possibly stale — repo has no `/web` directory | repo root file listing |
| `PARSER_SECRET\b` (not `PARSER_WEBHOOK_SECRET`) | Wrong secret name | `parser/index.ts` |
| `Nine modules\|Nine Modules` | Stale module count — actual is 11 | `BCCApp.jsx` route table |
| `001-003\|001 → 002 → 003\|migrations 001-003` | Stale migration count — actual is 14 | `migrations/` directory listing |
| `stub\|stubbed\|TODO stub` near `drive_download\|parser\|email-ingest` | Possibly stale — parser/email-ingest are fully wired | actual `.ts` source |
| `handoff-reminder-dispatcher` | Descoped — verify reference is a negation, not an instruction | `supabase/functions/` directory listing |
| `every minute` near `pg_cron\|automation-runner` | Stale — actual cron is `*/5 * * * *` | `automation-runner/README.md` Step 3 |
| `confidence_default` on `email_sender_map` | Column doesn't exist in migrations | `migrations/003_*.sql` |
| `client_context.entities\|WHERE id = 1` on `client_context` | Wrong column — PK is `client_id TEXT DEFAULT 'main'`; entities are in their own table | `migrations/001_*.sql` |
| `TODO in v1\|STUB in v1\|STUBBED in v1` | Code-level lag — feature shipped but comments still say stubbed | actual source file at HEAD |
| `blocked on` near `drive download\|drive wiring` | Stale — drive_download wired since 2026-06-15 commit d4d6d429 | `_shared/drive_download.ts` |
| `Email Archiver recipe\|Email Archiver` | Stale — that COMPOSIO recipe was replaced by `email-ingest` Edge Function | `supabase/functions/email-ingest/` |
| `5 starter templates\|5 templates` near `email_templates` | Stale — only `ingest_receipt` ships in v1; rest are bespoke | `migrations/003_*.sql` |
| `dispatcher armed\|handoff-reminder-dispatcher will fire` | Descoped — IA operator tracks T-5 externally | `supabase/functions/` directory listing |
| `monthly_close_progress\b` (not `_view`) | Bare table name is wrong — table is `monthly_close_checklist`, view is `monthly_close_progress_view` | `migrations/010_*.sql` |
| `Phase 5 (Automation Recipes)\|Apply during install Phase 5` | Stale phase reference — recipe seeds now applied at Phase 1.5 | `SKILL.md` |
| `All 9\|Nine modules included` near tier table | Stale tier-module count — actual is 11 | `BCCApp.jsx` route table |
| `clients\|pipeline_summary\|ambassadors\|recent_interactions` as expected keys of master template `get_operating_context` | Those keys are from the IA OPERATIONAL project's overridden version. Master template returns `client` (singular), `entities`, `install_progress`, `current_phase` | `migrations/001_core_schema.sql` |
| `{{[A-Z_]+}}` placeholders | Every placeholder MUST be defined in the same doc's variables table | search backward in doc for variables table |

Record each hit with file path and 1-line context. Move forward into Step 2; these candidates feed into the categorized findings.

### Step 1.6 — SKILL.md walk-through simulation
Headlines and grep sweeps don't catch *cross-document gaps* — where doc A says "X is a prereq" and doc B (the install playbook) never tells the tech how to do X. Open `SKILL.md` and walk through every phase as if executing the install. For each phase:

- Is every required action stated explicitly? (Not "configure the recipe" — actual SQL, actual command, actual file path?)
- Does the phase reference anything that should already exist? If yes, is there a prior phase that creates it?
- Would the smoke-test queries in `HANDOFF_PROMPTS.md` actually return non-empty results after this phase?

Past audits have surfaced this category of bug:
- Recipe seeds prereq existed in `AUTOMATIONS_INSTALL.md` but no SKILL.md phase actually applied them
- Drive folder IDs were referenced by `email-ingest` but no SKILL.md phase set `client_context.drive_folder_mappings`

A grep cannot find these. Only a mental simulation can.

### Step 2 — Audit categories
For each category, list any discrepancy with file path, line context, and severity (blocker / doc bug / visual / strategic note / clean).

**A. Documentation accuracy** — for each file in `docs/`:
- Does every claim match the canonical READMEs from Step 1?
- Are Vault secret names, payload shapes, deploy flags, cron schedules all correct?
- Any fabricated endpoints, made-up secret names, wrong cron syntax?

**B. Code-CSS-config consistency:**
- Every CSS class referenced in JSX exists in `index.css` or is a real Tailwind utility
- Every import path in every module resolves to a real file
- Every exported function/component used by modules actually exists in the lib/components
- Every Supabase table+column referenced in `useSupabaseQuery` queries actually exists in the migrations
- Every enum value referenced matches the migration''s enum definition

**C. Routing and module wiring:**
- `BCCApp.jsx` imports + routes + nav items match for all modules
- No orphan modules (file exists but not routed) or missing modules (routed but no file)

**D. Install playbook walkthrough — read like you''re Darian on day 1:**
- Open `SKILL.md` and walk through it step by step
- Note any step that says "do X" but lacks the actual command, value, or pointer to where to find it
- Note any internal contradiction (e.g., `CLAUDE.md` says one thing, `SKILL.md` says another)
- Note any place a tech would have to ask "what does this mean?" without sufficient context

**E. Known limitations explicitly documented:**
- Parser Drive download stub (`DriveDownloadNotWiredError`) — verify the KNOWN LIMITATION callout exists and is prominent in `docs/DOCUMENT_IMPORTER_GUIDE.md`
- ⛔ STOP banner about LLM API keys — verify it appears in all 8 documented files (SKILL.md, CLAUDE.md, README.md, HANDOFF_PROMPTS.md, docs/AUTOMATIONS_INSTALL.md, docs/DOCUMENT_IMPORTER_GUIDE.md, and the two recipe seed SQL files)
- Any other deferred / stubbed features that need callouts

**F. Big-picture cross-doc sanity check:**
- Read `CLAUDE.md`, `BUILD_ROADMAP.md`, `docs/IA_BCC_ARCHITECTURE.md`, `NEXT_SESSION.md`, `README.md`
- Do they agree with each other on what is shipped and what is pending?
- Do they agree on file paths, environment variable names, secret names, and Edge Function URLs?

### Step 3 — Produce a categorized findings report
Use these tiers:
- ✅ Clean — checks that passed; brief list
- 🟢 Strategic note — no action needed but worth knowing
- 🟡 Visual / minor — fix before push, not a blocker
- 🟠 Doc bug — would mislead the tech but not crash anything
- 🔴 Blocker — would cause install failure if a tech follows the doc literally

For each non-clean item: file path, the specific issue, the canonical/correct value, recommended fix.

### Step 4 — Log findings to IA Supabase
Insert a session_note into `thtzapanliqgvjzldylh.agent_memory` with the full findings:

```sql
INSERT INTO agent_memory (agent_id, memory_type, content, metadata)
VALUES (
  ''main'',
  ''session_note'',
  ''[your structured findings here]'',
  jsonb_build_object(
    ''rule_category'', ''pre_install_audit_external'',
    ''session_date'', ''[today]'',
    ''audit_type'', ''fresh_context_review'',
    ''head_sha_audited'', ''[the HEAD SHA you audited]'',
    ''blockers_found'', [N],
    ''doc_bugs_found'', [N],
    ''visual_issues_found'', [N]
  )
);
```

### Step 5 — Report back in chat
A concise summary to the operator:
- HEAD SHA you audited
- Counts per severity tier
- Top 3-5 most important findings
- Your honest take: is this ready to push to a real client, with or without further fixes?

### Explicit non-goals
- Do not attempt to actually run the install
- Do not modify any files in the repo (your job is to find, not fix — fixes are a separate session with full context)
- Do not push back on architectural decisions — flag inconsistencies and bugs only
- Do not assume prior audits caught everything — re-verify

### Done criterion
- You walked through all five steps
- You produced a categorized report
- You logged a session_note to IA agent_memory
- You reported summary to the operator

**If you find zero issues, say so explicitly.** Zero is a real finding. It tells the operator the repo is genuinely clean from a fresh-eyes perspective, which is the best possible outcome of this audit.

---

## Pasted prompt ends here — back to docs

After the audit returns:

1. Read the findings report yourself
2. For any 🔴 blocker or 🟠 doc bug: fix in a follow-up commit
3. For 🟡 visual issues: judgment call; usually worth fixing if the cost is low
4. For 🟢 strategic notes: log to `agent_memory` as future-roadmap items if they''re worth tracking
5. Once findings are addressed (or accepted as non-issues), the master is cleared to push to the client repo

### Notes on reusing this prompt

This prompt is intentionally scoped to the **master template**, not a specific client install. It will work without modification for:
- Pre-push audit before the second multi-entity client
- Pre-push audit after parser Drive wiring lands
- Pre-push audit after any major refactor

The prompt does NOT need to be re-edited per install. Just open a new Claude chat, paste, run.
