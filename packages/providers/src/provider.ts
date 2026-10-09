/**
 * G05-02 provider contract: every donor or external engine sits behind a
 * Skelet-owned adapter implementing this interface. The contract carries
 * capability identity, version pin, deterministic configuration,
 * timeout/cancellation behavior, output validation, provenance emission,
 * error classification, health reporting, and egress/cost declarations.
 * Provider failures never redefine Skelet's public schemas: they surface
 * as typed ProviderError codes instead.
 *
 * Timeouts and cancellations are enforced by settling the invocation,
 * not merely by signaling it: a provider that ignores its AbortSignal
 * still loses the race and the caller receives provider/timeout or
 * provider/canceled promptly. Callers must treat error messages and
 * health details as untrusted provider output (redact and encode before
 * logging or API return).
 */

export type EgressClass = "none" | "local" | "external";

export type ProviderErrorCode =
  | "provider/timeout"
  | "provider/canceled"
  | "provider/unavailable"
  | "provider/malformed-output"
  | "provider/failed";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export interface ProviderContext {
  /** Cancellation signal for this invocation. */
  signal: AbortSignal;
}

export interface ProviderProvenance {
  providerId: string;
  capability: string;
  version: string;
  egress: EgressClass;
  costClass: string;
  detail: Record<string, unknown>;
}

export interface ProviderDefinition<Input, Output> {
  /** Stable adapter identifier, e.g. "dembrandt-tokens". */
  id: string;
  /** Capability identifier, e.g. "design-tokens". */
  capability: string;
  /** Exact upstream version pin (commit, release, or content hash). */
  version: string;
  /** Where this provider's execution and data may travel. */
  egress: EgressClass;
  /** Cost attribution class; "free-local" default keeps launch paths honest. */
  costClass?: string;
  /** Deterministic configuration record for replay and audit. */
  config: Record<string, unknown>;
  invoke(input: Input, ctx: ProviderContext): Promise<Output>;
  /** Input guard; a false verdict is a caller bug and fails fast. */
  checkInput?(input: unknown): input is Input;
  /** Output guard; a false verdict becomes provider/malformed-output. */
  checkOutput?(output: unknown): output is Output;
  /** Liveness probe; must never throw to callers (see checkHealth). */
  health(): Promise<{ ok: boolean; detail?: string }>;
  provenance(input: Input, output: Output): Record<string, unknown>;
}

export interface InvocationResult<Output> {
  output: Output;
  provenance: ProviderProvenance;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;
const ERROR_MESSAGE_MAX_CHARS = 2000;

function truncate(message: string): string {
  return message.length > ERROR_MESSAGE_MAX_CHARS
    ? message.slice(0, ERROR_MESSAGE_MAX_CHARS)
    : message;
}

function timeoutError(): ProviderError {
  return new ProviderError("provider/timeout", "Provider timed out.");
}

function canceledError(): ProviderError {
  return new ProviderError("provider/canceled", "Provider invocation was canceled.");
}

/**
 * Invoke a provider with a bounded timeout and caller cancellation.
 * Timeout expiry throws provider/timeout; caller aborts throw
 * provider/canceled; provider-raised ProviderErrors pass through;
 * anything else becomes provider/failed; a failed output guard becomes
 * provider/malformed-output. Provenance is emitted only on success.
 */
export async function invokeProvider<Input, Output>(
  provider: ProviderDefinition<Input, Output>,
  input: Input,
  options?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<InvocationResult<Output>> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ProviderError("provider/failed", "Provider timeout is invalid.");
  }
  if (options?.signal?.aborted ?? false) {
    throw canceledError();
  }
  if (provider.checkInput !== undefined && !provider.checkInput(input)) {
    throw new ProviderError("provider/failed", "Provider input is invalid.");
  }
  const started = Date.now();
  const controller = new AbortController();
  const callerSignal = options?.signal;
  const callerAborted = (): boolean => callerSignal?.aborted ?? false;
  let rejectOnAbort!: (error: ProviderError) => void;
  const abortSettles = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onCallerAbort = (): void => {
    controller.abort();
    rejectOnAbort(canceledError());
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  let rejectOnTimeout!: (error: ProviderError) => void;
  const timeoutSettles = new Promise<never>((_resolve, reject) => {
    rejectOnTimeout = reject;
  });
  const timer = setTimeout(() => {
    controller.abort();
    rejectOnTimeout(timeoutError());
  }, timeoutMs);
  try {
    // The race settles the caller even when invoke() ignores its signal.
    const output = await Promise.race([
      provider.invoke(input, { signal: controller.signal }),
      abortSettles,
      timeoutSettles,
    ]);
    if (controller.signal.aborted) {
      throw callerAborted() ? canceledError() : timeoutError();
    }
    if (provider.checkOutput !== undefined && !provider.checkOutput(output)) {
      throw new ProviderError("provider/malformed-output", "Provider output is invalid.");
    }
    return {
      output,
      provenance: {
        providerId: provider.id,
        capability: provider.capability,
        version: provider.version,
        egress: provider.egress,
        costClass: provider.costClass ?? "free-local",
        detail: provider.provenance(input, output),
      },
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw callerAborted() ? canceledError() : timeoutError();
    }
    throw new ProviderError(
      "provider/failed",
      truncate(error instanceof Error ? error.message : "Provider failed."),
    );
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

export interface HealthReport {
  ok: boolean;
  detail?: string;
}

/** Health probe that never throws: failures report ok:false instead. */
export async function checkHealth<Input, Output>(
  provider: ProviderDefinition<Input, Output>,
): Promise<HealthReport> {
  try {
    const report = await provider.health();
    const healthy: HealthReport = { ok: report.ok };
    if (report.detail !== undefined) {
      healthy.detail = report.detail;
    }
    return healthy;
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Health probe failed.",
    };
  }
}

export interface ProviderRegistry {
  register<Input, Output>(provider: ProviderDefinition<Input, Output>): void;
  get<Input, Output>(id: string): ProviderDefinition<Input, Output>;
  listByCapability(capability: string): string[];
}

/** In-process provider registry keyed by stable adapter identifier. */
export function createRegistry(): ProviderRegistry {
  const providers = new Map<string, ProviderDefinition<unknown, unknown>>();
  return {
    register<Input, Output>(provider: ProviderDefinition<Input, Output>): void {
      if (typeof provider.id !== "string" || provider.id.trim().length === 0) {
        throw new ProviderError("provider/failed", "Provider identifier is invalid.");
      }
      if (typeof provider.capability !== "string" || provider.capability.trim().length === 0) {
        throw new ProviderError("provider/failed", "Provider capability is invalid.");
      }
      if (providers.has(provider.id)) {
        throw new ProviderError(
          "provider/failed",
          `Provider already registered: ${provider.id}.`,
        );
      }
      providers.set(provider.id, Object.freeze({
        ...provider,
        config: Object.freeze({ ...provider.config }),
      }) as ProviderDefinition<unknown, unknown>);
    },
    get<Input, Output>(id: string): ProviderDefinition<Input, Output> {
      const provider = providers.get(id);
      if (provider === undefined) {
        throw new ProviderError("provider/unavailable", "Provider is not registered.");
      }
      return provider as ProviderDefinition<Input, Output>;
    },
    listByCapability(capability: string): string[] {
      const ids: string[] = [];
      for (const [id, provider] of providers) {
        if (provider.capability === capability) {
          ids.push(id);
        }
      }
      return ids.sort();
    },
  };
}
