import type { SupabaseClient } from "./_shared/supabase.ts";
import { ComposioClient } from "./_shared/composio.ts";
import { fetchInboxMessageIdsSince } from "./_shared/gmail.ts";
import { processMessage } from "./process_message.ts";
import type { IngestPipelineResult } from "./_shared/types.ts";

const POLL_MAX_PER_RUN = 50;
const DEFAULT_LOOKBACK_DAYS = 7;

export interface PollResult {
  processed: number;
  duplicates: number;
  successes: number;
  errors: number;
  manual_queue: number;
  ids_seen: number;
  pages_walked: number;
  query: string;
  results: IngestPipelineResult[];
}

export async function pollAndProcess(args: {
  sb: SupabaseClient;
  composio: ComposioClient;
  lookbackDays?: number;
  sendReceipts?: boolean;
}): Promise<PollResult> {
  const { sb, composio, sendReceipts = false } = args;
  const lookbackDays = args.lookbackDays && args.lookbackDays > 0 ? args.lookbackDays : DEFAULT_LOOKBACK_DAYS;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const yyyy = since.getUTCFullYear();
  const mm = String(since.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(since.getUTCDate()).padStart(2, "0");
  const sinceDate = `${yyyy}/${mm}/${dd}`;

  const fetched = await fetchInboxMessageIdsSince(composio, {
    since_date: sinceDate,
    max_total: 1000,
    per_page: 500,
  });

  const idsToProcess = fetched.message_ids.slice(0, POLL_MAX_PER_RUN);
  const results: IngestPipelineResult[] = [];
  let duplicates = 0;
  let successes = 0;
  let errors = 0;
  let manualQueue = 0;

  for (const mid of idsToProcess) {
    try {
      const r = await processMessage({ sb, composio, message_id: mid, sendReceipts });
      results.push(r);
      if (r.status === "duplicate") duplicates++;
      else if (r.status === "manual_queue") manualQueue++;
      else if (r.status === "success") successes++;
      else errors++;
    } catch (err) {
      errors++;
      results.push({
        status: "error",
        ingest_id: null,
        message_id: mid,
        entity_id: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    processed: results.length,
    duplicates,
    successes,
    errors,
    manual_queue: manualQueue,
    ids_seen: fetched.message_ids.length,
    pages_walked: fetched.pages_walked,
    query: fetched.query,
    results,
  };
}
