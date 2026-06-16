# NEXT_SESSION.md — Pre-Jay audit complete. Next: Jay Trudeau install.

**Repo:** `cindarellabots-droid/SMBBCC-Imaginary-AI`
**Current HEAD:** updated post-doc-sync commit (see latest git log).
**Status:** v1.0 install-ready + audit-passed

---

## Pre-Jay audit (2026-06-16)

Five commits since the docs commit (`32e4db4f`):

| Commit | What |
|---|---|
| `b7403040` | NEXT_SESSION.md handoff for Jay install (end of docs session) |
| `9e7c7b30` | ⛔ STOP banner added (pre-emptive fix for Groq/LLM API key confusion bleed) |
| `85b52559` | Pre-Jay audit fixes: 3 CSS bugs + 2 doc rewrites against canonical READMEs |
| `34493734` | STOP banner restored to two docs my audit-fix accidentally overwrote |

### What the audit caught

1. **26 broken CSS class references** in Commit C modules (SocialMedia, HRPeople, TaxCenter). Pills were referencing `ia-pill-active`, `ia-pill-warn`, `ia-pill-neutral` — names that don't exist in `index.css`. Fixed to `ia-pill-success`, `ia-pill-warning`, `ia-pill-muted`. Visual-only bug, not functional.
2. **`docs/AUTOMATIONS_INSTALL.md` was significantly wrong.** Vault secrets, cron tick payload, cron schedule, deploy flag, and a fabricated health endpoint. Rewritten against `supabase/functions/automation-runner/README.md` (the canonical source).
3. **`docs/DOCUMENT_IMPORTER_GUIDE.md` was wrong** in the same way. Email-ingest needs `EMAIL_INGEST_WEBHOOK_SECRET`; parser needs `PARSER_WEBHOOK_SECRET`; both need `--no-verify-jwt` on deploy. Rewritten against the function-folder READMEs.
4. **Parser is fully wired** — `_shared/drive_download.ts` was wired by commit `d4d6d429` on 2026-06-15 (40 minutes after parser/README.md was last edited, which is why the prior README + my docs both said it was stubbed). All three parser modes (test / poll / direct) populate `monthly_pl`, `monthly_balance_sheet`, `gl_entries_archive` from CSVs landing via email-ingest. `DOCUMENT_IMPORTER_GUIDE.md` now reflects this end-to-end.

### What the audit verified clean

- BCCApp routing wires all 11 modules correctly
- All component imports across all 11 modules resolve
- All schema column references in Commit B/C modules match migrations
- All enum value references match migration enum definitions
- Tailwind config has every `ia-*` color the modules use

---

## Strategic direction (logged to Supabase agent_memory — see superseding rule)

**The BCC is built to be the destination for the client's financial books from install day one.** CSVs flowing through email-ingest are parsed end-to-end into `monthly_pl`, `monthly_balance_sheet`, and `gl_entries_archive`. The Financials module reads directly from those tables.

**Client framing (Jay Trudeau and similar QBD users):**
- BCC and QBD run in parallel during a confidence period — the client (and their bookkeeper) can compare BCC reports against QBD reports
- As alignment is verified, QBD becomes optional; BCC becomes canonical
- The bookkeeper's role shifts from data entry to oversight/review on the same CSVs they're already producing
- No timeline pressure — the owner sets the pace

**Near-term build priorities (no longer parser wiring — that's done):**
1. **Reconciliation tooling** — surface differences between BCC's parsed output and bookkeeper QBD output, so owners can verify alignment with confidence. Module category not yet scoped; likely a Financials sub-view with LLM-assisted variance review.
2. **QBD → BCC migration playbook** — a per-client doc covering the transition arc, written when reconciliation tooling is mature enough to back it up.

---

## Next session: Jay Trudeau install

When Bank of America credentials arrive and Stripe activates, Jay's payment posts and the install can begin. Rebecca trusts Jay (long-time client) so the build can proceed in parallel with payment; deployed BCC is NOT handed off until payment clears.

### Jay-specific context

- Founding Ambassador: 30% commission grandfathered; first 3 paid referrals NO commission (recoups $3,000 founder discount); single-payer
- Tier 3 Premium at founder rate $2,995
- Sunshine Daydream Group — 12 entities (mostly real-estate holding LLCs, one or two operating)
- Intake email: `jayclaudeai2026@gmail.com` (provisioned)
- Bookkeeping: QBD with external bookkeeper. BCC populates financial tables from the bookkeeper's CSVs from install day one. QBD runs in parallel during a confidence period; client sets the pace on transition.
- GitHub: `cindarellabots-droid` already invited as collaborator on Jay's GitHub. Push master to `<jay-org>/sunshine-daydream-bcc` once Supabase project is provisioned.

### Install playbook (high-level — full detail in `SKILL.md`)

1. Provision `sunshine-daydream-bcc` Supabase project
2. Push master template to Jay's GitHub via existing collaborator access
3. Apply migrations 001–014 (`supabase db push --project-ref <ref>`)
4. Apply recipe seeds (`for f in supabase/recipe_seeds/*.sql; do psql "$DB_URL" -f "$f"; done`)
5. Seed `client_context` with Jay-specific values (display_name="Sunshine Daydream", owner_email, intake_email, tier="tier_3", variant="premium_desktop", founder_client=TRUE, brand_palette)
6. Seed 12 `entities` rows — request legal name + EIN + primary state per entity from Jay
7. Wire Composio integrations:
   - Gmail trigger on intake email with `EMAIL_INGEST_WEBHOOK_SECRET` bearer
   - Drive toolkit with edit access to BCC root folder
   - Social toolkits only if Jay wants social posting
8. Set up Drive folders per `docs/DRIVE_FOLDER_SETUP.md` multi-entity layout. Capture IDs into `client_context.drive_folder_mappings`.
9. Deploy 3 Edge Functions with `--no-verify-jwt`: email-ingest, parser, automation-runner
10. Set Vault secrets: `COMPOSIO_API_KEY`, `AUTOMATION_RUNNER_SECRET`, `EMAIL_INGEST_WEBHOOK_SECRET`, `PARSER_WEBHOOK_SECRET`
11. Enable `pg_cron` + `pg_net`; register the 5-minute tick job for automation-runner with `{mode: "due"}` payload
12. Set up `tax_entity_profiles` per entity (mostly 1065 for holding LLCs)
13. Smoke test: send a test email through intake; confirm document lands in correct Drive folder + creates a `documents` row
14. Activate desired COMPOSIO recipes with `[INSTALL TIME]` placeholder replacement
15. **Verify parser end-to-end** — send a test CSV through intake email; confirm it reaches `monthly_pl` / `monthly_balance_sheet` / `gl_entries_archive` via `parse_result='pending' → 'success'`. Brief Jay that BCC and QBD will run in parallel; he sets the pace on leaning on BCC reports.
16. Hand off to Jay's Claude.ai project for ongoing customization

Estimated install time: **8–12 hours focused work** across 2–3 sessions.

### Who runs this install

Rebecca solo, with Darian or Katha shadowing as their first install training (pair-style). Tier 1/Tier 2 SMB installs from the next pipeline client can be the solo-tech training ground.

---

## Roadmap after Jay

Priority order:

1. **Reconciliation tooling** — surface BCC-vs-QBD/QBO variance for the parallel-run confidence period. Module shape TBD; likely a Financials sub-view with LLM-assisted variance review queue. This is the highest-leverage next build because it accelerates QBD retirement across every QBD-with-bookkeeper client.
2. **Second multi-entity client acquisition + install** — proves Jay's install wasn't a one-off. Validates the install playbook from Darian/Katha solo execution.
3. **QBD → BCC migration playbook** — per-client guide covering the transition arc, written once reconciliation tooling is real enough to back it up.
4. **PRE_INSTALL_AUDIT_PROMPT enhancements** — bake in the doc-vs-code grep checks (S1) and the "verify source code, not just READMEs" lesson the 2026-06-16 audit surfaced.

---

## Operating conventions (continuing, no changes)

- All GitHub ops via Composio (`cindarellabots-droid` account)
- Atomic commits via Git Data API: blob → tree (with `base_tree`) → commit → fast-forward ref
- **Before rewriting any file**, fetch the current HEAD version first. Don't assume in-memory copies match. (Lesson from the STOP-banner overwrite.)
- Supabase agent_memory is the live source of truth for operational rules
- IA Supabase: `thtzapanliqgvjzldylh`. IF Supabase: `olxgwlevvjvebgecqhru`. Never cross-insert.
