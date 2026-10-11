import type { DbClient } from "../../../packages/db/src/db.ts";
import { resolveAssetForActor, searchAssetsForActor } from "../../../packages/assets/src/registry.ts";
import { getArtifactForActor } from "../../../packages/db/src/artifact-access.ts";
import { listReferences } from "../../../packages/db/src/collections.ts";
import { exportReferencePack, parseSkeletUri } from "./reference-packs.ts";
import {
  AGENT_SCHEMA_VERSION,
  AgentContractError,
  computedProvenance,
  decodeCursor,
  encodeCursor,
  failureEnvelope,
  newRequestId,
  observedProvenance,
  parseSearchLimit,
  requireCapability,
  successEnvelope,
} from "./agent-contract.ts";
import type { AgentEnvelope } from "./agent-contract.ts";

/**
 * AF-03b REST API v1 read parity: the human/UI-readable surface over the
 * same canonical envelope the MCP tools serve. Versioned by URL (/api/v1)
 * for transport and by skelet.agent.v1 for the envelope; breaking envelope
 * changes require a governed contract revision. Every endpoint requires a
 * session-bound identity; unknown and denied objects both answer
 * FORBIDDEN_OR_NOT_FOUND so existence is not an oracle.
 *
 * All domain bodies are AgentEnvelope. HTTP statuses derive from the one
 * canonical error catalog in agent-contract.ts.
 */

export interface RestResult {
  status: number;
  body: AgentEnvelope;
}

function agentAssetView(record: {
  artifactId: string;
  kind: string;
  title: string;
  license: string;
  rightsClassification: string;
  serving: string;
  servingReason: string;
  sourceKey: string;
  contentHash: string;
}): Record<string, unknown> {
  return {
    uri: `skelet://artifact/${record.artifactId}`,
    kind: record.kind,
    title: record.title,
    license: record.license,
    rights: record.rightsClassification,
    serving: record.serving,
    servingReason: record.servingReason,
    source: record.sourceKey,
    contentHash: record.contentHash,
  };
}

const REGISTRY_KINDS = ["icon", "logo", "font"] as const;

function invalidInput(requestId: string, message: string): RestResult {
  const err = new AgentContractError("INVALID_INPUT", { message, requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

function opaque(requestId: string): RestResult {
  const err = new AgentContractError("INTERNAL_OPAQUE", { requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

/** GET /api/v1/assets — unified search with facet filters and cursor pagination.
 *
 * AF-SEC-00: actor-scoped. The caller identity is server-resolved by the
 * route; public rows plus workspace rows readable by that actor are
 * returned. Scope filters before rank/facets/caching.
 *
 * AF-03b: versioned envelope with request_id, typed result, cursor for
 * pagination, and canonical INVALID_INPUT for malformed pagination.
 */
export async function searchAssetsRoute(
  db: DbClient,
  query: Record<string, string | string[] | undefined>,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const rawQuery = query.query;
  if (typeof rawQuery !== "string" || rawQuery.trim().length === 0 || rawQuery.trim().length > 200) {
    return invalidInput(requestId, "Search query is invalid.");
  }
  const kinds = query.kinds === undefined ? undefined : String(query.kinds).split(",");
  if (kinds !== undefined) {
    if (
      kinds.length === 0 ||
      kinds.some((kind) => !(REGISTRY_KINDS as readonly string[]).includes(kind.trim()))
    ) {
      return invalidInput(requestId, "Search kinds are invalid.");
    }
  }
  let limit: number;
  try {
    limit = parseSearchLimit(query.limit);
  } catch (thrown) {
    if (thrown instanceof AgentContractError) {
      return { status: thrown.httpStatus, body: thrown.toFailureEnvelope() };
    }
    return opaque(requestId);
  }
  let offset = 0;
  if (query.cursor !== undefined) {
    try {
      offset = decodeCursor(query.cursor);
    } catch (thrown) {
      if (thrown instanceof AgentContractError) {
        const withId = new AgentContractError("INVALID_INPUT", {
          message: "Pagination cursor is invalid.",
          requestId,
        });
        return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
      }
      return opaque(requestId);
    }
  }
  try {
    const search: {
      query: string;
      kinds?: ("icon" | "logo" | "font")[];
      limit: number;
      offset: number;
    } = { query: rawQuery.trim(), limit: limit + 1, offset };
    if (kinds !== undefined) {
      search.kinds = kinds.map((kind) => kind.trim()) as ("icon" | "logo" | "font")[];
    }
    const records = await searchAssetsForActor(db, search, actorId);
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const body = successEnvelope(
      requestId,
      { assets: page.map(agentAssetView) },
      {
        cursor: hasMore ? encodeCursor(offset + limit) : undefined,
        provenance: computedProvenance(),
      },
    );
    return { status: 200, body };
  } catch (error) {
    if (error instanceof AgentContractError) {
      const withId = new AgentContractError(error.code, {
        message: error.code === "INVALID_INPUT" ? error.safeMessage : undefined,
        requestId,
      });
      return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
    }
    // Registry validation failures are client input; persistence failures
    // stay opaque with no internals.
    if (error instanceof Error && error.name === "RegistryError") {
      return invalidInput(requestId, "Search query is invalid.");
    }
    return opaque(requestId);
  }
}

/** GET /api/v1/assets/[id] — resolve one record with policy.
 *
 * AF-SEC-00: actor-scoped. Unknown and denied identifiers answer alike.
 * AF-03b: restricted rights answer RIGHTS_RESTRICTED (403) after the actor
 * gate passes; unknown/denied/malformed answer FORBIDDEN_OR_NOT_FOUND.
 */
export async function getAssetRoute(
  db: DbClient,
  artifactId: string,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  try {
    const record = await resolveAssetForActor(db, artifactId, actorId);
    if (record.rightsClassification === "restricted") {
      const err = new AgentContractError("RIGHTS_RESTRICTED", {
        requestId,
        provenance: observedProvenance(`skelet://artifact/${artifactId}`),
      });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    const warnings =
      record.serving === "metadata-only" ? [`Rights note: ${record.servingReason}`.slice(0, 512)] : [];
    const body = successEnvelope(
      requestId,
      { asset: agentAssetView(record) },
      {
        warnings: warnings.length > 0 ? warnings : undefined,
        provenance: observedProvenance(`skelet://artifact/${record.artifactId}`),
      },
    );
    return { status: 200, body };
  } catch (error) {
    if (error instanceof AgentContractError) {
      const withId = new AgentContractError(error.code, { requestId });
      return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
    }
    // Unknown and malformed identifiers answer alike; unexpected
    // persistence failures stay opaque for operators.
    if (error instanceof Error && error.name === "RegistryError") {
      const err = new AgentContractError("FORBIDDEN_OR_NOT_FOUND", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    return opaque(requestId);
  }
}

/** GET /api/v1/objects?uri= — retrieve by stable Skelet URI. */
export async function getObjectRoute(
  db: DbClient,
  uri: string | undefined,
  userId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  if (typeof uri !== "string") {
    return invalidInput(requestId, "Object URI is invalid.");
  }
  let parsed;
  try {
    parsed = parseSkeletUri(uri);
  } catch {
    return invalidInput(requestId, "Object URI is invalid.");
  }
  try {
    if (parsed.type === "artifact") {
      const artifact = await getArtifactForActor(db, parsed.id, userId);
      if (artifact === null) {
        const err = new AgentContractError("FORBIDDEN_OR_NOT_FOUND", { requestId });
        return { status: err.httpStatus, body: err.toFailureEnvelope() };
      }
      if (artifact.rightsClassification === "restricted") {
        const err = new AgentContractError("RIGHTS_RESTRICTED", {
          requestId,
          provenance: observedProvenance(uri),
        });
        return { status: err.httpStatus, body: err.toFailureEnvelope() };
      }
      const body = successEnvelope(
        requestId,
        {
          object: {
            uri,
            kind: artifact.kind,
            title: artifact.title,
            rights: artifact.rightsClassification,
          },
        },
        { provenance: observedProvenance(uri) },
      );
      return { status: 200, body };
    }
    try {
      requireCapability("packs", requestId);
      const pack = await exportReferencePack(db, parsed.id, userId);
      // Partial when denied/missing items were withheld: compare the
      // collection reference count against the exported count without
      // leaking which items were withheld.
      let partial = false;
      let warnings: string[] | undefined;
      try {
        const refs = await listReferences(db, parsed.id, userId);
        if (refs.length > pack.itemCount) {
          partial = true;
          warnings = ["Some references were withheld by rights or visibility."];
        }
      } catch {
        // Reference count is best-effort; export already succeeded.
      }
      const body = successEnvelope(
        requestId,
        { pack },
        {
          provenance: observedProvenance(pack.uri),
          warnings,
          partial,
        },
      );
      return { status: 200, body };
    } catch (error) {
      if (error instanceof AgentContractError) {
        const withId = new AgentContractError(error.code, { requestId });
        return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
      }
      // Unknown and denied packs answer alike; anything else is opaque.
      if (error instanceof Error && (error.name === "PackError" || error.name === "AuthError")) {
        const code = (error as { code?: unknown }).code;
        if (code === "packs/invalid") {
          return invalidInput(requestId, "Object URI is invalid.");
        }
        const err = new AgentContractError("FORBIDDEN_OR_NOT_FOUND", { requestId });
        return { status: err.httpStatus, body: err.toFailureEnvelope() };
      }
      return opaque(requestId);
    }
  } catch (error) {
    if (error instanceof AgentContractError) {
      const withId = new AgentContractError(error.code, { requestId });
      return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
    }
    return opaque(requestId);
  }
}

export { AGENT_SCHEMA_VERSION };
export type { AgentEnvelope };
export { failureEnvelope, successEnvelope };
