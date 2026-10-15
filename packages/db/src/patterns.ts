import type { DbTransaction } from "./db.ts";
import { getArtifactForActor } from "./artifact-access.ts";

/**
 * P10-C pattern taxonomy reads (smallest taxonomy grain).
 *
 * Lists patterns and pattern detail over the canonical `patterns` plus
 * `relations` tables without introducing a second canonical database.
 * A pattern is listed only when at least one linked artifact is readable
 * by the actor through the AF-SEC-00 central gate, so taxonomy browsing
 * never leaks titles of fully-withheld evidence. Unknown slugs and
 * patterns with zero readable artifacts both read as empty (no existence
 * oracle); malformed identifiers fail closed as invalid input.
 *
 * Adopted relation shape: a pattern links to an artifact through
 * `appears_in` or `references` in either direction
 * (pattern -> artifact or artifact -> pattern). Other relation types and
 * non-artifact counterparts do not confer visibility.
 *
 * Pagination is deterministic (slug order) with an examined cap that
 * reports truncated instead of silently dropping candidates.
 */

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1_000_000;
const MAX_PATTERNS_EXAMINED = 200;
const MAX_QUERY_CHARS = 64;
const MAX_TITLE_CHARS = 128;
const MAX_DESCRIPTION_CHARS = 2_000;

export const PATTERN_LINK_RELATIONS = ["appears_in", "references"] as const;

export class PatternError extends Error {
  readonly code: "pattern/invalid-input" | "pattern/not-found";
  constructor(code: PatternError["code"], message: string) {
    super(message);
    this.name = "PatternError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new PatternError("pattern/invalid-input", message);
}

export interface PatternEntry {
  slug: string;
  title: string;
  artifactCount: number;
}

export interface PatternLink {
  uri: string;
  kind: string;
  title: string;
  relation: string;
}

export interface PatternDetail {
  slug: string;
  title: string;
  description: string | undefined;
  links: PatternLink[];
}

/** Taxonomy validation for pattern identities and metadata. */
export function validatePatternTaxonomy(raw: unknown): {
  slug: string;
  title: string;
  description: string | undefined;
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("Pattern taxonomy entry is invalid.");
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.slug !== "string" || !SLUG_PATTERN.test(record.slug)) {
    fail("Pattern slug is invalid.");
  }
  if (
    typeof record.title !== "string" ||
    record.title.length === 0 ||
    record.title.length > MAX_TITLE_CHARS
  ) {
    fail("Pattern title is invalid.");
  }
  if (record.description !== undefined) {
    if (
      typeof record.description !== "string" ||
      record.description.length > MAX_DESCRIPTION_CHARS
    ) {
      fail("Pattern description is invalid.");
    }
  }
  return {
    slug: record.slug,
    title: record.title,
    description: record.description as string | undefined,
  };
}

function validateActor(actorId: unknown): string {
  if (typeof actorId !== "string" || actorId.length === 0) {
    fail("Actor is invalid.");
  }
  return actorId;
}

function validateLimitOffset(limit: unknown, offset: unknown): {
  limit: number;
  offset: number;
} {
  const resolvedLimit = (limit as number | undefined) ?? DEFAULT_LIMIT;
  if (!Number.isInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > MAX_LIMIT) {
    fail("Pattern limit is invalid.");
  }
  const resolvedOffset = (offset as number | undefined) ?? 0;
  if (!Number.isInteger(resolvedOffset) || resolvedOffset < 0 || resolvedOffset > MAX_OFFSET) {
    fail("Pattern cursor is invalid.");
  }
  return { limit: resolvedLimit, offset: resolvedOffset };
}

function validateQuery(query: unknown): string | undefined {
  if (query === undefined) return undefined;
  if (typeof query !== "string" || query.length === 0 || query.length > MAX_QUERY_CHARS) {
    fail("Pattern query is invalid.");
  }
  if (query.includes("\0")) {
    fail("Pattern query is invalid.");
  }
  return query.toLowerCase();
}

interface PatternRow {
  id: string;
  slug: string;
  title: string;
  description: string | undefined;
}

async function linkedArtifactIds(
  tx: DbTransaction,
  patternId: string,
  actorId: string,
): Promise<{ id: string; kind: string; title: string; relation: string }[]> {
  const rows = (
    await tx.query(
      `select from_type, from_id, relation_type, to_type, to_id from relations
       where relation_type = any($1)
       and ((from_type = 'pattern' and from_id = $2) or (to_type = 'pattern' and to_id = $2))
       order by relation_type asc, from_id asc, to_id asc`,
      [[...PATTERN_LINK_RELATIONS], patternId],
    )
  ).rows as Record<string, unknown>[];
  const seen = new Set<string>();
  const readable: { id: string; kind: string; title: string; relation: string }[] = [];
  for (const row of rows) {
    const relation = String(row.relation_type);
    let artifactId: string | null = null;
    if (String(row.from_type) === "pattern" && String(row.to_type) === "artifact") {
      artifactId = String(row.to_id);
    } else if (String(row.to_type) === "pattern" && String(row.from_type) === "artifact") {
      artifactId = String(row.from_id);
    }
    if (artifactId === null || seen.has(`${relation}:${artifactId}`)) continue;
    seen.add(`${relation}:${artifactId}`);
    const artifact = await getArtifactForActor(tx, artifactId, actorId);
    if (artifact === null) continue;
    readable.push({ id: artifact.id, kind: artifact.kind, title: artifact.title, relation });
  }
  readable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return readable;
}

export async function listPatternsForActor(
  tx: DbTransaction,
  input: { actorId: string; limit?: number | undefined; offset?: number | undefined; query?: string | undefined },
): Promise<{ patterns: PatternEntry[]; total: number; truncated: boolean }> {
  const actorId = validateActor(input.actorId);
  const { limit, offset } = validateLimitOffset(input.limit, input.offset);
  const query = validateQuery(input.query);
  const rows = (
    await tx.query(
      `select id, slug, title, description from patterns order by slug asc, id asc limit $1`,
      [MAX_PATTERNS_EXAMINED + 1],
    )
  ).rows as Record<string, unknown>[];
  const truncated = rows.length > MAX_PATTERNS_EXAMINED;
  const examined = (truncated ? rows.slice(0, MAX_PATTERNS_EXAMINED) : rows) as Record<string, unknown>[];
  const visible: (PatternRow & { artifactCount: number })[] = [];
  for (const row of examined) {
    const patternId = String(row.id);
    const links = await linkedArtifactIds(tx, patternId, actorId);
    if (links.length === 0) continue;
    visible.push({
      id: patternId,
      slug: String(row.slug),
      title: String(row.title),
      description: row.description == null ? undefined : String(row.description),
      artifactCount: links.length,
    });
  }
  const filtered =
    query === undefined
      ? visible
      : visible.filter(
          (entry) =>
            entry.slug.toLowerCase().includes(query) ||
            entry.title.toLowerCase().includes(query),
        );
  return {
    patterns: filtered.slice(offset, offset + limit).map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      artifactCount: entry.artifactCount,
    })),
    total: filtered.length,
    truncated,
  };
}

export async function getPatternForActor(
  tx: DbTransaction,
  input: { actorId: string; slug: string },
): Promise<PatternDetail | null> {
  const actorId = validateActor(input.actorId);
  if (typeof input.slug !== "string" || !SLUG_PATTERN.test(input.slug)) {
    fail("Pattern slug is invalid.");
  }
  const rows = (
    await tx.query(`select id, slug, title, description from patterns where slug = $1 order by id asc limit 2`, [
      input.slug,
    ])
  ).rows as Record<string, unknown>[];
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  const links = await linkedArtifactIds(tx, String(row.id), actorId);
  if (links.length === 0) return null;
  return {
    slug: String(row.slug),
    title: String(row.title),
    description: row.description == null ? undefined : String(row.description),
    links: links.map((link) => ({
      uri: `skelet://artifact/${link.id}`,
      kind: link.kind,
      title: link.title,
      relation: link.relation,
    })),
  };
}
