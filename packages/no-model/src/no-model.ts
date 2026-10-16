/**
 * AF-02 zero-model and egress conformance policy for Skilit.
 *
 * The mandatory Skilit path runs with no model API key, no GPU, and no
 * paid cloud subscription. URL capture may contact an explicitly authorized
 * public target website, but the mandatory path never calls a hosted model,
 * embedding, vector-search, crawler, or media-generation service.
 *
 * This module is pure and offline: no network, no clock, no randomness.
 * It declares explicit configuration states, forbidden credential names,
 * unapproved egress hosts, and fail-closed guards used by the worker
 * environment, the CI regression gate, and future AF-03/AF-04 wiring.
 */

export type NoModelErrorCode =
  | "no-model/egress-denied"
  | "no-model/credential-present"
  | "no-model/invalid-config";

export class NoModelError extends Error {
  readonly code: NoModelErrorCode;
  constructor(code: NoModelErrorCode, message: string) {
    super(message);
    this.name = "NoModelError";
    this.code = code;
  }
}

/**
 * Explicit configuration states for SKILIT_NO_MODEL.
 * "1" is strict zero-model mode and is the default when unset.
 * "0" is an explicit opt-out that is not qualified for launch acceptance.
 * Any other value fails closed.
 */
export const NO_MODEL_STRICT = "1";
export const NO_MODEL_OPT_OUT = "0";

/** Parse SKILIT_NO_MODEL into an explicit enabled flag. */
export function parseNoModelFlag(raw: string | undefined): boolean {
  if (raw === undefined) {
    return true;
  }
  if (raw === NO_MODEL_STRICT) {
    return true;
  }
  if (raw === NO_MODEL_OPT_OUT) {
    return false;
  }
  throw new NoModelError(
    "no-model/invalid-config",
    "SKILIT_NO_MODEL must be \"1\" or \"0\".",
  );
}

/**
 * Model and paid-provider credential names that must be absent in strict
 * zero-model mode. Values are never read or logged; only presence of a
 * non-empty value is reported by name.
 */
export const FORBIDDEN_MODEL_ENV_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "COHERE_API_KEY",
  "DEEPSEEK_API_KEY",
  "ELEVENLABS_API_KEY",
  "EMBEDDINGS_API_KEY",
  "FIRECRAWL_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACE_API_KEY",
  "LLM_API_KEY",
  "MISTRAL_API_KEY",
  "MODEL_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_ORG",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "REPLICATE_API_TOKEN",
  "STABILITY_API_KEY",
  "TOGETHER_API_KEY",
  "XAI_API_KEY",
  "ALGOLIA_API_KEY",
  "PINECONE_API_KEY",
  "QDRANT_API_KEY",
  "WEAVIATE_API_KEY",
  "ARTCRAFT_API_KEY",
];

/**
 * Hosts that the mandatory Skilit path never contacts. Target-website
 * capture uses the explicitly validated capture URL only; any attempt to
 * reach one of these hosts in strict mode is denied fail-closed.
 * Entries are lowercase hostnames without ports or schemes.
 */
export const UNAPPROVED_EGRESS_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "api.cohere.com",
  "api.deepseek.com",
  "api.elevenlabs.io",
  "api.firecrawl.dev",
  "api.fireworks.ai",
  "api.groq.com",
  "api.huggingface.co",
  "api.mistral.ai",
  "api.openai.com",
  "api.openrouter.ai",
  "api.perplexity.ai",
  "api.replicate.com",
  "api.runpod.ai",
  "api.stability.ai",
  "api.together.xyz",
  "api.x.ai",
  "aiplatform.googleapis.com",
  "generativelanguage.googleapis.com",
  "inference.huggingface.co",
  "api-inference.huggingface.co",
  "api.pinecone.io",
  "api.algolia.net",
  "api.weaviate.cloud",
  "api.qdrant.cloud",
  "api.scrapingbee.com",
];

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, "");
}

/** True when the host is on the unapproved egress deny list. */
export function isUnapprovedEgressHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (normalized.length === 0) {
    return false;
  }
  for (const denied of UNAPPROVED_EGRESS_HOSTS) {
    if (normalized === denied || normalized.endsWith(`.${denied}`)) {
      return true;
    }
  }
  return false;
}

/** Extract the hostname from an absolute http(s) URL or return null. */
export function hostOfUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.hostname.toLowerCase();
}

/**
 * Fail closed when a URL targets unapproved model or paid-cloud egress.
 * Non-http(s) URLs and unparsable URLs are denied as well: callers must
 * validate the capture URL first and use this guard only for egress policy.
 */
export function assertNoUnapprovedEgress(url: string): void {
  const host = hostOfUrl(url);
  if (host === null) {
    throw new NoModelError(
      "no-model/egress-denied",
      "Egress target is not an absolute http(s) URL.",
    );
  }
  if (isUnapprovedEgressHost(host)) {
    throw new NoModelError(
      "no-model/egress-denied",
      `Egress to ${host} is denied in zero-model mode.`,
    );
  }
}

export interface NoModelEnvReport {
  enabled: boolean;
  /** Sorted forbidden names present with a non-empty value. No values included. */
  forbiddenPresent: string[];
}

/**
 * Inspect an environment for strict-mode credential presence.
 * Never returns secret values, only variable names.
 */
export function inspectNoModelEnv(source: NodeJS.ProcessEnv): NoModelEnvReport {
  const enabled = parseNoModelFlag(source.SKILIT_NO_MODEL);
  const forbiddenPresent: string[] = [];
  if (enabled) {
    for (const name of FORBIDDEN_MODEL_ENV_VARS) {
      const value = source[name];
      if (typeof value === "string" && value.length > 0) {
        forbiddenPresent.push(name);
      }
    }
    forbiddenPresent.sort();
  }
  return { enabled, forbiddenPresent };
}

/**
 * Fail closed when strict zero-model mode is enabled and any forbidden
 * model or paid-provider credential is present with a non-empty value.
 */
export function validateNoModelEnv(source: NodeJS.ProcessEnv): NoModelEnvReport {
  const report = inspectNoModelEnv(source);
  if (report.enabled && report.forbiddenPresent.length > 0) {
    throw new NoModelError(
      "no-model/credential-present",
      `Zero-model mode forbids credentials: ${report.forbiddenPresent.join(", ")}.`,
    );
  }
  return report;
}

export interface ProviderEgressDescriptor {
  egress: "none" | "local" | "external";
  costClass?: string;
}

/**
 * Fail closed when a provider requires external egress while strict
 * zero-model mode is enabled. Local and none egress always pass.
 * Deterministic local fallback stays available; external providers must
 * be explicitly approved outside the mandatory path.
 */
export function assertProviderAllowed(
  provider: ProviderEgressDescriptor,
  noModelEnabled: boolean,
): void {
  if (noModelEnabled && provider.egress === "external") {
    throw new NoModelError(
      "no-model/egress-denied",
      "External-egress providers are denied in zero-model mode.",
    );
  }
}

export interface NoModelStatus {
  enabled: boolean;
  egress: "deny-unapproved";
  forbiddenCount: number;
}

/** Redacted status descriptor for health payloads and CI evidence. */
export function describeNoModelStatus(source: NodeJS.ProcessEnv): NoModelStatus {
  const report = inspectNoModelEnv(source);
  return {
    enabled: report.enabled,
    egress: "deny-unapproved",
    forbiddenCount: report.forbiddenPresent.length,
  };
}
