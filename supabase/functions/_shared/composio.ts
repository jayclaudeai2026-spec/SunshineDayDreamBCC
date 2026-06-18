// Thin wrapper around Composio's REST API.
const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

export class ComposioError extends Error {
  constructor(
    message: string,
    public readonly tool_slug: string,
    public readonly status?: number,
    public readonly raw?: unknown,
    public readonly is_auth_error: boolean = false,
  ) {
    super(message);
    this.name = "ComposioError";
  }
}

export interface ComposioClientOptions {
  apiKey: string;
  baseUrl?: string;
  userId?: string;
  timeoutMs?: number;
}

export class ComposioClient {
  private apiKey: string;
  private baseUrl: string;
  private userId: string;
  private timeoutMs: number;

  constructor(opts: ComposioClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? COMPOSIO_BASE;
    this.userId = opts.userId ?? "default";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  async execute<T = unknown>(
    toolSlug: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/tools/execute/${encodeURIComponent(toolSlug)}`;
    const body = JSON.stringify({
      user_id: this.userId,
      arguments: args,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
        },
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = (err as Error).name === "AbortError"
        ? `Composio ${toolSlug} timed out after ${this.timeoutMs}ms`
        : `Network error calling ${toolSlug}: ${(err as Error).message}`;
      throw new ComposioError(msg, toolSlug);
    }
    clearTimeout(timer);

    const text = await resp.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // leave payload null
    }

    const pAny = payload as Record<string, unknown> | null;
    const errBlock = pAny?.error as Record<string, unknown> | undefined;
    const errCode = errBlock?.code ? String(errBlock.code) : "";
    const errMsgRaw = errBlock?.message ? String(errBlock.message) : "";
    const authRegex = /auth|unauthor|forbid|reconnect|token|expired|revoked/i;
    const isAuthError = resp.status === 401 ||
      resp.status === 403 ||
      authRegex.test(errCode) ||
      authRegex.test(errMsgRaw);

    if (!resp.ok) {
      throw new ComposioError(
        `Composio ${toolSlug} failed: HTTP ${resp.status} \u2014 ${
          errMsgRaw || text.slice(0, 300)
        }`,
        toolSlug,
        resp.status,
        payload ?? text,
        isAuthError,
      );
    }

    if (pAny && typeof pAny === "object" && "data" in pAny) {
      return pAny.data as T;
    }
    return payload as T;
  }
}
