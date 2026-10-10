/**
 * G09-03: the ONLY HTTP ingress for the Lens capture child.
 *
 * Playwright is offline during DOM rendering. All network bytes are read
 * here instead, through a DNS-pinned socket AFTER the URL/IP safety gate.
 * Redirects are manually resolved and guarded before their first byte.
 */
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import {
  guardRedirectTarget, validateAndResolve, validateCaptureUrl,
  type DnsResolver,
} from "./url-guard.ts";

export const CAPTURE_BUDGET = Object.freeze({
  maxHtmlBytes: 1_000_000,
  maxRedirects: 5,
  networkMs: 12_000,
  pageMs: 5_000,
  workerMs: 22_000,
  maxScreenshotBytes: 2_000_000,
  maxSections: 48,
  maxAssets: 100,
});

export type CaptureErrorCode =
  | "capture/blocked" | "capture/timeout" | "capture/too-large"
  | "capture/unsupported" | "capture/network" | "capture/browser";

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  constructor(code: CaptureErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "CaptureError";
  }
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: Uint8Array;
}

export interface PinnedHttpTransport {
  get(href: string, pinnedIp: string, timeoutMs: number, byteBudget: number): Promise<HttpResponse>;
}

export const systemDns: DnsResolver = {
  async resolve(hostname) {
    const literal = hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1) : hostname;
    if (isIP(literal)) return [literal];
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return answers.map((answer) => answer.address);
  },
};

/** Do not use global fetch: its resolver might rebind after policy validation. */
export const pinnedHttp: PinnedHttpTransport = {
  get(href, pinnedIp, timeoutMs, byteBudget) {
    return new Promise((resolve, reject) => {
      const url = new URL(href);
      const family = isIP(pinnedIp);
      if (family !== 4 && family !== 6) {
        reject(new CaptureError("capture/blocked", "DNS pin was not an IP address."));
        return;
      }
      const makeRequest = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = makeRequest(url, {
        method: "GET",
        agent: false,
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "accept-encoding": "identity",
          "user-agent": "SkeletLensCapture/0.1",
        },
        lookup: (_hostname, options, cb) => {
          // Node autoSelectFamily requests options.all=true. Respect the lookup overload.
          const callback = cb as unknown as (err: Error | null, addr: string | { address: string; family: number }[], family?: number) => void;
          if (typeof options === "object" && options.all) {
            callback(null, [{ address: pinnedIp, family }]);
          } else {
            callback(null, pinnedIp, family);
          }
        },
        timeout: timeoutMs,
      }, (response) => {
        const headers = {
          location: typeof response.headers.location === "string" ? response.headers.location : undefined,
          "content-type": typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : undefined,
          "content-encoding": typeof response.headers["content-encoding"] === "string" ? response.headers["content-encoding"] : undefined,
          "content-length": typeof response.headers["content-length"] === "string" ? response.headers["content-length"] : undefined,
        };
        let total = 0;
        const chunks: Buffer[] = [];
        const size = Number(headers["content-length"]);
        if (headers["content-length"] !== undefined && (!Number.isSafeInteger(size) || size < 0 || size > byteBudget)) {
          response.destroy(new CaptureError("capture/too-large", "Declared download exceeds capture budget."));
          return;
        }
        response.on("data", (part: Buffer) => {
          total += part.length;
          if (total > byteBudget) {
            response.destroy(new CaptureError("capture/too-large", "Download exceeds capture budget."));
            return;
          }
          chunks.push(part);
        });
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks),
        }));
        response.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new CaptureError("capture/timeout", "Download timed out.")));
      req.on("error", reject);
      req.end();
    });
  },
};

export interface GuardedHtml {
  href: string;
  html: string;
  sha256: string;
  redirects: number;
  byteCount: number;
}

/** Injectable transport / resolver provide fully offline malicious-network tests. */
export async function fetchGuardedHtml(
  input: string,
  resolver: DnsResolver = systemDns,
  transport: PinnedHttpTransport = pinnedHttp,
  now: () => number = Date.now,
): Promise<GuardedHtml> {
  const initial = validateCaptureUrl(input);
  let href = initial.href;
  let ips = (await validateAndResolve(initial.hostname, resolver)).ips;
  let redirects = 0;
  let downloadedBytes = 0;
  const deadline = now() + CAPTURE_BUDGET.networkMs;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(href)) throw new CaptureError("capture/blocked", "Redirect cycle detected.");
    visited.add(href);
    const ms = deadline - now();
    if (ms <= 0) throw new CaptureError("capture/timeout", "Capture network budget elapsed.");
    // The transport MUST use this exact guarded address, not re-resolve href.
    const response = await transport.get(
      href, ips[0] as string, ms, CAPTURE_BUDGET.maxHtmlBytes - downloadedBytes,
    );
    downloadedBytes += response.body.byteLength;
    if (downloadedBytes > CAPTURE_BUDGET.maxHtmlBytes) {
      throw new CaptureError("capture/too-large", "Download exceeds capture budget.");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new CaptureError("capture/network", "Redirect has no Location.");
      const next = await guardRedirectTarget(location, href, redirects, resolver);
      href = next.url.href;
      ips = next.ips;
      redirects = next.hopsUsed;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new CaptureError("capture/network", "Capture target did not return HTML.");
    }
    const contentType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
      throw new CaptureError("capture/unsupported", "Capture accepts HTML only.");
    }
    if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
      throw new CaptureError("capture/unsupported", "Compressed responses are not accepted.");
    }
    let html: string;
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
    } catch {
      throw new CaptureError("capture/unsupported", "Non-UTF8 HTML cannot be captured.");
    }
    return {
      href, html, redirects, byteCount: response.body.byteLength,
      sha256: createHash("sha256").update(response.body).digest("hex"),
    };
  }
}
