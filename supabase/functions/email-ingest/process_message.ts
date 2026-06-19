// process_message v10 (2026-06-18):
//   - v7: receipt sending gated by sendReceipts flag (default false).
//   - v8: only pass ingestable (CSV/XLSX/XLS) attachments to identifyEntity. No fallback to allAttachments — prevents inline signature images from triggering false-positive filename_pattern matches.
//   - v9: no changes to this file; period parsing now handles MM/DD/YYYY (see _shared/template.ts).
//   - v10 (this rev): unwrap() now handles both "data" and "response_data" Composio v3 envelopes. The previous version only peeled "data", which composio.ts already strips at the execute() layer; the v3 inner envelope is "response_data", which leaked through and caused GMAIL_CREATE_EMAIL_DRAFT responses to look like { response_data: { id, message: {...} } } at the call site — draftR.id was undefined and the code threw "no draft id" despite drafts being created successfully in Gmail. Symptom on 2026-06-18 Gate 1 poll: 8 orphan drafts in Drafts folder, 8 failed email_send_log rows, no actual receipts delivered. Manual GMAIL_SEND_DRAFT calls recovered them. This patch makes the same unwrap-tolerant for the draftResp / verifyResp / sentResp shapes so future polls work end-to-end.

import type { SupabaseClient } from "./_shared/supabase.ts";
import { ComposioClient, ComposioError } from "./_shared/composio.ts";
import {
  extractAttachments,
  fetchMessage,
  filterCsv,
  findHeader,
  getAttachmentS3Key,
  parseEmailAddress,
} from "./_shared/gmail.ts";
import {
  resolveOrCreateFolder,
  uploadFileToFolder,
} from "./_shared/drive.ts";
import { identifyEntity } from "./_shared/entity_id.ts";
import {
  escapeHtml,
  parseReportingPeriod,
  periodLabel,
  renderTemplate,
} from "./_shared/template.ts";
import type { IngestPipelineResult } from "./_shared/types.ts";

export async function processMessage(args: {
  sb: SupabaseClient;
  composio: ComposioClient;
  message_id: string;
  sendReceipts?: boolean;
}): Promise<IngestPipelineResult> {
  const { sb, composio, message_id, sendReceipts = false } = args;

  const { data: existing } = await sb
    .from("ingest_log")
    .select("id, entity_id")
    .eq("gmail_message_id", message_id)
    .maybeSingle();

  if (existing) {
    return {
      status: "duplicate",
      ingest_id: existing.id as number,
      message_id,
      entity_id: (existing.entity_id as number | null) ?? null,
    };
  }

  const msg = await fetchMessage(composio, message_id);

  const fromEmail = parseEmailAddress(findHeader(msg, "From")) ?? "unknown";
  const toEmail = parseEmailAddress(findHeader(msg, "To")) ?? "unknown";
  const subject = findHeader(msg, "Subject") ?? "";

  const allAttachments = extractAttachments(msg);
  const csvs = filterCsv(allAttachments);

  const ident = await identifyEntity({
    sb,
    subject,
    from_email: fromEmail,
    attachments: csvs,
  });

  const filenameStrings = csvs.map((a) => a.filename);
  const reportingPeriod = parseReportingPeriod([subject, ...filenameStrings]);

  let driveFolderId: string | null = null;
  const driveFileIds: string[] = [];
  let driveError: string | null = null;

  if (csvs.length > 0) {
    try {
      const { data: ctx, error: ctxErr } = await sb
        .from("client_context")
        .select("drive_folder_mappings")
        .eq("client_id", "main")
        .maybeSingle();
      if (ctxErr) {
        throw new Error(`client_context read failed: ${ctxErr.message}`);
      }
      const mappings =
        (ctx?.drive_folder_mappings ?? {}) as Record<string, unknown>;
      const bccRoot = mappings.bcc_root as string | undefined;

      if (!bccRoot) {
        driveError =
          "No bcc_root in client_context.drive_folder_mappings \u2014 Drive archive skipped";
        console.warn(driveError);
      } else {
        let entityShort = "_unidentified";
        if (ident.entity_id) {
          const { data: e } = await sb
            .from("entities")
            .select("entity_short_name")
            .eq("id", ident.entity_id)
            .maybeSingle();
          if (e?.entity_short_name) {
            entityShort = e.entity_short_name as string;
          }
        }

        const yyyy = reportingPeriod
          ? reportingPeriod.slice(0, 4)
          : "_unknown_year";
        const mm = reportingPeriod
          ? reportingPeriod.slice(5, 7)
          : "_unknown_month";

        driveFolderId = await resolveOrCreateFolder(
          composio,
          sb,
          bccRoot,
          [entityShort, yyyy, mm],
        );

        for (const csv of csvs) {
          const { s3key } = await getAttachmentS3Key(composio, {
            message_id,
            attachment_id: csv.attachment_id,
            file_name: csv.filename,
          });
          const fileId = await uploadFileToFolder(composio, {
            folder_id: driveFolderId,
            name: csv.filename,
            mimetype: csv.mime_type || "text/csv",
            s3key,
          });
          driveFileIds.push(fileId);
        }
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      driveError = m;
      console.error(`Drive archive failed for ${message_id}: ${m}`);
    }
  }

  const parseResult = ident.method === "manual_queue"
    ? "manual_queue_required"
    : "pending";

  const errorDetails: Record<string, unknown> = {};
  if (driveError) errorDetails.drive_archive_error = driveError;
  if (csvs.length === 0 && allAttachments.length > 0) {
    errorDetails.no_ingestable_attachments = true;
    errorDetails.non_ingestable_attachment_count = allAttachments.length;
  }
  if (csvs.length === 0 && allAttachments.length === 0) {
    errorDetails.no_attachments = true;
  }

  const { data: inserted, error: insErr } = await sb
    .from("ingest_log")
    .insert({
      received_at: new Date().toISOString(),
      gmail_message_id: msg.id,
      gmail_thread_id: msg.threadId,
      from_email: fromEmail,
      to_email: toEmail,
      subject,
      attachment_count: csvs.length,
      attachment_names: csvs.map((a) => a.filename),
      entity_id: ident.entity_id,
      entity_identification_method: ident.method,
      entity_identification_confidence: ident.confidence,
      reporting_period: reportingPeriod,
      drive_folder_id: driveFolderId,
      drive_file_ids: driveFileIds,
      parse_result: parseResult,
      error_details: errorDetails,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    throw new Error(
      `ingest_log insert failed: ${insErr?.message ?? "no row returned"}`,
    );
  }

  const ingestId = inserted.id as number;

  if (sendReceipts) {
    try {
      await sendReceipt({
        sb,
        composio,
        ingestId,
        msg,
        fromEmail,
        entity_id: ident.entity_id,
        reportingPeriod,
        attachmentNames: csvs.map((a) => a.filename),
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      console.error(
        `Receipt send failed for ingest_id=${ingestId}: ${m}`,
      );
    }
  }

  return {
    status: ident.method === "manual_queue" ? "manual_queue" : "success",
    ingest_id: ingestId,
    message_id,
    entity_id: ident.entity_id,
  };
}

async function sendReceipt(args: {
  sb: SupabaseClient;
  composio: ComposioClient;
  ingestId: number;
  msg: { id: string; threadId: string };
  fromEmail: string;
  entity_id: number | null;
  reportingPeriod: string | null;
  attachmentNames: string[];
}): Promise<void> {
  const {
    sb,
    composio,
    ingestId,
    msg,
    fromEmail,
    entity_id,
    reportingPeriod,
    attachmentNames,
  } = args;

  const { data: tpl, error: tplErr } = await sb
    .from("email_templates")
    .select(
      "template_key, subject_template, html_body_template, text_body_template",
    )
    .eq("template_key", "ingest_receipt")
    .eq("is_active", true)
    .maybeSingle();

  if (tplErr || !tpl) {
    throw new Error(
      `ingest_receipt template not found: ${tplErr?.message ?? "no active row"}`,
    );
  }

  let entityDisplay = "Unidentified \u2014 manual review";
  if (entity_id) {
    const { data: e } = await sb
      .from("entities")
      .select("legal_name, entity_short_name")
      .eq("id", entity_id)
      .maybeSingle();
    if (e) {
      entityDisplay = (e.legal_name as string | null) ||
        (e.entity_short_name as string | null) ||
        entityDisplay;
    }
  }

  const attachmentListHtml = attachmentNames.length > 0
    ? attachmentNames.map((n) => `<li>${escapeHtml(n)}</li>`).join("")
    : "<li><em>(no attachments)</em></li>";

  const attachmentListText = attachmentNames.length > 0
    ? attachmentNames.map((n) => `- ${n}`).join("\n")
    : "- (no attachments)";

  const vars: Record<string, string> = {
    ENTITY_DISPLAY_NAME: entityDisplay,
    PERIOD_LABEL: periodLabel(reportingPeriod),
    ATTACHMENT_LIST_HTML: attachmentListHtml,
    ATTACHMENT_LIST_TEXT: attachmentListText,
  };

  const subject = renderTemplate(tpl.subject_template as string, vars);
  const bodyHtml = renderTemplate(tpl.html_body_template as string, vars);
  const bodyText = tpl.text_body_template
    ? renderTemplate(tpl.text_body_template as string, vars)
    : null;

  const { data: cc } = await sb
    .from("client_context")
    .select("intake_email")
    .eq("client_id", "main")
    .maybeSingle();
  const intakeEmail = (cc?.intake_email as string | undefined) ?? "unknown";

  const { data: sendRow, error: sendErr } = await sb
    .from("email_send_log")
    .insert({
      template_key: "ingest_receipt",
      to_email: fromEmail,
      from_email: intakeEmail,
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      status: "queued",
      related_ingest_id: ingestId,
      related_entity_id: entity_id,
    })
    .select("id")
    .single();

  if (sendErr || !sendRow) {
    throw new Error(
      `email_send_log insert failed: ${sendErr?.message ?? "no row returned"}`,
    );
  }

  const sendLogId = sendRow.id as number;

  try {
    const draftResp = await composio.execute<Record<string, unknown>>(
      "GMAIL_CREATE_EMAIL_DRAFT",
      {
        user_id: "me",
        recipient_email: fromEmail,
        subject,
        body: bodyHtml,
        is_html: true,
        thread_id: msg.threadId,
      },
    );

    const draftR = unwrap(draftResp) as Record<string, unknown>;
    const draftMsg =
      (draftR?.message as Record<string, unknown> | undefined) ?? draftR;
    const draftId =
      (draftR?.id as string | undefined) ??
      (draftMsg?.id as string | undefined);
    const draftLabels =
      (draftMsg?.labelIds as string[] | undefined) ??
      (draftR?.labelIds as string[] | undefined) ??
      [];

    if (!draftId) {
      throw new Error(
        `GMAIL_CREATE_EMAIL_DRAFT returned no draft id: ${
          JSON.stringify(draftR).slice(0, 300)
        }`,
      );
    }

    await sb
      .from("email_send_log")
      .update({ status: "draft", gmail_draft_id: draftId })
      .eq("id", sendLogId);

    const verifyResp = await composio.execute<Record<string, unknown>>(
      "GMAIL_GET_DRAFT",
      { user_id: "me", draft_id: draftId, format: "metadata" },
    );
    const v = unwrap(verifyResp) as Record<string, unknown>;
    const vMsg = v?.message as Record<string, unknown> | undefined;
    const vLabels =
      (vMsg?.labelIds as string[] | undefined) ??
      (v?.labelIds as string[] | undefined) ??
      draftLabels;
    if (!vLabels.includes("DRAFT")) {
      throw new Error(
        `Draft verification failed: labelIds=${JSON.stringify(vLabels)}`,
      );
    }

    await sb
      .from("email_send_log")
      .update({ status: "verified_draft" })
      .eq("id", sendLogId);

    const sentResp = await composio.execute<Record<string, unknown>>(
      "GMAIL_SEND_DRAFT",
      { user_id: "me", draft_id: draftId },
    );
    const sentR = unwrap(sentResp) as Record<string, unknown>;
    const sentMsg = sentR?.message as Record<string, unknown> | undefined;
    const sentMessageId =
      (sentR?.id as string | undefined) ??
      (sentMsg?.id as string | undefined) ??
      null;

    await sb
      .from("email_send_log")
      .update({
        status: "sent",
        gmail_message_id: sentMessageId,
        sent_at: new Date().toISOString(),
        send_attempted_at: new Date().toISOString(),
      })
      .eq("id", sendLogId);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isAuth = err instanceof ComposioError && err.is_auth_error;
    await sb
      .from("email_send_log")
      .update({
        status: "failed",
        error_message: errMsg.slice(0, 2000),
        send_attempted_at: new Date().toISOString(),
        metadata: { auth_error: isAuth, tool: (err as ComposioError)?.tool_slug },
      })
      .eq("id", sendLogId);
    throw err;
  }
}

// v10 patch: also peel "response_data" wrapper (Composio v3 inner envelope).
// composio.ts execute() strips the outer "data" already; the residual
// wrapper for tools like GMAIL_CREATE_EMAIL_DRAFT is "response_data".
function unwrap(resp: unknown): unknown {
  if (resp && typeof resp === "object") {
    const obj = resp as Record<string, unknown>;
    for (const key of ["data", "response_data"] as const) {
      const inner = obj[key];
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner;
      }
    }
  }
  return resp;
}
