// v8 (2026-06-18): entity identification expanded — unchanged in v9.

import type { SupabaseClient } from "./supabase.ts";
import type {
  EntityIdentification,
  EntityRow,
  ExtractedAttachment,
} from "./types.ts";

function normalize(s: string): string {
  return (s ?? "").toLowerCase().replace(/[\s\-_.]/g, "");
}

interface Candidate {
  entity_id: number;
  term: string;
  source: "legal_name" | "entity_short_name";
}

function buildCandidates(entities: EntityRow[]): Candidate[] {
  const cands: Candidate[] = [];
  for (const e of entities) {
    const short = normalize(e.entity_short_name ?? "");
    const legal = normalize(e.legal_name ?? "");
    if (legal && legal.length >= 6) {
      cands.push({ entity_id: e.id, term: legal, source: "legal_name" });
    }
    if (short && short.length >= 4) {
      cands.push({ entity_id: e.id, term: short, source: "entity_short_name" });
    }
  }
  cands.sort((a, b) => b.term.length - a.term.length);
  return cands;
}

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
  const candidates = buildCandidates(entities);

  const bracketMatch = subject.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    const candidate = bracketMatch[1].trim().toLowerCase();
    const hit = entities.find(
      (e) => (e.entity_short_name ?? "").toLowerCase() === candidate,
    );
    if (hit) {
      return {
        entity_id: hit.id,
        method: "subject_bracket",
        confidence: 1.0,
      };
    }
  }

  for (const att of attachments) {
    const normFname = normalize(att.filename);
    if (!normFname) continue;
    const hit = candidates.find((c) => normFname.includes(c.term));
    if (hit) {
      return {
        entity_id: hit.entity_id,
        method: "filename_pattern",
        confidence: 0.95,
      };
    }
  }

  if (subject) {
    const normSubject = normalize(subject);
    const hit = candidates.find((c) => normSubject.includes(c.term));
    if (hit) {
      return {
        entity_id: hit.entity_id,
        method: "subject_pattern",
        confidence: 0.85,
      };
    }
  }

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
        confidence: 0.80,
      };
    }
  }

  return { entity_id: null, method: "manual_queue", confidence: 0.0 };
}
