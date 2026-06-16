// Poll mode: sweep Gmail for new messages since last checkpoint, process each.
//
// Why poll mode exists:
//   The primary trigger path is Composio Gmail Trigger → webhook → this function.
//   Poll mode is the resilient backstop. If the Composio Trigger silently breaks
//   (e.g. during an OAuth reconnect window), pg_cron-scheduled poll runs catch
//   anything the webhook missed on the next sweep. Idempotency on
//   gmail_message_id makes overlap harmless.
//
// Checkpoint:
//   We store Gmail's historyId in agent_memory.metadata.capability_key =
//   'gmail_history_checkpoint'. The newest row wins. We advance only after a
//   successful list call. On historyIdTooOld, we reset to the current profile
//   historyId (drops a one-time gap, but no duplicates).

import type { SupabaseClient } from "../_shared/supabase.ts";
import { ComposioClient } from "../_shared/composio.ts";
import {
  getProfileHistoryId,
  listHistoryMessageIds,
} from "../_shared/gmail.ts";
import { processMessage } from "./process_message.ts";
import type { IngestPipelineResult } from "../_shared/types.ts";

const CHECKPOINT_KEY = "gmail_history_checkpoint";
const POLL_MAX_PER_RUN = 50; // safety cap; tune if rate-limited

export interface PollResult {
  processed: number;
  bootstrap: boolean;
  results: IngestPipelineResult[];
  new_checkpoint: string | null;
  start_history_id: string | null;
}

export async function pollAndProcess(args: {
  sb: SupabaseClient;
  composio: ComposioClient;
}): Promise<PollResult> {
  const { sb, composio } = args;

  // Load latest checkpoint
  const { data: ckpt } = await sb
    .from("agent_memory")
    .select("id, content")
    .eq("memory_type", "capability_note")
    .filter("metadata->>capability_key", "eq", CHECKPOINT_KEY)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let startHistoryId: string | null = null;
  if (ckpt?.content) {
    startHistoryId = String(ckpt.content).trim();
  }

  // Bootstrap: no checkpoint yet → seed from current profile and return.
  if (!startHistoryId) {
    const hid = await getProfileHistoryId(composio);
    if (hid) await writeCheckpoint(sb, hid);
    return {
      processed: 0,
      bootstrap: true,
      results: [],
      new_checkpoint: hid,
      start_history_id: null,
    };
  }

  let listed;
  try {
    listed = await listHistoryMessageIds(composio, {
      start_history_id: startHistoryId,
      label_id: "INBOX",
      max_results: 500,
    });
  } catch (err) {
    // historyIdTooOld or other failure → reset checkpoint to current profile
    const hid = await getProfileHistoryId(composio);
    if (hid) await writeCheckpoint(sb, hid);
    throw new Error(
      `history list failed (checkpoint reset to ${hid ?? "null"}): ${
        err instanceof Error ? err.message : err
      }`,
    );
  }

  const idsToProcess = listed.message_ids.slice(0, POLL_MAX_PER_RUN);
  const results: IngestPipelineResult[] = [];
  for (const mid of idsToProcess) {
    try {
      const r = await processMessage({ sb, composio, message_id: mid });
      results.push(r);
    } catch (err) {
      results.push({
        status: "error",
        ingest_id: null,
        message_id: mid,
        entity_id: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (listed.new_history_id) {
    await writeCheckpoint(sb, listed.new_history_id);
  }

  return {
    processed: results.length,
    bootstrap: false,
    results,
    new_checkpoint: listed.new_history_id,
    start_history_id: startHistoryId,
  };
}

async function writeCheckpoint(
  sb: SupabaseClient,
  historyId: string,
): Promise<void> {
  await sb.from("agent_memory").insert({
    agent_id: "main",
    memory_type: "capability_note",
    content: historyId,
    metadata: {
      capability_key: CHECKPOINT_KEY,
      updated_at: new Date().toISOString(),
    },
  });
}
