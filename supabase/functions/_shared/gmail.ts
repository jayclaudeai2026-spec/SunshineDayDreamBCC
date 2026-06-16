// Gmail helpers: header lookup, address parsing, MIME walk, and Composio wrappers.

import type { ComposioClient } from "./composio.ts";
import type { ExtractedAttachment, GmailMessage, GmailPart } from "./types.ts";

export function findHeader(msg: GmailMessage, name: string): string | null {
  const headers = msg.payload?.headers ?? [];
  const lower = name.toLowerCase();
  const found = headers.find((h) => h.name.toLowerCase() === lower);
  return found?.value ?? null;
}

/** "Name <email@example.com>" or "email@example.com" → "email@example.com" (lowercased). */
export function parseEmailAddress(raw: string | null): string | null {
  if (!raw) return null;
  const angled = raw.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : raw).trim().toLowerCase();
  // Reject anything that doesn't look at all like an email
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : null;
}

/** Walks MIME tree collecting (filename, attachment_id, mime_type) tuples. */
export function extractAttachments(msg: GmailMessage): ExtractedAttachment[] {
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

/** CSV filter by MIME or filename suffix. Tolerant of vendor quirks. */
export function filterCsv(atts: ExtractedAttachment[]): ExtractedAttachment[] {
  return atts.filter((a) => {
    const mime = a.mime_type.toLowerCase();
    const name = a.filename.toLowerCase();
    return (
      mime.startsWith("text/csv") ||
      mime === "application/csv" ||
      mime === "application/vnd.ms-excel" || // some clients emit this for .csv
      name.endsWith(".csv")
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
  const r = unwrap(resp) as Partial<GmailMessage>;
  if (!r?.id) {
    throw new Error(
      `fetchMessage: empty payload for message_id=${message_id}`,
    );
  }
  return r as GmailMessage;
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

export interface HistoryFetchResult {
  message_ids: string[];
  new_history_id: string | null;
}

/** Returns new message IDs since startHistoryId. Caller advances checkpoint. */
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
  const r = unwrap(resp) as Record<string, unknown>;
  return (r?.historyId as string | undefined) ?? null;
}

/** Composio sometimes wraps tool output one extra level. Unwrap defensively. */
function unwrap(resp: unknown): unknown {
  if (resp && typeof resp === "object" && "data" in resp) {
    const inner = (resp as Record<string, unknown>).data;
    if (inner && typeof inner === "object") return inner;
  }
  return resp;
}
