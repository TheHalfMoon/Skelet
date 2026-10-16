export type SkilitEnvName = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WorkerEnv {
  SKILIT_ENV: SkilitEnvName;
  SKILIT_WORKER_CONCURRENCY: number;
  SKILIT_LOG_LEVEL: LogLevel;
  SKILIT_NO_MODEL: boolean;
}

const ENV_NAMES: readonly string[] = ["development", "test", "production"];
const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) {
    return 4;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `SKILIT_WORKER_CONCURRENCY must be a decimal integer 1-32, got ${JSON.stringify(raw)}`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error(
      `SKILIT_WORKER_CONCURRENCY must be a decimal integer 1-32, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

function parseName(
  key: string,
  raw: string | undefined,
  allowed: readonly string[],
  fallback: string,
): string {
  if (raw === undefined) {
    return fallback;
  }
  if (!allowed.includes(raw)) {
    throw new Error(
      `${key} must be one of ${allowed.join("|")}, got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function parseNoModelFlag(raw: string | undefined): boolean {
  if (raw === undefined) {
    return true;
  }
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  throw new Error(
    `SKILIT_NO_MODEL must be "1" or "0", got ${JSON.stringify(raw)}`,
  );
}

/**
 * Skilit rebrand migration: canonical namespace is SKILIT_*. Legacy SKELET_*
 * values remain readable so existing installs recover; SKILIT_* wins when
 * both are set. Unknown SKILIT_* keys still fail closed; legacy SKELET_*
 * keys other than the four known names are ignored (not failed) to avoid
 * breaking old environments during migration.
 */
function pickCanonical(
  source: NodeJS.ProcessEnv,
  canonicalKey: string,
  legacyKey: string,
): string | undefined {
  const canonical = source[canonicalKey];
  if (canonical !== undefined) return canonical;
  return source[legacyKey];
}

/** Validate the worker environment. Unknown SKILIT_* keys fail closed. */
export function loadEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const unknown = Object.keys(source).filter(
    (key) =>
      key.startsWith("SKILIT_") &&
      key !== "SKILIT_ENV" &&
      key !== "SKILIT_WORKER_CONCURRENCY" &&
      key !== "SKILIT_LOG_LEVEL" &&
      key !== "SKILIT_NO_MODEL",
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown environment keys rejected: ${unknown.sort().join(", ")}`,
    );
  }
  return {
    SKILIT_ENV: parseName(
      "SKILIT_ENV",
      pickCanonical(source, "SKILIT_ENV", "SKELET_ENV"),
      ENV_NAMES,
      "development",
    ) as SkilitEnvName,
    SKILIT_WORKER_CONCURRENCY: parseConcurrency(
      pickCanonical(
        source,
        "SKILIT_WORKER_CONCURRENCY",
        "SKELET_WORKER_CONCURRENCY",
      ),
    ),
    SKILIT_LOG_LEVEL: parseName(
      "SKILIT_LOG_LEVEL",
      pickCanonical(source, "SKILIT_LOG_LEVEL", "SKELET_LOG_LEVEL"),
      LOG_LEVELS,
      "info",
    ) as LogLevel,
    SKILIT_NO_MODEL: parseNoModelFlag(
      pickCanonical(source, "SKILIT_NO_MODEL", "SKELET_NO_MODEL"),
    ),
  };
}
