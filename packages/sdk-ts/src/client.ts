/**
 * G08-05 Skelet TypeScript SDK: a thin typed client over REST API v1.
 * Zero runtime dependencies; works in Node 20+ with the global fetch.
 * Every method returns domain objects with stable Skelet URIs; transport
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
  constructor(code: SdkErrorCode, status: number, message: string) {
    super(message);
    this.name = "SdkError";
    this.code = code;
    this.status = status;
  }
}

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

export interface SkeletClientOptions {
  baseUrl: string;
  token: string;
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

export class SkeletClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: SkeletClientOptions) {
    if (typeof options.baseUrl !== "string" || options.baseUrl.trim().length === 0) {
      throw new SdkError("sdk/invalid", 0, "Base URL is invalid.");
    }
    if (typeof options.token !== "string" || options.token.length === 0) {
      throw new SdkError("sdk/invalid", 0, "Token is invalid.");
    }
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300_000) {
      throw new SdkError("sdk/invalid", 0, "Timeout is invalid.");
    }
    this.timeoutMs = timeoutMs;
  }

  private async request<T>(path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SdkError(
          statusToCode(response.status),
          response.status,
          `Request failed with status ${response.status}.`,
        );
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

  /** Unified search across icons, logos, and fonts. */
  async searchAssets(input: { query: string; kinds?: string; limit?: number }): Promise<SdkAsset[]> {
    if (typeof input.query !== "string" || input.query.trim().length === 0) {
      throw new SdkError("sdk/invalid", 0, "Query is invalid.");
    }
    const query: Record<string, string> = { query: input.query };
    if (input.kinds !== undefined) query.kinds = input.kinds;
    if (input.limit !== undefined) query.limit = String(input.limit);
    const body = await this.request<{ assets: SdkAsset[] }>("/api/v1/assets", query);
    if (!Array.isArray(body?.assets)) {
      throw new SdkError("sdk/transport", 0, "Response shape is invalid.");
    }
    return body.assets;
  }

  /** Resolve one asset record with provenance and policy. */
  async getAsset(artifactId: string): Promise<SdkAsset> {
    if (typeof artifactId !== "string" || artifactId.length === 0) {
      throw new SdkError("sdk/invalid", 0, "Artifact ID is invalid.");
    }
    const body = await this.request<{ asset: SdkAsset }>(
      `/api/v1/assets/${encodeURIComponent(artifactId)}`,
    );
    if (body?.asset === undefined) {
      throw new SdkError("sdk/transport", 0, "Response shape is invalid.");
    }
    return body.asset;
  }

  /** Retrieve a canonical object by stable Skelet URI. */
  async getObject(uri: string): Promise<SdkObject | SdkPack> {
    if (typeof uri !== "string" || uri.length === 0) {
      throw new SdkError("sdk/invalid", 0, "URI is invalid.");
    }
    const body = await this.request<{ object?: SdkObject; pack?: SdkPack }>(
      "/api/v1/objects",
      { uri },
    );
    if (body?.object !== undefined) return body.object;
    if (body?.pack !== undefined) return body.pack;
    throw new SdkError("sdk/transport", 0, "Response shape is invalid.");
  }
}
