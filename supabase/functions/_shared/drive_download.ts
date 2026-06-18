// Google Drive download helper.

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

export async function fetchCsvText(
  composio: ComposioClient,
  drive_file_id: string,
): Promise<string> {
  let resp: unknown;
  try {
    resp = await composio.execute<unknown>("GOOGLEDRIVE_DOWNLOAD_FILE", {
      fileId: drive_file_id,
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

  const root = unwrap(resp) as Record<string, unknown>;
  const dfc =
    (root?.downloaded_file_content as Record<string, unknown> | undefined) ??
    ((root?.data as Record<string, unknown> | undefined)?.downloaded_file_content as Record<string, unknown> | undefined);

  if (!dfc) {
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

  const signedUrl =
    (dfc.s3url as string | undefined) ??
    (dfc.url as string | undefined) ??
    (dfc.signed_url as string | undefined);

  if (!signedUrl) {
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

  return await fetched.text();
}

function unwrap(resp: unknown): unknown {
  if (resp && typeof resp === "object" && "data" in resp) {
    const inner = (resp as Record<string, unknown>).data;
    if (inner && typeof inner === "object") return inner;
  }
  return resp;
}

export class DriveDownloadNotWiredError extends DriveDownloadError {
  constructor() {
    super("Deprecated alias \u2014 Drive download is now wired", "n/a", "composio");
    this.name = "DriveDownloadNotWiredError";
  }
}
