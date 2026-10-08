export type SkeletEnvName = "development" | "test" | "production";
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WorkerEnv {
  SKELET_ENV: SkeletEnvName;
  SKELET_WORKER_CONCURRENCY: number;
  SKELET_LOG_LEVEL: LogLevel;
}

const ENV_NAMES: readonly string[] = ["development", "test", "production"];
const LOG_LEVELS: readonly string[] = ["debug", "info", "warn", "error"];

function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined) {
    return 4;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `SKELET_WORKER_CONCURRENCY must be a decimal integer 1-32, got ${JSON.stringify(raw)}`,
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error(
      `SKELET_WORKER_CONCURRENCY must be a decimal integer 1-32, got ${JSON.stringify(raw)}`,
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

/** Validate the worker environment. Unknown SKELET_* keys fail closed. */
export function loadEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const unknown = Object.keys(source).filter(
    (key) =>
      key.startsWith("SKELET_") &&
      key !== "SKELET_ENV" &&
      key !== "SKELET_WORKER_CONCURRENCY" &&
      key !== "SKELET_LOG_LEVEL",
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown environment keys rejected: ${unknown.sort().join(", ")}`,
    );
  }
  return {
    SKELET_ENV: parseName(
      "SKELET_ENV",
      source.SKELET_ENV,
      ENV_NAMES,
      "development",
    ) as SkeletEnvName,
    SKELET_WORKER_CONCURRENCY: parseConcurrency(
      source.SKELET_WORKER_CONCURRENCY,
    ),
    SKELET_LOG_LEVEL: parseName(
      "SKELET_LOG_LEVEL",
      source.SKELET_LOG_LEVEL,
      LOG_LEVELS,
      "info",
    ) as LogLevel,
  };
}
