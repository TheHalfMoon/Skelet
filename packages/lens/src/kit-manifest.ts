/**
 * G09b-05 kit manifest assembler.
 *
 * Pure and deterministic: given kit identities, a lens report binding,
 * a capture scope, traversed pages, and artifact payloads with rights
 * classifications, produce the frozen `skilit.lens.build-kit.v1`
 * manifest object. Mirrors `schemas/lens-build-kit.schema.json` and
 * `scripts/validate_build_kit.py` rule for rule; the Python validator
 * remains the canonical gate and every assembled fixture here is
 * cross-checked against it before merge.
 *
 * Rights firewall: `redistributable` is derived, never trusted
 * (`true` only for `permitted` bytes). `partitionKitArtifacts`
 * splits a manifest into shippable versus withheld paths so
 * restricted, trademarked, and unknown bytes never enter a
 * downloadable set.
 *
 * Contract observation: the v1 `artifact.kind` enum names
 * `asset-inventory`, but no legal kit path accepts that kind (fixed
 * paths and the `starter/` + `screenshots/` prefixes each pin their
 * kind). The assembler fails closed on it rather than guessing a
 * placement.
 */

export const KIT_MANIFEST_VERSION = "skilit.lens.build-kit.v1" as const;
export const LENS_REPORT_SCHEMA = "skilit.lens.report.v1" as const;
export const GENERATED_LABEL =
  "generated-starter-is-skilit-synthesis-not-original-source" as const;
export const REDISTRIBUTABLE_NOTE =
  "Only artifacts marked redistributable may be downloaded; unknown, restricted, and trademarked bytes are withheld." as const;

export type KitManifestStatus =
  | "queued" | "capturing" | "extracting" | "generating" | "validating"
  | "completed" | "partial" | "failed" | "canceled";

const STATUSES: ReadonlySet<string> = new Set([
  "queued", "capturing", "extracting", "generating", "validating",
  "completed", "partial", "failed", "canceled",
]);

export type KitScopeMode = "single-page" | "selected-pages" | "bounded-sitemap";
export type KitViewport = "desktop" | "mobile";
export type KitClassification = "permitted" | "unknown" | "restricted" | "trademarked";

const HEX64 = /^[0-9a-f]{64}$/;

const FIXED_ARTIFACT_KINDS: Readonly<Record<string, string>> = {
  "manifest.json": "manifest",
  "lens.json": "report",
  "DESIGN.md": "design-record",
  "tokens.dtcg.json": "tokens",
  "tailwind.theme.js": "theme",
  "shadcn-theme.css": "theme",
  "AGENT.md": "agent-pack",
};

const PREFIX_KINDS: ReadonlyArray<[string, string]> = [
  ["starter/", "starter-file"],
  ["screenshots/", "screenshot"],
];

export interface KitManifestPage {
  url: string;
  sha256: string;
  viewport: KitViewport;
  sectionRefs?: string[];
}

export interface KitManifestArtifactInput {
  path: string;
  kind: string;
  sha256: string;
  bytes: number;
  classification: KitClassification;
}

export interface KitManifestRequest {
  kitId: string;
  analysisId: string;
  status: KitManifestStatus;
  report: { analysisId: string; sha256: string };
  scope: {
    mode: KitScopeMode;
    maxPages: number;
    maxDepth: number;
    maxBytes: number;
    timeBudgetMs: number;
  };
  pages: KitManifestPage[];
  artifacts: KitManifestArtifactInput[];
  provenance: { observed: string[]; deterministic: string[]; coverageGaps: string[] };
}

export interface KitManifestRights {
  classification: KitClassification;
  redistributable: boolean;
}

export interface KitManifestArtifact {
  path: string;
  kind: string;
  sha256: string;
  bytes: number;
  rights: KitManifestRights;
}

export interface KitManifest {
  schema_version: typeof KIT_MANIFEST_VERSION;
  kit_id: string;
  analysis_id: string;
  status: KitManifestStatus;
  lens_report: { schema: typeof LENS_REPORT_SCHEMA; analysis_id: string; sha256: string };
  capture_scope: {
    mode: KitScopeMode;
    max_pages: number;
    max_depth: number;
    max_bytes: number;
    time_budget_ms: number;
  };
  pages: Array<{ url: string; sha256: string; viewport: KitViewport; section_refs: string[] }>;
  artifacts: KitManifestArtifact[];
  rights_policy: { default_classification: "unknown"; redistributable_note: string };
  provenance: {
    observed: string[];
    deterministic: string[];
    heuristic: [];
    model_generated: [];
    coverage_gaps: string[];
    generated_label: typeof GENERATED_LABEL;
  };
}

export class KitManifestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KitManifestError";
    this.code = code;
  }
}

function invalid(message: string): KitManifestError {
  return new KitManifestError("kit-manifest/invalid-request", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hex64(value: unknown, what: string): string {
  if (typeof value !== "string" || !HEX64.test(value)) {
    throw invalid(`${what} must be 64 lowercase hex characters.`);
  }
  return value;
}

function stringList(value: unknown, what: string, maxItem: number): string[] {
  if (!Array.isArray(value)) throw invalid(`${what} must be a string list.`);
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > maxItem) {
      throw invalid(`${what} entries must be 1 to ${maxItem} characters.`);
    }
  }
  return [...value];
}

function validKitPath(path: string): boolean {
  if (path.length === 0 || path.length > 256) return false;
  if (path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  if (path in FIXED_ARTIFACT_KINDS) return true;
  return PREFIX_KINDS.some(([prefix]) => path.startsWith(prefix) && path.length > prefix.length);
}

function expectedKind(path: string): string | undefined {
  const fixed = FIXED_ARTIFACT_KINDS[path];
  if (fixed !== undefined) return fixed;
  for (const [prefix, kind] of PREFIX_KINDS) {
    if (path.startsWith(prefix)) return kind;
  }
  return undefined;
}

const KNOWN_REQUEST_FIELDS = new Set([
  "kitId", "analysisId", "status", "report", "scope", "pages", "artifacts", "provenance",
]);

/**
 * Assemble a schema-valid kit manifest. Every rule mirrors the frozen
 * v1 contract; any violation fails closed with a typed error. Artifact
 * order is preserved; page order is preserved.
 */
export function assembleKitManifest(input: KitManifestRequest): KitManifest {
  if (!isRecord(input)) throw invalid("Kit manifest request must be an object.");
  for (const key of Object.keys(input)) {
    if (!KNOWN_REQUEST_FIELDS.has(key)) throw invalid(`Unknown manifest field: ${key}.`);
  }
  const kitId = hex64(input.kitId, "Kit ID");
  const analysisId = hex64(input.analysisId, "Analysis ID");
  if (typeof input.status !== "string" || !STATUSES.has(input.status)) {
    throw invalid("Kit status is out of contract.");
  }
  const status = input.status as KitManifestStatus;

  if (!isRecord(input.report)) throw invalid("Lens report binding must be an object.");
  const reportAnalysisId = hex64(input.report.analysisId, "Report analysis ID");
  if (reportAnalysisId !== analysisId) {
    throw invalid("Report binding must equal the kit analysis ID.");
  }
  const reportSha = hex64(input.report.sha256, "Report SHA-256");

  if (!isRecord(input.scope)) throw invalid("Capture scope must be an object.");
  const { mode, maxPages, maxDepth, maxBytes, timeBudgetMs } = input.scope as Record<string, unknown>;
  if (mode !== "single-page" && mode !== "selected-pages" && mode !== "bounded-sitemap") {
    throw invalid("Capture scope mode is out of contract.");
  }
  const ranges: ReadonlyArray<[string, unknown, number, number]> = [
    ["max_pages", maxPages, 1, 25],
    ["max_depth", maxDepth, 0, 3],
    ["max_bytes", maxBytes, 1, 52428800],
    ["time_budget_ms", timeBudgetMs, 1000, 600000],
  ];
  for (const [name, value, lo, hi] of ranges) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < lo || value > hi) {
      throw invalid(`Capture scope ${name} is out of range.`);
    }
  }

  if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.length > 25) {
    throw invalid("Manifest pages must list 1 to 25 pages.");
  }
  const pages = input.pages.map((page, index) => {
    if (!isRecord(page)) throw invalid(`Page ${index} must be an object.`);
    if (typeof page.url !== "string" || !page.url.startsWith("https://") || page.url.length > 2048) {
      throw invalid(`Page ${index} URL must be an https URL within 2048 characters.`);
    }
    const sha256 = hex64(page.sha256, `Page ${index} SHA-256`);
    if (page.viewport !== "desktop" && page.viewport !== "mobile") {
      throw invalid(`Page ${index} viewport is out of contract.`);
    }
    const sectionRefs = page.sectionRefs === undefined
      ? []
      : stringList(page.sectionRefs, `Page ${index} section references`, 256);
    return { url: page.url, sha256, viewport: page.viewport, section_refs: sectionRefs };
  });

  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0 || input.artifacts.length > 500) {
    throw invalid("Manifest artifacts must list 1 to 500 artifacts.");
  }
  const seen = new Set<string>();
  const artifacts: KitManifestArtifact[] = input.artifacts.map((artifact, index) => {
    if (!isRecord(artifact)) throw invalid(`Artifact ${index} must be an object.`);
    if (typeof artifact.path !== "string" || !validKitPath(artifact.path)) {
      throw invalid(`Artifact ${index} path is not an allowed kit path.`);
    }
    if (seen.has(artifact.path)) throw invalid(`Artifact ${index} repeats path ${artifact.path}.`);
    seen.add(artifact.path);
    const kind = expectedKind(artifact.path);
    if (kind === undefined || artifact.kind !== kind) {
      throw invalid(`Artifact ${index} kind does not match its kit path.`);
    }
    const sha256 = hex64(artifact.sha256, `Artifact ${index} SHA-256`);
    if (typeof artifact.bytes !== "number" || !Number.isInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > 16777216) {
      throw invalid(`Artifact ${index} byte size is out of range.`);
    }
    if (
      artifact.classification !== "permitted" &&
      artifact.classification !== "unknown" &&
      artifact.classification !== "restricted" &&
      artifact.classification !== "trademarked"
    ) {
      throw invalid(`Artifact ${index} rights classification is out of contract.`);
    }
    return {
      path: artifact.path,
      kind: artifact.kind,
      sha256,
      bytes: artifact.bytes,
      rights: {
        classification: artifact.classification,
        redistributable: artifact.classification === "permitted",
      },
    };
  });
  for (const required of Object.keys(FIXED_ARTIFACT_KINDS)) {
    if (!seen.has(required)) throw invalid(`Manifest is missing required export ${required}.`);
  }

  if (!isRecord(input.provenance)) throw invalid("Provenance must be an object.");
  const observed = stringList(input.provenance.observed, "Provenance observed", 80);
  const deterministic = stringList(input.provenance.deterministic, "Provenance deterministic", 80);
  const coverageGaps = stringList(input.provenance.coverageGaps, "Provenance coverage gaps", 80);

  return {
    schema_version: KIT_MANIFEST_VERSION,
    kit_id: kitId,
    analysis_id: analysisId,
    status,
    lens_report: { schema: LENS_REPORT_SCHEMA, analysis_id: analysisId, sha256: reportSha },
    capture_scope: {
      mode: mode as KitScopeMode,
      max_pages: maxPages as number,
      max_depth: maxDepth as number,
      max_bytes: maxBytes as number,
      time_budget_ms: timeBudgetMs as number,
    },
    pages,
    artifacts,
    rights_policy: { default_classification: "unknown", redistributable_note: REDISTRIBUTABLE_NOTE },
    provenance: {
      observed,
      deterministic,
      heuristic: [],
      model_generated: [],
      coverage_gaps: coverageGaps,
      generated_label: GENERATED_LABEL,
    },
  };
}

/**
 * Split a manifest into downloadable versus withheld artifact paths.
 * Only `redistributable` entries ship; everything else is withheld by
 * path so restricted bytes never enter a download set. Deterministic:
 * both lists follow manifest order.
 */
export function partitionKitArtifacts(manifest: KitManifest): { shippable: string[]; withheld: string[] } {
  if (!isRecord(manifest) || !Array.isArray(manifest.artifacts)) {
    throw invalid("Kit manifest must be an object with an artifact list.");
  }
  const shippable: string[] = [];
  const withheld: string[] = [];
  for (const artifact of manifest.artifacts) {
    if (!isRecord(artifact) || typeof artifact.path !== "string" || !isRecord(artifact.rights)) {
      throw invalid("Kit manifest artifacts are malformed.");
    }
    if (artifact.rights.redistributable === true) shippable.push(artifact.path);
    else withheld.push(artifact.path);
  }
  return { shippable, withheld };
}
