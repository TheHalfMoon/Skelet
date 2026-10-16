/**
 * G08-05 Skilit TypeScript SDK: a thin typed client over REST API v1.
 * Zero runtime dependencies; works in Node 20+ with the global fetch.
 * Every method returns domain objects with stable Skilit URIs; transport
 * failures surface as typed SdkError codes, never raw responses.
 */

export type SdkErrorCode =
  | "sdk/unauthorized"
  | "sdk/forbidden"
  | "sdk/not-found"
  | "sdk/rate-limited"
  | "sdk/invalid"
  | "sdk/transport";

export class SdkError extends Error {
  readonly code: SdkErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string | undefined;
  readonly envelopeCode?: string | undefined;
  constructor(
    code: SdkErrorCode,
    status: number,
    message: string,
    options?: { retryable?: boolean | undefined; requestId?: string | undefined; envelopeCode?: string | undefined },
  ) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.status = status;
    this.retryable = options?.retryable ?? code === "sdk/rate-limited";
    if (options?.requestId !== undefined) this.requestId = options.requestId;
    if (options?.envelopeCode !== undefined) this.envelopeCode = options.envelopeCode;
  }
}

/** REST contract version this SDK speaks; bump with breaking API changes. */
export const SDK_CONTRACT_VERSION = "v1";

export interface SdkAsset {
  uri: string;
  kind: string;
  title: string;
  license: string;
  rights: string;
  serving: string;
  servingReason: string;
  source: string;
  contentHash: string;
}

export interface SdkObject {
  uri: string;
  kind: string;
  title: string;
  rights: string;
}

export interface SdkPackItem {
  uri: string;
  kind: string;
  title: string;
  rights: string;
}

export interface SdkPack {
  schema: string;
  uri: string;
  title: string;
  visibility: string;
  workspaceId: string;
  itemCount: number;
  exportedAt: string;
  items: SdkPackItem[];
}

export interface SdkPage<T> {
  items: T[];
  cursor?: string | undefined;
  requestId?: string | undefined;
  warnings: string[];
}

export interface SearchAssetsInput {
  query: string;
  kinds?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  requestId?: string | undefined;
}

export interface SkilitClientOptions {
  baseUrl: string;
  token: string;
  /**
   * Test-only seam for stubbing transport. Treated as trusted code: it
   * observes bearer tokens and URLs, so never pass a remote value here.
   */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function statusToCode(status: number): SdkErrorCode {
  if (status === 401) return "sdk/unauthorized";
  if (status === 403) return "sdk/forbidden";
  if (status === 404) return "sdk/not-found";
  if (status === 429) return "sdk/rate-limited";
  if (status >= 400 && status < 500) return "sdk/invalid";
  return "sdk/transport";
}

/**
 * AF-03b: unwrap the skilit.agent.v1 envelope. Accepts the versioned
 * envelope (result object) and the pre-AF-03b bare shape for backward
 * compatibility during migration; prefers the envelope when present.
 *
 * AF-03c: also surfaces envelope metadata (request_id, cursor, warnings,
 * typed error with retryable) so independent clients share one retry and
 * pagination policy without forking permission semantics.
 */
function envelopeResult(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (
    (record.schema_version === "skilit.agent.v1" ||
      record.schema_version === "skelet.agent.v1") &&
    typeof record.result === "object" &&
    record.result !== null
  ) {
    return record.result as Record<string, unknown>;
  }
  return record;
}

interface EnvelopeMeta {
  requestId?: string | undefined;
  cursor?: string | undefined;
  warnings: string[];
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  retryable?: boolean | undefined;
}

function envelopeMeta(body: unknown): EnvelopeMeta {
  const meta: EnvelopeMeta = { warnings: [] };
  if (typeof body !== "object" || body === null || Array.isArray(body)) return meta;
  const record = body as Record<string, unknown>;
  if (typeof record.request_id === "string" && record.request_id.length > 0) {
    meta.requestId = record.request_id;
  }
  if (typeof record.cursor === "string" && record.cursor.length > 0) {
    meta.cursor = record.cursor;
  }
  if (Array.isArray(record.warnings)) {
    for (const entry of record.warnings) {
      if (typeof entry === "string" && entry.length > 0) meta.warnings.push(entry);
    }
  }
  if (typeof record.error === "object" && record.error !== null && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>;
    if (typeof error.code === "string") meta.errorCode = error.code;
    if (typeof error.message === "string") meta.errorMessage = error.message;
    if (typeof error.retryable === "boolean") meta.retryable = error.retryable;
  }
  return meta;
}

/** Map a canonical envelope error code to the SDK taxonomy. */
function envelopeCodeToSdk(code: string, status: number): SdkErrorCode {
  if (code === "UNAUTHENTICATED") return "sdk/unauthorized";
  if (code === "RIGHTS_RESTRICTED") return "sdk/forbidden";
  if (code === "FORBIDDEN_OR_NOT_FOUND") return "sdk/not-found";
  if (code === "RATE_LIMITED" || code === "QUOTA_EXCEEDED") return "sdk/rate-limited";
  if (code === "INVALID_INPUT") return "sdk/invalid";
  return statusToCode(status);
}

function extractResultField(body: unknown, field: string): unknown {
  const result = envelopeResult(body);
  if (result === null) return undefined;
  return (result as Record<string, unknown>)[field];
}

function extractResultArray(body: unknown, field: string): unknown[] | null {
  const value = extractResultField(body, field);
  return Array.isArray(value) ? value : null;
}

export class SkilitClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: SkilitClientOptions) {
    if (typeof options.baseUrl !== "string") {
      throw new SdkError("sdk/invalid", 0, "Base URL is invalid.");
    }
    const base = options.baseUrl.trim().replace(/\/+$/, "");
    let protocol = "";
    try {
      protocol = new URL(base).protocol;
    } catch {
      throw new SdkError("sdk/invalid", 0, "Base URL is invalid.");
    }
    const host = base.toLowerCase();
    const local = host.includes("://localhost") || host.includes("://127.0.0.1") || host.includes("://[::1]");
    if (protocol !== "https:" && !local) {
      throw new SdkError("sdk/invalid", 0, "Base URL must use HTTPS outside localhost.");
    }
    if (typeof options.token !== "string" || options.token.length === 0) {
      throw new SdkError("sdk/invalid", 0, "Token is invalid.");
    }
    this.baseUrl = base;
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
      throw new SdkError("sdk/invalid", 0, "Timeout is invalid.");
    }
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(
    path: string,
    query?: Record<string, string>,
    options?: { requestId?: string | undefined },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (typeof options?.requestId === "string" && options.requestId.length > 0) {
      headers["x-request-id"] = options.requestId.slice(0, 128);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Redirects are rejected, never followed: following would forward
      // the bearer token to wherever the server points.
      const response = await this.fetchImpl(url, {
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        let meta: EnvelopeMeta = { warnings: [] };
        try {
          meta = envelopeMeta(await response.json());
        } catch {
          // Non-JSON error bodies stay mapped by status alone.
        }
        const code =
          meta.errorCode !== undefined ? envelopeCodeToSdk(meta.errorCode, response.status) : statusToCode(response.status);
        throw new SdkError(code, response.status, `Request failed with status ${response.status}.`, {
          retryable: meta.retryable ?? code === "sdk/rate-limited",
          requestId: meta.requestId,
          envelopeCode: meta.errorCode,
        });
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof SdkError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SdkError("sdk/transport", 0, "Request timed out.");
      }
      throw new SdkError("sdk/transport", 0, "Request failed.");
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestWithMeta<T>(
    path: string,
    query?: Record<string, string>,
    options?: { requestId?: string | undefined },
  ): Promise<{ body: T; meta: EnvelopeMeta }> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (typeof options?.requestId === "string" && options.requestId.length > 0) {
      headers["x-request-id"] = options.requestId.slice(0, 128);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers,
        signal: controller.signal,
        redirect: "error",
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        throw new SdkError("sdk/transport", response.status, "Response shape is invalid.");
      }
      const meta = envelopeMeta(body);
      if (!response.ok) {
        const code =
          meta.errorCode !== undefined ? envelopeCodeToSdk(meta.errorCode, response.status) : statusToCode(response.status);
        throw new SdkError(code, response.status, `Request failed with status ${response.status}.`, {
          retryable: meta.retryable ?? code === "sdk/rate-limited",
          requestId: meta.requestId,
          envelopeCode: meta.errorCode,
        });
      }
      return { body: body as T, meta };
    } catch (error) {
      if (error instanceof SdkError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SdkError("sdk/transport", 0, "Request timed out.");
      }
      throw new SdkError("sdk/transport", 0, "Request failed.");
    } finally {
      clearTimeout(timer);
    }
  }

  /** Unified search across icons, logos, and fonts. */
  async searchAssets(input: { query: string; kinds?: string; limit?: number; cursor?: string; requestId?: string }): Promise<SdkAsset[]> {
    const page = await this.searchAssetsPage(input);
    return page.items;
  }

  /**
   * AF-03c cursor-aware search page. Reads are safe to retry: the same
   * cursor and limit deterministically return the same slice, and the
   * envelope request_id lets callers correlate retries without duplicating
   * canonical state.
   */
  async searchAssetsPage(input: SearchAssetsInput): Promise<SdkPage<SdkAsset>> {
    if (typeof input.query !== "string" || input.query.trim().length === 0) {
      throw new SdkError("sdk/invalid", 0, "Query is invalid.");
    }
    const query: Record<string, string> = { query: input.query };
    if (input.kinds !== undefined) query.kinds = input.kinds;
    if (input.limit !== undefined) query.limit = String(input.limit);
    if (input.cursor !== undefined) query.cursor = input.cursor;
    const { body, meta } = await this.requestWithMeta<unknown>("/api/v1/assets", query, {
      requestId: input.requestId,
    });
    const assets = extractResultArray(body, "assets");
    if (assets === null) {
      throw new SdkError("sdk/transport", 0, "Response shape is invalid.", { requestId: meta.requestId });
    }
    return { items: assets as SdkAsset[], cursor: meta.cursor, requestId: meta.requestId, warnings: meta.warnings };
  }

  /** Resolve one asset record with provenance and policy. */
  async getAsset(artifactId: string, options?: { requestId?: string | undefined }): Promise<SdkAsset> {
    if (typeof artifactId !== "string" || artifactId.length === 0) {
      throw new SdkError("sdk/invalid", 0, "Artifact ID is invalid.");
    }
    const body = await this.request<unknown>(
      `/api/v1/assets/${encodeURIComponent(artifactId)}`,
      undefined,
      options,
    );
    const asset = extractResultField(body, "asset");
    if (typeof asset !== "object" || asset === null) {
      throw new SdkError("sdk/transport", 0, "Response shape is invalid.");
    }
    return asset as SdkAsset;
  }

  /** Retrieve a canonical object by stable Skilit URI. */
  async getObject(uri: string, options?: { requestId?: string | undefined }): Promise<SdkObject | SdkPack> {
    if (typeof uri !== "string" || uri.length === 0) {
      throw new SdkError("sdk/invalid", 0, "URI is invalid.");
    }
    const body = await this.request<unknown>(
      "/api/v1/objects",
      { uri },
      options,
    );
    const object = extractResultField(body, "object");
    const pack = extractResultField(body, "pack");
    const hasObject = typeof object === "object" && object !== null;
    const hasPack = typeof pack === "object" && pack !== null;
    if (hasObject === hasPack) {
      throw new SdkError("sdk/transport", 0, "Response shape is invalid.");
    }
    return (hasObject ? object : pack) as SdkObject | SdkPack;
  }
}
