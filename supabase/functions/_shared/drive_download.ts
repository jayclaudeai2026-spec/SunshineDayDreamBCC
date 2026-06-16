// Google Drive download helper.
//
// Two-step pattern:
//   1. Composio GOOGLEDRIVE_DOWNLOAD_FILE returns a signed URL (downloaded_file_content.s3url)
//      rather than inline bytes for non-Workspace files.
//   2. Fetch the s3url to retrieve the actual content as UTF-8 text.
//
// For CSV files (which is what the parser consumes), we omit mime_type so the
// file downloads in its native format. mime_type is only relevant for Workspace
// docs (Google Docs/Sheets/Slides) which would need an export format specified.
//
// Reconnect resilience: like every other Composio call in this codebase, we
// don't pass a connected_account_id. The workspace resolves the active Drive
// connection at call time, so OAuth reconnects don't break the function.

import { ComposioClient, ComposioError } from "./composio.ts";

const DOWNLOAD_FETCH_TIMEOUT_MS = 60_000;

export class DriveDownloadError extends Error {
  constructor(
    message: string,
    public readonly drive_file_id: string,
    public readonly cause_kind: "composio" | "signed_url" | "decode" | "policy",
    public readonly is_auth_error: boolean = false,
  ) {
    super(message);
    this.name = "DriveDownloadError";
  }
}

/**
 * Fetch the text content of a Drive file (typically a CSV).
 *
 * Returns UTF-8 text. For binary files this will produce garbage; the parser
 * pipeline only ever calls this on CSVs identified by the ingestion stage.
 */
export async function fetchCsvText(
  composio: ComposioClient,
  drive_file_id: string,
): Promise<string> {
  // Step 1: ask Composio for a download reference
  let resp: unknown;
  try {
    resp = await composio.execute<unknown>("GOOGLEDRIVE_DOWNLOAD_FILE", {
      fileId: drive_file_id,
      // Omit mime_type — CSVs (and other non-Workspace files) download natively.
    });
  } catch (err) {
    const isAuth = err instanceof ComposioError && err.is_auth_error;
    throw new DriveDownloadError(
      `GOOGLEDRIVE_DOWNLOAD_FILE failed for ${drive_file_id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      drive_file_id,
      "composio",
      isAuth,
    );
  }

  // Composio sometimes wraps one extra layer in `.data`; defensive unwrap.
  const root = unwrap(resp) as Record<string, unknown>;
  const dfc =
    (root?.downloaded_file_content as Record<string, unknown> | undefined) ??
    ((root?.data as Record<string, unknown> | undefined)?.downloaded_file_content as Record<string, unknown> | undefined);

  if (!dfc) {
    // Some policy-blocked responses come back with status_code=200 + successful=false
    // and no downloaded_file_content. Surface as a clear error.
    const successful = root?.successful;
    if (successful === false) {
      throw new DriveDownloadError(
        `Drive download blocked by policy for ${drive_file_id} (successful=false). ` +
        `Check sharing permissions on the file and the Composio Drive connection scope.`,
        drive_file_id,
        "policy",
      );
    }
    throw new DriveDownloadError(
      `Drive download response missing downloaded_file_content for ${drive_file_id}; ` +
      `payload keys=${Object.keys(root).join(",")}`,
      drive_file_id,
      "composio",
    );
  }

  // Step 2: fetch the signed URL
  const signedUrl =
    (dfc.s3url as string | undefined) ??
    (dfc.url as string | undefined) ??
    (dfc.signed_url as string | undefined);

  if (!signedUrl) {
    // Some response shapes inline the content as base64 instead of a link.
    const inlineB64 = (dfc.content as string | undefined) ??
                      (dfc.bytes_b64 as string | undefined);
    if (inlineB64) {
      try {
        return atob(inlineB64.replace(/\s+/g, ""));
      } catch (err) {
        throw new DriveDownloadError(
          `Inline base64 decode failed: ${err instanceof Error ? err.message : err}`,
          drive_file_id,
          "decode",
        );
      }
    }
    throw new DriveDownloadError(
      `No s3url, url, or inline content in downloaded_file_content for ${drive_file_id}; ` +
      `keys=${Object.keys(dfc).join(",")}`,
      drive_file_id,
      "composio",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_FETCH_TIMEOUT_MS);
  let fetched: Response;
  try {
    fetched = await fetch(signedUrl, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw new DriveDownloadError(
      `Signed URL fetch failed for ${drive_file_id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      drive_file_id,
      "signed_url",
    );
  }
  clearTimeout(timer);

  if (!fetched.ok) {
    throw new DriveDownloadError(
      `Signed URL returned HTTP ${fetched.status} for ${drive_file_id} ` +
      `(signed links can expire; retry the download)`,
      drive_file_id,
      "signed_url",
    );
  }

  // CSVs export as UTF-8 from QBS Desktop; replacement char keeps stream going on the rare bad byte.
  return await fetched.text();
}

function unwrap(resp: unknown): unknown {
  if (resp && typeof resp === "object" && "data" in resp) {
    const inner = (resp as Record<string, unknown>).data;
    if (inner && typeof inner === "object") return inner;
  }
  return resp;
}

// Re-export the old error class name for any callers that imported it.
// Existing imports of DriveDownloadNotWiredError still type-check; new code
// should reference DriveDownloadError.
export class DriveDownloadNotWiredError extends DriveDownloadError {
  constructor() {
    super("Deprecated alias — Drive download is now wired", "n/a", "composio");
    this.name = "DriveDownloadNotWiredError";
  }
}
