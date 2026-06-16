// 5-layer entity identification. Never rejects — manual_queue is the fallback.

import type { SupabaseClient } from "./supabase.ts";
import type {
  EntityIdentification,
  EntityRow,
  ExtractedAttachment,
} from "./types.ts";

export async function identifyEntity(args: {
  sb: SupabaseClient;
  subject: string;
  from_email: string;
  attachments: ExtractedAttachment[];
}): Promise<EntityIdentification> {
  const { sb, subject, from_email, attachments } = args;

  const { data: entitiesRaw, error: entErr } = await sb
    .from("entities")
    .select("id, legal_name, entity_short_name, is_active")
    .eq("is_active", true);

  if (entErr) {
    throw new Error(`Failed to load entities: ${entErr.message}`);
  }

  const entities: EntityRow[] = (entitiesRaw ?? []) as EntityRow[];

  // ===== Layer 1: subject_bracket =====
  // [ENTITY_SHORT_NAME] or [entity_short_name] in subject.
  const bracketMatch = subject.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    const candidate = bracketMatch[1].trim().toLowerCase();
    const hit = entities.find(
      (e) => e.entity_short_name.toLowerCase() === candidate,
    );
    if (hit) {
      return {
        entity_id: hit.id,
        method: "subject_bracket",
        confidence: 1.0,
      };
    }
  }

  // ===== Layer 2: filename_pattern =====
  // entity_short_name appears as a delimited token in any attachment filename.
  for (const att of attachments) {
    const fname = att.filename.toLowerCase();
    const hit = entities.find((e) => {
      const s = e.entity_short_name.toLowerCase();
      const re = new RegExp(
        `(^|[\\s_\\-\\.])${escapeRegex(s)}([\\s_\\-\\.]|$)`,
      );
      return re.test(fname);
    });
    if (hit) {
      return {
        entity_id: hit.id,
        method: "filename_pattern",
        confidence: 0.95,
      };
    }
  }

  // ===== Layer 3: csv_content =====
  // DEFERRED to v1.1. Inspecting CSV content here would require downloading
  // each candidate attachment via GMAIL_GET_ATTACHMENT before entity ID is
  // known — duplicating work the parser (Step 3) will already do. The cleaner
  // path is to wire content-based ID into the parser pipeline and have it
  // update ingest_log.entity_identification_method='csv_content' retroactively
  // when sender_map + manual_queue would otherwise have been the result.
  // For v1, we fall through to layers 4 and 5.

  // ===== Layer 4: sender_map =====
  if (from_email) {
    const { data: mapRow } = await sb
      .from("email_sender_map")
      .select("entity_id, is_primary")
      .eq("sender_email", from_email.toLowerCase())
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mapRow?.entity_id) {
      return {
        entity_id: mapRow.entity_id,
        method: "sender_map",
        confidence: 0.85,
      };
    }
  }

  // ===== Layer 5: manual_queue =====
  return { entity_id: null, method: "manual_queue", confidence: 0.0 };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
