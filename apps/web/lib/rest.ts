import type { DbClient } from "../../../packages/db/src/db.ts";
import { resolveAssetForActor, searchAssetsForActorDetailed } from "../../../packages/assets/src/registry.ts";
import { SIMILARITY_KINDS, compareArtifactsForActor, findSimilarForActor } from "../../../packages/assets/src/similarity.ts";
import type { ComparedSide } from "../../../packages/assets/src/similarity.ts";
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
  const csvFilter = (value: string | string[] | undefined): string[] | undefined => {
    if (value === undefined) return undefined;
    const values = (Array.isArray(value) ? value.join(",") : value).split(",").map((item) => item.trim());
    if (values.length === 0 || values.some((item) => item.length === 0 || item.length > 64)) {
      throw new Error("filter-invalid");
    }
    return values;
  };
  let kinds: string[] | undefined;
  let rights: string[] | undefined;
  let licenses: string[] | undefined;
  try {
    kinds = csvFilter(query.kinds);
    rights = csvFilter(query.rights);
    licenses = csvFilter(query.licenses);
  } catch {
    return invalidInput(requestId, "Search filters are invalid.");
  }
  if (kinds !== undefined) {
    const allowedKinds = REGISTRY_KINDS as readonly string[];
    if (
      kinds.length === 0 ||
      kinds.length > allowedKinds.length ||
      kinds.some((kind) => !allowedKinds.includes(kind)) ||
      new Set(kinds).size !== kinds.length
    ) {
      return invalidInput(requestId, "Search kinds are invalid.");
    }
  }
  const allowedRights = ["unknown", "metadata_only", "permitted", "restricted"] as const;
  if (rights !== undefined) {
    if (
      rights.length === 0 ||
      rights.length > allowedRights.length ||
      rights.some((right) => !(allowedRights as readonly string[]).includes(right)) ||
      new Set(rights).size !== rights.length
    ) {
      return invalidInput(requestId, "Search filters are invalid.");
    }
  }
  if (licenses !== undefined) {
    if (
      licenses.length === 0 ||
      licenses.length > 32 ||
      new Set(licenses).size !== licenses.length
    ) {
      return invalidInput(requestId, "Search filters are invalid.");
    }
  }
  let trademarkFree: boolean | undefined;
  if (query.trademarkFree !== undefined) {
    if (query.trademarkFree !== "true" && query.trademarkFree !== "false") {
      return invalidInput(requestId, "Trademark filter is invalid.");
    }
    trademarkFree = query.trademarkFree === "true";
  }
  let includeFacets: boolean | undefined;
  if (query.facets !== undefined) {
    if (query.facets !== "true" && query.facets !== "false") {
      return invalidInput(requestId, "Facet option is invalid.");
    }
    includeFacets = query.facets === "true";
  }
  let collection: string | undefined;
  if (query.collection !== undefined) {
    if (typeof query.collection !== "string" || query.collection.trim().length === 0 ||
        query.collection.length > 200) {
      return invalidInput(requestId, "Collection filter is invalid.");
    }
    collection = query.collection.trim();
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
      rights?: string[];
      licenses?: string[];
      trademarkFree?: boolean;
      collection?: string;
      includeFacets?: boolean;
      limit: number;
      offset: number;
    } = { query: rawQuery.trim(), limit: limit + 1, offset };
    if (kinds !== undefined) search.kinds = kinds as ("icon" | "logo" | "font")[];
    if (rights !== undefined) search.rights = rights;
    if (licenses !== undefined) search.licenses = licenses;
    if (trademarkFree !== undefined) search.trademarkFree = trademarkFree;
    if (collection !== undefined) search.collection = collection;
    if (includeFacets !== undefined) search.includeFacets = includeFacets;
    const detailed = await searchAssetsForActorDetailed(db, search, actorId);
    const records = detailed.assets;
    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;
    const result: Record<string, unknown> = {
      assets: page.map(agentAssetView),
      search_mode: detailed.searchMode,
    };
    if (detailed.facets !== undefined) result.facets = detailed.facets;
    const body = successEnvelope(
      requestId,
      result,
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

/** GET /api/v1/assets/similar?artifactId= — deterministic similar artifacts.
 *
 * AF-13a-i: lexical Jaccard baseline, no embeddings. AF-SEC-00:
 * actor-scoped with the same no-oracle policy as the other read routes:
 * unknown, denied, and malformed references answer
 * FORBIDDEN_OR_NOT_FOUND, while a readable but restricted reference
 * answers RIGHTS_RESTRICTED (mirroring get_object single-read semantics).
 * Candidates keep search-style list semantics with rights labels.
 */
export async function findSimilarRoute(
  db: DbClient,
  query: Record<string, string | string[] | undefined>,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const rawId = query.artifactId;
  if (typeof rawId !== "string" || rawId.length === 0) {
    return invalidInput(requestId, "Similar reference is invalid.");
  }
  let kinds: string[] | undefined;
  if (query.kinds !== undefined) {
    const raw = Array.isArray(query.kinds) ? query.kinds.join(",") : query.kinds;
    kinds = raw.split(",").map((item) => item.trim());
    if (
      kinds.length === 0 ||
      kinds.length > SIMILARITY_KINDS.length ||
      kinds.some((kind) => !(SIMILARITY_KINDS as readonly string[]).includes(kind)) ||
      new Set(kinds).size !== kinds.length ||
      kinds.some((kind) => kind.length === 0)
    ) {
      return invalidInput(requestId, "Similar kinds are invalid.");
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
    const outcome = await findSimilarForActor(db, {
      artifactId: rawId,
      actorId,
      kinds,
      limit,
      offset,
    });
    if (outcome.reference.rightsClassification === "restricted") {
      const err = new AgentContractError("RIGHTS_RESTRICTED", {
        requestId,
        provenance: observedProvenance(`skelet://artifact/${outcome.reference.artifactId}`),
      });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    const warnings = outcome.truncated
      ? ["Candidate budget reached; results are a reproducible prefix."]
      : [];
    const body = successEnvelope(
      requestId,
      {
        reference: {
          uri: `skelet://artifact/${outcome.reference.artifactId}`,
          kind: outcome.reference.kind,
          title: outcome.reference.title,
        },
        similar: outcome.similar.map((entry) => ({ ...agentAssetView(entry), score: entry.score })),
        total: outcome.total,
        truncated: outcome.truncated,
      },
      {
        cursor: outcome.total > offset + limit ? encodeCursor(offset + limit) : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        partial: outcome.truncated,
        provenance: computedProvenance(`skelet://artifact/${outcome.reference.artifactId}`),
      },
    );
    return { status: 200, body };
  } catch (error) {
    if (error instanceof AgentContractError) {
      const withId = new AgentContractError(error.code, { requestId });
      return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
    }
    // Unknown, denied, and malformed references answer alike; unexpected
    // persistence failures stay opaque for operators.
    if (error instanceof Error && error.name === "RegistryError") {
      const err = new AgentContractError("FORBIDDEN_OR_NOT_FOUND", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    return opaque(requestId);
  }
}

/** GET /api/v1/assets/compare?left=&right= — observed two-artifact diff.
 *
 * AF-13a-ii: deterministic field comparison plus shared/unique lexical
 * terms; states what differs, never why. AF-SEC-00: either identifier is
 * never an oracle (malformed/unknown/denied answer
 * FORBIDDEN_OR_NOT_FOUND alike); a readable-but-restricted artifact on
 * either side answers RIGHTS_RESTRICTED, mirroring get_object.
 */
export async function compareArtifactsRoute(
  db: DbClient,
  query: Record<string, string | string[] | undefined>,
  actorId: string,
  providedRequestId?: unknown,
): Promise<RestResult> {
  const requestId = newRequestId(providedRequestId);
  const rawLeft = query.left;
  const rawRight = query.right;
  if (typeof rawLeft !== "string" || rawLeft.length === 0 || typeof rawRight !== "string" || rawRight.length === 0) {
    return invalidInput(requestId, "Compared references are invalid.");
  }
  try {
    const outcome = await compareArtifactsForActor(db, {
      leftArtifactId: rawLeft,
      rightArtifactId: rawRight,
      actorId,
    });
    if (outcome.left.rightsClassification === "restricted" || outcome.right.rightsClassification === "restricted") {
      const err = new AgentContractError("RIGHTS_RESTRICTED", { requestId });
      return { status: err.httpStatus, body: err.toFailureEnvelope() };
    }
    const withUris = (side: ComparedSide) => ({
      uri: `skelet://artifact/${side.artifactId}`,
      kind: side.kind,
      title: side.title,
      summary: side.summary,
      rights: side.rightsClassification,
      license: side.license,
      trademark: side.trademark,
      serving: side.serving,
      servingReason: side.servingReason,
      tags: side.tags,
    });
    const body = successEnvelope(
      requestId,
      {
        left: withUris(outcome.left),
        right: withUris(outcome.right),
        identical: outcome.identical,
        score: outcome.score,
        sharedTerms: outcome.sharedTerms,
        uniqueLeft: outcome.uniqueLeft,
        uniqueRight: outcome.uniqueRight,
        fieldDiffs: outcome.fieldDiffs,
      },
      { provenance: computedProvenance() },
    );
    return { status: 200, body };
  } catch (error) {
    if (error instanceof AgentContractError) {
      const withId = new AgentContractError(error.code, { requestId });
      return { status: withId.httpStatus, body: withId.toFailureEnvelope() };
    }
    // Either side is never an oracle; unexpected persistence failures
    // stay opaque for operators.
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
