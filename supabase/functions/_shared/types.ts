// Shared TypeScript types for the email-ingest pipeline.

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailBody {
  size?: number;
  data?: string;          // base64url
  attachmentId?: string;
}

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;  // ms since epoch as string
  payload?: GmailPart;
}

export interface ExtractedAttachment {
  filename: string;
  attachment_id: string;
  mime_type: string;
}

export type EntityIdentificationMethod =
  | "subject_bracket"
  | "filename_pattern"
  | "csv_content"
  | "sender_map"
  | "manual_queue";

export interface EntityIdentification {
  entity_id: number | null;
  method: EntityIdentificationMethod;
  confidence: number;
}

export interface IngestPipelineResult {
  status: "success" | "duplicate" | "manual_queue" | "error";
  ingest_id: number | null;
  message_id: string;
  entity_id: number | null;
  error?: string;
}

export interface EntityRow {
  id: number;
  legal_name: string;
  entity_short_name: string;
  is_active: boolean;
}

export interface EmailTemplate {
  template_key: string;
  subject_template: string;
  html_body_template: string;
  text_body_template: string | null;
}
