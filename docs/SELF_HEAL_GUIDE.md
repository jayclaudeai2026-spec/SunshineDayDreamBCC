# Self-Heal Guide

What to do when `system_alerts` raises something. Organized by severity, then by category, with a recovery runbook for each common case.

The principle: not every alert means something is broken in code. Some alerts are the BCC doing its job — surfacing a real business problem (overdue tax, missing payroll report) that needs the owner's attention. Distinguish "the system is broken" from "the system is correctly telling you something is wrong."

---

## Severity tiers, in plain language

| Severity | What it means | Response time |
|---|---|---|
| `critical` | Something is broken AND impacting the owner right now (e.g., ingest pipeline completely down) | Same hour |
| `error` | Something failed; data may be stale or missing, but the BCC isn't down | Same business day |
| `warning` | Heads-up signal — overdue threshold approaching, recipe success rate dropping, etc. | Within a few days |
| `info` | Informational — recipe ran, doc landed, milestone hit | No action needed |

If you see `info` alerts piling up unread, that's fine. They're not asking for anything.

---

## Category-by-category runbook

### Ingest failures (`category = 'ingest'`)

#### `critical`: "ingest pipeline down for >2h"

**What raised it:** `system_status_refresh` ran but `system_status.last_ingest_received_at < NOW() - INTERVAL '2 hours'` and entities have active senders.

**Diagnosis:**
1. Send a test email to the intake address. Wait 60 seconds.
2. Check `ingest_log` for a new row.
3. If no row: Composio Gmail trigger is down. Go to `app.composio.dev` → Triggers → check status.
4. If a row but `parse_result = 'failed'`: parser is failing. Check parser function logs.

**Recovery:**
- If trigger is offline, re-enable it in Composio. May require re-auth of the Gmail connection.
- If parser is failing systemically: check the most recent failed `ingest_log.error_message` — usually a Composio rate limit or a transient Drive API hiccup. If transient, retries will catch up.

#### `error`: "single email failed to parse"

**What raised it:** A single `ingest_log` row went to `parse_result = 'failed'`.

**Diagnosis:** Read the `error_message` on the row. Common causes:
- Attachment is corrupted/empty (sender's email client did something weird)
- Drive upload hit a quota (transient — retry in an hour)
- LLM classification call timed out (transient)

**Recovery:**
- Most are transient. The next run of `system_status_refresh` will surface "stale" again if it persists.
- For corrupted attachments, manually save what you can and mark the `ingest_log` row resolved.

#### `warning`: "parser pending count > 5"

**What raised it:** Backlog forming.

**Diagnosis:** Look at `ingest_pipeline_health_view`. Which entity has the backlog?

**Recovery:** Usually resolves on its own as the parser catches up. If it grows over a day, investigate parser performance — usually an LLM call is slow, or a particular attachment type is timing out.

---

### Automation runner failures (`category = 'automation'`)

#### `critical`: "automation_runner not reachable for >30min"

**What raised it:** Multiple recent pg_cron ticks failed to invoke the function (or invoked but got 5xx).

**Diagnosis:**
1. Check Supabase Edge Function logs for `automation-runner`. Recent errors?
2. Check pg_cron job status: `SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'automation-runner-tick') ORDER BY start_time DESC LIMIT 10;`

**Recovery:**
- Function is crashing on every invocation: usually a missing Vault secret or a recent deploy that broke something. Redeploy the prior known-good version or fix the bug.
- Function is fine but cron isn't calling it: pg_cron extension may have been disabled. Re-enable: `SELECT cron.schedule(...)` again.

#### `error`: "recipe <key> failed N consecutive times"

**What raised it:** Same recipe failed N runs in a row (threshold is in the recipe's notes).

**Diagnosis:** Look at the latest `automation_runs` rows for that recipe. The `error_message` will be specific.

**Common failures and fixes:**
| Error message contains | Fix |
|---|---|
| "401" or "unauthorized" | COMPOSIO_API_KEY wrong or revoked. Reset in Vault, redeploy. |
| "tool not connected" | The Composio toolkit needs to be connected for this user. Connect it. |
| "rate limit" | Reduce recipe frequency or contact Composio support. Usually self-resolves. |
| "function does not exist" | Postgres function the INTERNAL handler references is missing. Re-apply the relevant migration. |
| "column ... does not exist" | Schema drift. Run `tools/schema-audit.js` and fix the migration mismatch. |

**Recovery:** Disable the recipe (`is_active = FALSE`) while you fix it. Don't leave broken recipes active — every failure raises another alert and clutters the queue.

#### `warning`: "recipe <key> success rate < 80% over 7 days"

**What raised it:** Recipe is technically still working sometimes but has gotten flaky.

**Recovery:** Same root-cause investigation as the critical case, but less time pressure. Often this points at an upstream service (Composio, LLM API) having intermittent issues.

---

### Composio connection failures (`category = 'composio'`)

#### `error`: "Composio toolkit '<x>' disconnected"

**What raised it:** A scheduled recipe tried to use the toolkit and got back "not connected."

**Diagnosis:** Go to `app.composio.dev` → Connections → find the toolkit. Look at its status.

**Recovery:** Re-authenticate. For Gmail/Drive, this usually means re-doing the OAuth flow. Once reconnected, recipes resume on the next tick.

---

### Schema drift (`category = 'schema'`)

#### `error`: "schema-audit found N discrepancies"

**What raised it:** `tools/schema-audit.js` was run (manually or in CI) and found a column missing, an enum value missing, or a view definition not matching the source.

**Recovery:**
1. Read the audit output for specifics.
2. Identify whether the master template needs to change, or this client's project needs a corrective migration.
3. If it's a master-template issue, fix in the master and propagate. If it's a per-client drift (someone applied a hotfix in Studio), write a corrective migration and apply.

**Prevention:** Don't apply ad-hoc DDL in Studio for client projects. Always go through a migration file so the drift doesn't happen.

---

### Tax obligations (`category = 'tax'`)

#### `warning`: "tax obligation due in 14 days"
#### `error`: "tax obligation overdue"

**What raised it:** Recipes 02 and 02b (`tax_calendar_due_soon` and `tax_calendar_overdue`) marked rows and raised alerts.

**This is not a system failure.** This is the BCC correctly telling the owner there's a tax deadline. The "recovery" is the owner taking action with their CPA — or you confirming the date is wrong and updating `tax_calendar`.

**Common false alarms:**
- The owner's CPA filed the return but didn't tell anyone, so `filed_date` is still null. Update the row.
- An extension was filed but `extension_filed = FALSE` and `extension_until` is null. Update the row.
- The obligation is `n_a` for this entity (e.g., a holding LLC that doesn't owe sales tax). Set status to `n_a` so it stops appearing.

---

## When in doubt: the universal triage

For any unfamiliar alert:

1. **Read the alert's `message`, `category`, and `context` JSONB.** The context usually contains entity_id, recipe_key, or another locator.
2. **Find the underlying row** in the related table (e.g., `automation_runs`, `ingest_log`, `tax_calendar`) and read its full record.
3. **Decide: real problem or system noise?**
4. **If real:** fix the underlying cause, mark the alert resolved with a resolution_note explaining what you did.
5. **If noise:** mark it acknowledged (not resolved) so it stops nagging but stays in the record for pattern analysis.

The Ack/Resolve distinction matters: Ack = "I've seen this, I don't need to act on it." Resolve = "I fixed something." Future you (or Darian/Katha looking at the queue) will appreciate the difference.

---

## Escalation: when to bring Rebecca or the client in

| Situation | Who to involve |
|---|---|
| Critical alert that persists >30 minutes after your first attempt to fix | Rebecca — could be a master-template issue |
| Recipe needs functional change (not just a config fix) | Rebecca — schedule a master-template update |
| Tax obligation alert that turns out to be a real missed deadline | The client — they need to know |
| Schema audit finds drift that suggests another technician applied an ad-hoc fix | Both you and Rebecca — establish what happened and prevent recurrence |
| Composio API or Supabase platform appears to be having a wider outage | Rebecca, then watch the providers' status pages |

The goal is for routine alerts to resolve quickly (you, on your own), and for system-level issues to surface to Rebecca early so the master template can be improved for everyone.
