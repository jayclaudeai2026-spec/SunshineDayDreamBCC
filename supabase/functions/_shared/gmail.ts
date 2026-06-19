// Gmail helpers v8 (2026-06-19): unwrap() patched to also peel
// "response_data" Composio v3 envelope. Otherwise unchanged from v7.

import type { ComposioClient } from "./composio.ts";
import type { ExtractedAttachment, GmailMessage, GmailPart } from "./types.ts";

export function findHeader(msg: GmailMessage, name: string): string | null {
  const headers = (msg as unknown as { payload?: { headers?: Array<{ name: string; value: string }> } })
    .payload?.headers ?? [];
  const lower = name.toLowerCase();
  const found = headers.find((h) => (h?.name ?? "").toLowerCase() === lower);
  return found?.value ?? null;
}

export function parseEmailAddress(raw: string | null): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : null;
}

export function extractAttachments(msg: GmailMessage): ExtractedAttachment[] {
  const flat = (msg as unknown as {
    attachmentList?: Array<{ attachmentId?: string; filename?: string; mimeType?: string }>;
  }).attachmentList;
  if (Array.isArray(flat) && flat.length > 0) {
    const out: ExtractedAttachment[] = [];
    for (const a of flat) {
      const aid = a?.attachmentId;
      const fname = (a?.filename ?? "").trim();
      if (aid && fname) {
        out.push({
          filename: fname,
          attachment_id: aid,
          mime_type: a?.mimeType ?? "application/octet-stream",
        });
      }
    }
    if (out.length > 0) return out;
  }

  const out: ExtractedAttachment[] = [];
  const visit = (part: GmailPart | undefined) => {
    if (!part) return;
    const filename = (part.filename ?? "").trim();
    const attachmentId = part.body?.attachmentId;
    if (filename && attachmentId) {
      out.push({
        filename,
        attachment_id: attachmentId,
        mime_type: part.mimeType ?? "application/octet-stream",
      });
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(msg.payload);
  return out;
}

export function filterCsv(atts: ExtractedAttachment[]): ExtractedAttachment[] {
  return atts.filter((a) => {
    const mime = (a.mime_type || "").toLowerCase();
    const name = (a.filename || "").toLowerCase();
    return (
      mime.startsWith("text/csv") ||
      mime === "application/csv" ||
      mime === "application/vnd.ms-excel" ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.template" ||
      name.endsWith(".csv") ||
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".xlsm")
    );
  });
}

export async function fetchMessage(
  composio: ComposioClient,
  message_id: string,
): Promise<GmailMessage> {
  const resp = await composio.execute<unknown>(
    "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
    { message_id, format: "full", user_id: "me" },
  );
  const r = unwrap(resp) as Record<string, unknown>;

  const idVal = (r?.id as string | undefined) ??
    (r?.messageId as string | undefined) ??
    message_id;

  const tidVal = (r?.threadId as string | undefined) ??
    (r?.thread_id as string | undefined) ?? "";

  if (!idVal) {
    throw new Error(
      `fetchMessage: empty payload for message_id=${message_id}, keys=${
        Object.keys(r ?? {}).join(",")
      }`,
    );
  }

  return {
    id: idVal,
    threadId: tidVal,
    payload: r?.payload as GmailPart | undefined,
    attachmentList: r?.attachmentList,
  } as unknown as GmailMessage;
}

export interface AttachmentDownload {
  s3key: string;
  mime_type?: string;
}

export async function getAttachmentS3Key(
  composio: ComposioClient,
  args: { message_id: string; attachment_id: string; file_name: string },
): Promise<AttachmentDownload> {
  const resp = await composio.execute<unknown>("GMAIL_GET_ATTACHMENT", {
    message_id: args.message_id,
    attachment_id: args.attachment_id,
    file_name: args.file_name,
    user_id: "me",
  });
  const r = unwrap(resp) as Record<string, unknown>;
  const s3key =
    (r?.s3key as string | undefined) ??
    ((r?.file as Record<string, unknown> | undefined)?.s3key as string | undefined) ??
    ((r?.attachment as Record<string, unknown> | undefined)?.s3key as string | undefined);
  if (!s3key) {
    throw new Error(
      `GMAIL_GET_ATTACHMENT returned no s3key for ${args.file_name}; payload=${
        JSON.stringify(r).slice(0, 300)
      }`,
    );
  }
  const mime_type =
    (r?.mime_type as string | undefined) ??
    (r?.mimetype as string | undefined);
  return { s3key, mime_type };
}

export interface InboxFetchResult {
  message_ids: string[];
  pages_walked: number;
  query: string;
}

export async function fetchInboxMessageIdsSince(
  composio: ComposioClient,
  args: { since_date: string; max_total?: number; per_page?: number; extra_query?: string },
): Promise<InboxFetchResult> {
  const perPage = Math.min(args.per_page ?? 500, 500);
  const maxTotal = args.max_total ?? 1000;
  const baseQuery = `after:${args.since_date} label:INBOX${args.extra_query ? " " + args.extra_query : ""}`;

  const ids = new Set<string>();
  let pageToken: string | null = null;
  let pagesWalked = 0;

  do {
    const callArgs: Record<string, unknown> = {
      query: baseQuery,
      ids_only: true,
      max_results: perPage,
      user_id: "me",
      include_payload: false,
    };
    if (pageToken) callArgs.page_token = pageToken;

    const resp = await composio.execute<unknown>("GMAIL_FETCH_EMAILS", callArgs);
    const r = unwrap(resp) as Record<string, unknown>;
    pagesWalked++;

    const messages =
      (r?.messages as Array<Record<string, unknown>> | undefined) ??
      ((r?.data as Record<string, unknown> | undefined)?.messages as Array<Record<string, unknown>> | undefined) ??
      [];

    for (const m of messages) {
      const id = (m?.id as string | undefined) ??
        (m?.messageId as string | undefined) ??
        (m?.message_id as string | undefined);
      if (id) ids.add(id);
      if (ids.size >= maxTotal) break;
    }

    const nextRaw =
      (r?.nextPageToken as string | undefined) ??
      (r?.next_page_token as string | undefined) ??
      ((r?.data as Record<string, unknown> | undefined)?.nextPageToken as string | undefined);
    pageToken = nextRaw && nextRaw.length > 0 ? nextRaw : null;

    if (ids.size >= maxTotal) break;
    if (pagesWalked >= 10) break;
  } while (pageToken);

  return {
    message_ids: Array.from(ids),
    pages_walked: pagesWalked,
    query: baseQuery,
  };
}

export interface HistoryFetchResult {
  message_ids: string[];
  new_history_id: string | null;
}

export async function listHistoryMessageIds(
  composio: ComposioClient,
  args: {
    start_history_id: string;
    label_id?: string;
    max_results?: number;
  },
): Promise<HistoryFetchResult> {
  const resp = await composio.execute<unknown>("GMAIL_LIST_HISTORY", {
    user_id: "me",
    start_history_id: args.start_history_id,
    label_id: args.label_id ?? "INBOX",
    max_results: args.max_results ?? 100,
    history_types: ["messageAdded"],
  });
  const r = unwrap(resp) as Record<string, unknown>;
  const history = (r?.history as Array<Record<string, unknown>> | undefined) ?? [];
  const ids = new Set<string>();
  for (const h of history) {
    const messagesAdded = (h?.messagesAdded as Array<Record<string, unknown>> | undefined) ?? [];
    for (const ma of messagesAdded) {
      const msg = ma?.message as Record<string, unknown> | undefined;
      const mid = msg?.id as string | undefined;
      if (mid) ids.add(mid);
    }
  }
  return {
    message_ids: Array.from(ids),
    new_history_id: (r?.historyId as string | undefined) ?? null,
  };
}

export async function getProfileHistoryId(
  composio: ComposioClient,
): Promise<string | null> {
  const resp = await composio.execute<unknown>("GMAIL_GET_PROFILE", {
    user_id: "me",
  });
  return deepFindString(resp, "historyId");
}

function deepFindString(obj: unknown, key: string, depth = 0): string | null {
  if (depth > 4) return null;
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const direct = rec[key];
  if (typeof direct === "string" && direct.length > 0) return direct;
  if (typeof direct === "number") return String(direct);
  for (const v of Object.values(rec)) {
    if (v && typeof v === "object") {
      const found = deepFindString(v, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// 2026-06-18: defensive — also peel "response_data" wrapper (Composio v3
// inner envelope). composio.ts execute() strips the outer "data" already;
// the residual wrapper for some v3 tools is "response_data". Applied as a
// guard before any of the gmail.ts call sites surface the bug — currently
// none of the GMAIL_* tools used here have been observed returning that
// envelope shape, but the patch mirrors process_message.ts unwrap() (v10).
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
