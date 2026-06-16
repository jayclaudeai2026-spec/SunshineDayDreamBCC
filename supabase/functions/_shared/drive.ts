// Google Drive helpers: idempotent folder resolution + file upload via s3key.

import type { ComposioClient } from "./composio.ts";
import type { SupabaseClient } from "./supabase.ts";

/**
 * Resolves the Drive folder at the given path under bccRootId. Creates missing
 * segments as needed.
 *
 * Uses client_context.drive_folder_mappings.folder_index as a path→folder_id
 * cache so we don't repeat Drive searches across ingestion events. Cache shape:
 *
 *   client_context.drive_folder_mappings = {
 *     bcc_root: "<drive_folder_id>",          // populated at install time
 *     folder_index: {                          // populated by this function
 *       "Sunshine Daydream LLC/2026/05": "...",
 *       "Sunshine Daydream LLC/2026": "...",
 *     }
 *   }
 *
 * Cache writes are best-effort; correctness is preserved even if writes fail.
 */
export async function resolveOrCreateFolder(
  composio: ComposioClient,
  sb: SupabaseClient,
  bccRootId: string,
  segments: string[],
): Promise<string> {
  if (segments.length === 0) return bccRootId;

  // Load mappings once
  const { data: ctx } = await sb
    .from("client_context")
    .select("drive_folder_mappings")
    .eq("client_id", "main")
    .maybeSingle();

  const mappings = (ctx?.drive_folder_mappings ?? {}) as Record<string, unknown>;
  const index =
    (mappings.folder_index as Record<string, string> | undefined) ?? {};

  const fullPathKey = segments.join("/");
  if (index[fullPathKey]) return index[fullPathKey];

  // Walk segment by segment, creating where needed
  let parentId = bccRootId;
  const newlyResolved: Record<string, string> = {};
  let pathSoFar = "";

  for (const seg of segments) {
    pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
    const cachedHere = index[pathSoFar];
    if (cachedHere) {
      parentId = cachedHere;
      continue;
    }
    const existing = await findFolderInParent(composio, parentId, seg);
    parentId = existing ?? (await createFolder(composio, parentId, seg));
    newlyResolved[pathSoFar] = parentId;
  }

  // Best-effort cache write
  if (Object.keys(newlyResolved).length > 0) {
    try {
      const newIndex = { ...index, ...newlyResolved };
      const newMappings = { ...mappings, folder_index: newIndex };
      await sb
        .from("client_context")
        .update({ drive_folder_mappings: newMappings })
        .eq("client_id", "main");
    } catch (err) {
      console.warn(
        `folder_index cache write failed (non-fatal): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  return parentId;
}

async function findFolderInParent(
  composio: ComposioClient,
  parentId: string,
  name: string,
): Promise<string | null> {
  const escName = name.replace(/'/g, "\\'");
  const q =
    `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents and name = '${escName}'`;
  const resp = await composio.execute<unknown>("GOOGLEDRIVE_FIND_FILE", {
    q,
    pageSize: 5,
    fields: "files(id,name)",
  });
  const r = unwrap(resp) as Record<string, unknown>;
  const files =
    (r?.files as Array<Record<string, unknown>> | undefined) ?? [];
  const first = files[0];
  return (first?.id as string | undefined) ?? null;
}

async function createFolder(
  composio: ComposioClient,
  parentId: string,
  name: string,
): Promise<string> {
  const resp = await composio.execute<unknown>("GOOGLEDRIVE_CREATE_FOLDER", {
    name,
    parent_id: parentId,
  });
  const r = unwrap(resp) as Record<string, unknown>;
  const id =
    (r?.id as string | undefined) ??
    ((r?.file as Record<string, unknown> | undefined)?.id as string | undefined) ??
    ((r?.folder as Record<string, unknown> | undefined)?.id as string | undefined);
  if (!id) {
    throw new Error(
      `GOOGLEDRIVE_CREATE_FOLDER returned no id for "${name}"`,
    );
  }
  return id;
}

/** Uploads a file already staged in Composio (s3key) to a Drive folder. */
export async function uploadFileToFolder(
  composio: ComposioClient,
  args: {
    folder_id: string;
    name: string;
    mimetype: string;
    s3key: string;
  },
): Promise<string> {
  const resp = await composio.execute<unknown>("GOOGLEDRIVE_UPLOAD_FILE", {
    folder_to_upload_to: args.folder_id,
    file_to_upload: {
      name: args.name,
      mimetype: args.mimetype,
      s3key: args.s3key,
    },
  });
  const r = unwrap(resp) as Record<string, unknown>;
  const id =
    (r?.id as string | undefined) ??
    ((r?.file as Record<string, unknown> | undefined)?.id as string | undefined);
  if (!id) {
    throw new Error(
      `GOOGLEDRIVE_UPLOAD_FILE returned no id for "${args.name}"`,
    );
  }
  return id;
}

function unwrap(resp: unknown): unknown {
  if (resp && typeof resp === "object" && "data" in resp) {
    const inner = (resp as Record<string, unknown>).data;
    if (inner && typeof inner === "object") return inner;
  }
  return resp;
}
