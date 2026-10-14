import { createHash } from "node:crypto";
import type { DbTransaction } from "./db.ts";
import { getArtifactForActor } from "./artifact-access.ts";
import { listFlowSteps } from "./workflows.ts";
import type { Artifact } from "./graph.ts";

/**
 * AF-15a deterministic version-change service (P13 smallest grain).
 *
 * Compares two ProductVersions of the SAME product using only persisted
 * evidence. No scheduling, no meaningful-change scoring, no model prose.
 *
 * Matching (explicit, no intent inference):
 * - Artifacts match by exact `(kind, title)` within their version.
 *   A rename appears as remove + add, never as a detected rename.
 * - Flows match by exact `title` within their version.
 *   Step order is compared by artifact keys; same set in different
 *   order reports `reordered`, different sets report `changed`.
 *
 * Authorization (fail-closed, no oracle):
 * - Both version IDs must exist; missing, malformed, or cross-product
 *   pairs never reveal which side failed beyond the typed code:
 *   unknown/malformed/denied versions answer `changes/not-found`
 *   (transports map to FORBIDDEN_OR_NOT_FOUND), cross-product answers
 *   `changes/unsupported` (transports map to INVALID_INPUT).
 * - Artifacts are filtered by the AF-SEC-00 actor gate BEFORE diffing,
 *   so unreadable titles never appear in change records.
 * - Flows are visible only when every step artifact is readable;
 *   partially readable flows are invisible, never partial.
 * - Rights travel as labels on artifact change entries; bytes are
 *   never served here, only metadata plus deterministic IDs.
 *
 * Determinism:
 * - Change records sort by (objectKind, key) with byte comparison.
 * - Change IDs are stable hashes of (fromVersion, toVersion, kind, key).
 * - Repeating the same comparison returns byte-identical records.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000_000;

export class ChangesError extends Error {
  readonly code: "changes/invalid-input" | "changes/not-found" | "changes/unsupported";
  constructor(code: ChangesError["code"], message: string) {
    super(message);
    this.name = "ChangesError";
    this.code = code;
  }
}

function fail(code: ChangesError["code"], message: string): never {
  throw new ChangesError(code, message);
}

export type ArtifactChangeKind = "added" | "removed" | "changed";
export type FlowChangeKind = "added" | "removed" | "changed" | "reordered";
export type ObjectKind = "artifact" | "flow";

export interface ArtifactSnapshot {
  artifactId: string;
  kind: string;
  title: string;
  summary: string | null;
  canonicalText: string | null;
  contentHash: string;
  rightsClassification: string;
  visibility: string;
  tags: string[];
  uri: string;
}

export interface FlowSnapshot {
  flowId: string;
  title: string;
  uri: string;
  steps: { position: number; uri: string; key: string }[];
}

export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ChangeRecord {
  id: string;
  objectKind: ObjectKind;
  change: ArtifactChangeKind | FlowChangeKind;
  key: string;
  title: string;
  from: ArtifactSnapshot | FlowSnapshot | null;
  to: ArtifactSnapshot | FlowSnapshot | null;
  fieldDiffs: FieldDiff[];
}

export interface ChangesResult {
  productId: string;
  fromVersionId: string;
  toVersionId: string;
  fromVersionNo: number;
  toVersionNo: number;
  identical: boolean;
  changes: ChangeRecord[];
  total: number;
}

function artifactFallbackKey(artifact: { kind: string; title: string }): string {
  return `${artifact.kind}::${artifact.title}`;
}

const EXTERNAL_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Stable cross-version identity preserving source identities.
 * Corpus-imported artifacts carry an import-ledger external ID of the
 * form `artifact:{product}:{version}:{artifactExternal}`; the trailing
 * segment is stable across versions and disambiguates duplicate titles.
 * Direct-created artifacts have no ledger entry and fall back to
 * exact `(kind, title)` with the documented precondition that callers
 * keep those unique per version (the qualified corpus path always has
 * ledger entries, so duplicate titles there resolve correctly).
 */
async function stableArtifactKey(tx: DbTransaction, artifact: Artifact): Promise<string> {
  const result = await tx.query(
    `select external_id from import_records where canonical_type = 'artifact' and canonical_id = $1 limit 1`,
    [artifact.id],
  );
  const external = (result.rows[0] as Record<string, unknown> | undefined)?.external_id;
  if (typeof external === "string") {
    const parts = external.split(":");
    if (parts.length === 4 && parts[0] === "artifact" && typeof parts[3] === "string" && EXTERNAL_SUFFIX.test(parts[3] as string)) {
      return `${artifact.kind}::ext:${parts[3]}`;
    }
  }
  return artifactFallbackKey(artifact);
}

/**
 * Stable cross-version flow identity. Corpus flows carry
 * `flow:{product}:{version}:{flowExternal}` ledger IDs; the trailing
 * segment is stable across versions. Direct-created flows fall back
 * to exact title with the same uniqueness precondition as artifacts.
 */
async function stableFlowKey(tx: DbTransaction, flowId: string, title: string): Promise<string> {
  const result = await tx.query(
    `select external_id from import_records where canonical_type = 'flow' and canonical_id = $1 limit 1`,
    [flowId],
  );
  const external = (result.rows[0] as Record<string, unknown> | undefined)?.external_id;
  if (typeof external === "string") {
    const parts = external.split(":");
    if (parts.length === 4 && parts[0] === "flow" && typeof parts[3] === "string" && EXTERNAL_SUFFIX.test(parts[3] as string)) {
      return `ext:${parts[3]}`;
    }
  }
  return title;
}

function changeId(fromVersionId: string, toVersionId: string, objectKind: ObjectKind, key: string): string {
  const digest = createHash("sha256")
    .update(`${fromVersionId}|${toVersionId}|${objectKind}|${key}`)
    .digest("hex")
    .slice(0, 16);
  return `chg_${digest}`;
}

function artifactTags(artifact: Artifact): string[] {
  const metadata: unknown = artifact.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return [];
  const tags: unknown = (metadata as Record<string, unknown>).tags;
  if (!Array.isArray(tags)) return [];
  return (tags.filter((tag): tag is string => typeof tag === "string") as string[]).sort();
}

function toSnapshot(artifact: Artifact): ArtifactSnapshot {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary ?? null,
    canonicalText: artifact.canonicalText ?? null,
    contentHash: artifact.contentHash,
    rightsClassification: artifact.rightsClassification,
    visibility: artifact.visibility ?? "private",
    tags: artifactTags(artifact),
    uri: `skelet://artifact/${artifact.id}`,
  };
}

/**
 * User-visible equality across versions. contentHash is intentionally
 * excluded: the qualified corpus importer bakes the version identity
 * into the hash, so identical logical content hashes differently
 * across versions. Equality uses summary, canonical text, rights,
 * visibility, and sorted tags; the hash still travels as evidence
 * in each snapshot. Byte-level changes invisible in these fields
 * are out of scope for AF-15a.
 */
function snapshotFieldDiffs(from: ArtifactSnapshot, to: ArtifactSnapshot): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const fields: (keyof Pick<ArtifactSnapshot, "summary" | "canonicalText" | "rightsClassification" | "visibility">)[] = [
    "summary",
    "canonicalText",
    "rightsClassification",
    "visibility",
  ];
  for (const field of fields) {
    if (from[field] !== to[field]) {
      diffs.push({ field, from: from[field], to: to[field] });
    }
  }
  if (from.tags.length !== to.tags.length || from.tags.some((tag, index) => tag !== to.tags[index])) {
    diffs.push({ field: "tags", from: from.tags, to: to.tags });
  }
  return diffs;
}

interface VersionRow {
  id: string;
  product_id: string;
  version_no: number;
}

async function loadVersion(tx: DbTransaction, versionId: string): Promise<VersionRow | null> {
  if (typeof versionId !== "string" || !UUID_PATTERN.test(versionId)) return null;
  const result = await tx.query(
    `select id, product_id, version_no from product_versions where id = $1`,
    [versionId],
  );
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (row === undefined) return null;
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    version_no: Number(row.version_no),
  };
}

async function readableArtifactsForVersion(
  tx: DbTransaction,
  versionId: string,
  actorId: string,
): Promise<Artifact[]> {
  const result = await tx.query(
    `select id,kind,product_id,product_version_id,title,summary,
      canonical_text,metadata,source_id,source_record_id,captured_at,created_at,
      updated_at,content_hash,rights_classification,visibility,workspace_id,owner_subject
      from artifacts where product_version_id = $1 order by id asc`,
    [versionId],
  );
  const readable: Artifact[] = [];
  for (const raw of result.rows) {
    const id = String((raw as Record<string, unknown>).id);
    const artifact = await getArtifactForActor(tx, id, actorId);
    if (artifact !== null) readable.push(artifact);
  }
  return readable;
}

interface VisibleFlow {
  flowId: string;
  title: string;
  productVersionId: string;
  steps: { position: number; artifactId: string }[];
}

async function visibleFlowsForVersion(
  tx: DbTransaction,
  versionId: string,
  actorId: string,
): Promise<VisibleFlow[]> {
  const result = await tx.query(
    `select id, title, product_version_id from flows where product_version_id = $1 order by title asc, id asc`,
    [versionId],
  );
  const visible: VisibleFlow[] = [];
  for (const raw of result.rows) {
    const record = raw as Record<string, unknown>;
    const flowId = String(record.id);
    const steps = await listFlowSteps(tx, flowId);
    let ok = true;
    for (const step of steps) {
      if ((await getArtifactForActor(tx, step.artifactId, actorId)) === null) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    visible.push({
      flowId,
      title: String(record.title),
      productVersionId: String(record.product_version_id),
      steps: steps.map((step) => ({ position: step.position, artifactId: step.artifactId })),
    });
  }
  return visible;
}

/**
 * Deterministic two-version diff for one authenticated actor.
 * Throws ChangesError invalid-input for malformed IDs/limits,
 * not-found when either version is missing or unreadable as a version
 * (no oracle distinguishing the two sides), unsupported when the two
 * versions belong to different products.
 */
export async function getChangesForActor(
  tx: DbTransaction,
  input: {
    actorId: string;
    fromVersionId: string;
    toVersionId: string;
    limit?: number | undefined;
    offset?: number | undefined;
  },
): Promise<ChangesResult> {
  if (typeof input.actorId !== "string" || input.actorId.length === 0) {
    fail("changes/invalid-input", "Actor is invalid.");
  }
  if (
    typeof input.fromVersionId !== "string" ||
    !UUID_PATTERN.test(input.fromVersionId) ||
    typeof input.toVersionId !== "string" ||
    !UUID_PATTERN.test(input.toVersionId)
  ) {
    fail("changes/invalid-input", "Version comparison is invalid.");
  }
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    fail("changes/invalid-input", "Change limit is invalid.");
  }
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    fail("changes/invalid-input", "Change cursor is invalid.");
  }

  const fromVersion = await loadVersion(tx, input.fromVersionId);
  const toVersion = await loadVersion(tx, input.toVersionId);
  if (fromVersion === null || toVersion === null) {
    fail("changes/not-found", "Version comparison was not found.");
  }
  const fromV: VersionRow = fromVersion as VersionRow;
  const toV: VersionRow = toVersion as VersionRow;
  if (fromV.product_id !== toV.product_id) {
    fail("changes/unsupported", "Version comparison is not supported.");
  }

  if (fromV.id === toV.id) {
    return {
      productId: fromV.product_id,
      fromVersionId: fromV.id,
      toVersionId: toV.id,
      fromVersionNo: fromV.version_no,
      toVersionNo: toV.version_no,
      identical: true,
      changes: [],
      total: 0,
    };
  }

  const fromArtifacts = await readableArtifactsForVersion(tx, fromV.id, input.actorId);
  const toArtifacts = await readableArtifactsForVersion(tx, toV.id, input.actorId);

  const fromByKey = new Map<string, Artifact>();
  for (const artifact of fromArtifacts) fromByKey.set(await stableArtifactKey(tx, artifact), artifact);
  const toByKey = new Map<string, Artifact>();
  for (const artifact of toArtifacts) toByKey.set(await stableArtifactKey(tx, artifact), artifact);

  const allKeys = new Set<string>([...fromByKey.keys(), ...toByKey.keys()]);
  const records: ChangeRecord[] = [];

  for (const key of allKeys) {
    const from = fromByKey.get(key) ?? null;
    const to = toByKey.get(key) ?? null;
    if (from !== null && to === null) {
      const snapshot = toSnapshot(from);
      records.push({
        id: changeId(fromV.id, toV.id, "artifact", key),
        objectKind: "artifact",
        change: "removed",
        key,
        title: from.title,
        from: snapshot,
        to: null,
        fieldDiffs: [],
      });
    } else if (from === null && to !== null) {
      const snapshot = toSnapshot(to);
      records.push({
        id: changeId(fromV.id, toV.id, "artifact", key),
        objectKind: "artifact",
        change: "added",
        key,
        title: to.title,
        from: null,
        to: snapshot,
        fieldDiffs: [],
      });
    } else if (from !== null && to !== null) {
      const fromSnap = toSnapshot(from);
      const toSnap = toSnapshot(to);
      const diffs = snapshotFieldDiffs(fromSnap, toSnap);
      if (diffs.length > 0) {
        records.push({
          id: changeId(fromV.id, toV.id, "artifact", key),
          objectKind: "artifact",
          change: "changed",
          key,
          title: to.title,
          from: fromSnap,
          to: toSnap,
          fieldDiffs: diffs,
        });
      }
    }
  }

  const fromFlows = await visibleFlowsForVersion(tx, fromV.id, input.actorId);
  const toFlows = await visibleFlowsForVersion(tx, toV.id, input.actorId);
  const fromFlowByKey = new Map<string, VisibleFlow>();
  for (const flow of fromFlows) fromFlowByKey.set(await stableFlowKey(tx, flow.flowId, flow.title), flow);
  const toFlowByKey = new Map<string, VisibleFlow>();
  for (const flow of toFlows) toFlowByKey.set(await stableFlowKey(tx, flow.flowId, flow.title), flow);

  const fromArtifactKeyById = new Map<string, string>();
  for (const artifact of fromArtifacts) fromArtifactKeyById.set(artifact.id, await stableArtifactKey(tx, artifact));
  const toArtifactKeyById = new Map<string, string>();
  for (const artifact of toArtifacts) toArtifactKeyById.set(artifact.id, await stableArtifactKey(tx, artifact));

  const flowKeys = new Set<string>([...fromFlowByKey.keys(), ...toFlowByKey.keys()]);
  for (const key of flowKeys) {
    const from = fromFlowByKey.get(key) ?? null;
    const to = toFlowByKey.get(key) ?? null;
    if (from !== null && to === null) {
      const ordered = [...from.steps].sort((a, b) => a.position - b.position);
      records.push({
        id: changeId(fromV.id, toV.id, "flow", key),
        objectKind: "flow",
        change: "removed",
        key,
        title: from.title,
        from: {
          flowId: from.flowId,
          title: from.title,
          uri: `skelet://flow/${from.flowId}`,
          steps: ordered.map((step) => ({
            position: step.position,
            uri: `skelet://artifact/${step.artifactId}`,
            key: fromArtifactKeyById.get(step.artifactId) ?? `artifact::${step.artifactId}`,
          })),
        },
        to: null,
        fieldDiffs: [],
      });
    } else if (from === null && to !== null) {
      const ordered = [...to.steps].sort((a, b) => a.position - b.position);
      records.push({
        id: changeId(fromV.id, toV.id, "flow", key),
        objectKind: "flow",
        change: "added",
        key,
        title: to.title,
        from: null,
        to: {
          flowId: to.flowId,
          title: to.title,
          uri: `skelet://flow/${to.flowId}`,
          steps: ordered.map((step) => ({
            position: step.position,
            uri: `skelet://artifact/${step.artifactId}`,
            key: toArtifactKeyById.get(step.artifactId) ?? `artifact::${step.artifactId}`,
          })),
        },
        fieldDiffs: [],
      });
    } else if (from !== null && to !== null) {
      const fromOrdered = [...from.steps].sort((a, b) => a.position - b.position);
      const toOrdered = [...to.steps].sort((a, b) => a.position - b.position);
      const fromSeq = fromOrdered.map((step) => fromArtifactKeyById.get(step.artifactId) ?? `artifact::${step.artifactId}`);
      const toSeq = toOrdered.map((step) => toArtifactKeyById.get(step.artifactId) ?? `artifact::${step.artifactId}`);
      const sameOrder = fromSeq.length === toSeq.length && fromSeq.every((value, index) => value === toSeq[index]);
      if (sameOrder) continue;
      const sameSet =
        fromSeq.length === toSeq.length &&
        [...fromSeq].sort().every((value, index) => value === [...toSeq].sort()[index]);
      const change: FlowChangeKind = sameSet ? "reordered" : "changed";
      const fieldDiffs: FieldDiff[] = sameSet
        ? [{ field: "steps.order", from: fromSeq, to: toSeq }]
        : [{ field: "steps", from: fromSeq, to: toSeq }];
      records.push({
        id: changeId(fromV.id, toV.id, "flow", key),
        objectKind: "flow",
        change,
        key,
        title: to.title,
        from: {
          flowId: from.flowId,
          title: from.title,
          uri: `skelet://flow/${from.flowId}`,
          steps: fromOrdered.map((step) => ({
            position: step.position,
            uri: `skelet://artifact/${step.artifactId}`,
            key: fromArtifactKeyById.get(step.artifactId) ?? `artifact::${step.artifactId}`,
          })),
        },
        to: {
          flowId: to.flowId,
          title: to.title,
          uri: `skelet://flow/${to.flowId}`,
          steps: toOrdered.map((step) => ({
            position: step.position,
            uri: `skelet://artifact/${step.artifactId}`,
            key: toArtifactKeyById.get(step.artifactId) ?? `artifact::${step.artifactId}`,
          })),
        },
        fieldDiffs,
      });
    }
  }

  records.sort((left, right) => {
    if (left.objectKind !== right.objectKind) return left.objectKind < right.objectKind ? -1 : 1;
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
    return left.id < right.id ? -1 : 1;
  });

  const page = records.slice(offset, offset + limit);
  return {
    productId: fromV.product_id,
    fromVersionId: fromV.id,
    toVersionId: toV.id,
    fromVersionNo: fromV.version_no,
    toVersionNo: toV.version_no,
    identical: records.length === 0,
    changes: page,
    total: records.length,
  };
}
