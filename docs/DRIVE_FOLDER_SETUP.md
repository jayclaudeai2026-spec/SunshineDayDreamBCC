# Drive Folder Setup

This is the canonical Google Drive layout for every IA Business Command Center client. Set this up **before** wiring `email-ingest` — folder IDs flow into `client_context.drive_folder_mappings`, which the Edge Function reads directly when routing attachments.

## Why folders matter

Two reasons:

1. **The client's Claude.ai project will route incoming docs into the right folder automatically.** If folders don't exist with predictable names, Claude has nowhere to put a bank statement that just hit the intake email.
2. **The Documents module in the webapp reads `documents.drive_url`** and lets the owner click through to the file. A messy folder structure means the owner can't find anything.

The layout below is opinionated on purpose. Don't let a client talk you into a custom structure on install day — they will regret it in month two. Adapt only when there's a real reason (e.g., a holding company with sub-LLCs needs an extra level).

---

## Single-entity layout

For Tier 1 (Starter) and Tier 2 (Standard) clients with one operating entity.

Create this in the **client's Google Drive**, under a top-level folder named after their primary entity:

```
/<EntityShortName> Business Command Center/
├── 2026/
│   ├── Financials/
│   │   ├── Bank Statements/
│   │   ├── Credit Card Statements/
│   │   ├── Receipts/
│   │   ├── Invoices/
│   │   └── Other/
│   ├── Payroll/
│   │   ├── Pay Stubs/
│   │   ├── Tax Filings/
│   │   └── Provider Reports/
│   ├── Tax/
│   │   ├── Federal/
│   │   ├── State/
│   │   └── Sales Tax/
│   ├── HR/
│   │   ├── Onboarding/
│   │   ├── Employee Files/
│   │   └── Reviews/
│   ├── Legal/
│   ├── Compliance/
│   └── Marketing/
│       ├── Brand Assets/
│       ├── Social Drafts/
│       └── Campaign Reports/
├── 2025/
│   └── (mirror structure for prior year — populated as needed)
└── _Archive/
    └── (anything pre-2025 the client wants kept)
```

A few notes:

- **`<EntityShortName>`** is the value in `entities.entity_short_name` — short and unambiguous, no LLC suffix. *Sunshine Daydream*, not *Sunshine Daydream Group LLC*.
- **The year folders** are pre-created for the current year and one prior. Don't pre-create future years — Claude will create them on first ingest.
- **`Other/`** under Financials is the catch-all. The `document_categorizer` recipe will sweep that folder periodically and try to assign a real category.
- **`Legal/`** and **`Compliance/`** are flat (no year subfolders) — too low volume to bother.

---

## Multi-entity layout (Premium Tier 3)

For multi-entity clients like Jay Trudeau's Sunshine Daydream Group (12 entities). The top-level folder is the **group name**, and each entity gets its own subfolder mirroring the single-entity structure.

```
/<GroupName> Business Command Center/
├── _Group/
│   ├── Consolidated Reports/
│   ├── Inter-Entity/
│   └── Group Tax/
├── <Entity1ShortName>/
│   ├── 2026/
│   │   ├── Financials/ ...
│   │   ├── Payroll/ ...
│   │   └── (same shape as single-entity)
│   └── 2025/ ...
├── <Entity2ShortName>/
│   └── 2026/ ...
└── (one folder per entity)
```

- **`_Group/`** prefix with underscore so it sorts to the top in Drive.
- **`Consolidated Reports/`** is where the Financials module's group-wide P&L and balance sheet PDFs land when the monthly close runs.
- **`Inter-Entity/`** holds inter-company billing, loans between entities, transfer documentation. Critical for clean books on consolidation.
- **Per-entity Marketing/ folders** make sense only if the entities have distinct brands. For Jay's group (12 entities, mostly real-estate holding LLCs), you can skip Marketing/ on the inert holding entities and put it only on the operating company.

---

## Storing folder IDs

Once folders exist, capture each Drive folder ID and store them in two places:

### 1. `client_context.drive_folder_mappings` (JSONB)

This is the canonical source for Main Claude. Shape:

```json
{
  "root": "0AGroupRootFolderIDHere",
  "by_entity": {
    "sunshine_daydream": {
      "root": "1EntityRootFolderID",
      "year_2026": {
        "root": "1Year2026FolderID",
        "financials": {
          "bank_statements": "1BankStmtFolderID",
          "credit_cards": "1CCStmtFolderID",
          "receipts": "1ReceiptsFolderID",
          "invoices": "1InvoicesFolderID",
          "other": "1OtherFolderID"
        },
        "payroll": "1PayrollFolderID",
        "tax": {
          "federal": "1FedTaxFolderID",
          "state": "1StateTaxFolderID",
          "sales_tax": "1SalesTaxFolderID"
        },
        "hr": "1HRFolderID",
        "legal": "1LegalFolderID",
        "compliance": "1ComplianceFolderID",
        "marketing": "1MarketingFolderID"
      }
    }
  }
}
```

Write it once at install:

```sql
UPDATE public.client_context
SET drive_folder_mappings = '{"root": "...", "by_entity": {...}}'::jsonb
WHERE client_id = 'main';
```

### 2. `email-ingest` Edge Function (reads the same mappings)

The `email-ingest` Edge Function receives Composio Gmail webhooks, resolves the entity for each attachment, and writes the CSV to the matching subfolder under the root. It reads `client_context.drive_folder_mappings` directly — no per-recipe `input_config.folder_mappings` to maintain. Wired at Phase 6 of the install playbook (see SKILL.md and `docs/DOCUMENT_IMPORTER_GUIDE.md`).

---

## Folder IDs: how to get them

Two methods:

1. **From the URL when viewing the folder in Drive:**
   `https://drive.google.com/drive/folders/{FOLDER_ID}` — the ID is the part after `folders/`.

2. **Programmatically via Composio:**
   ```
   GOOGLEDRIVE_LIST_FILES with query: "name = '<EntityShortName> Business Command Center' and mimeType = 'application/vnd.google-apps.folder'"
   ```
   Use this to script the whole layout if you're doing many entities at once.

Both work. Manual URL grabbing is fine for the first install. Scripting is worth it once you've done five.

---

## Sharing and permissions

The client owns these folders. Give your `cindarellabots@gmail.com` service account **Editor** access at the top-level folder — that's how `email-ingest` will write into the right subfolders.

Do **not** make the folders public. Do **not** put PII (full SSNs, full bank account numbers) into folder or file names — the BCC stores last-4 only and the same hygiene applies to Drive.

---

## Common mistakes

| Mistake | What happens | Fix |
|---|---|---|
| Naming a folder `2026 Bank Statements` instead of nesting `/2026/Financials/Bank Statements` | `email-ingest` routes to "Other/" because no path match | Rename to canonical structure |
| Creating year folders for years that don't have docs yet | Visual clutter, no harm | Leave them or delete the empty ones |
| Sharing the root with the wrong Google account | Recipe can't write | Re-share to `cindarellabots@gmail.com` with Editor role |
| Skipping `_Group/` for multi-entity | No place for consolidated reports | Add it; takes 30 seconds |

---

## Verifying the setup before activating recipes

After folder creation and ID capture, run this check:

```sql
SELECT
  jsonb_pretty(drive_folder_mappings) AS folders
FROM public.client_context
WHERE client_id = 'main';
```

You should see every leaf-level folder ID present. If anything is `null` or the JSON shape doesn't match the template, `email-ingest` will fail at archive time and write the error into `ingest_log.error_message` for the affected row.

That's it for folders. Once this is done and verified, move to `AUTOMATIONS_INSTALL.md` to wire the recipes themselves.
