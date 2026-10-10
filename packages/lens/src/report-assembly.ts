/**
 * G09-08: deterministic, offline Lens report assembly from already captured
 * evidence and caller-supplied style declarations. It never visits a URL,
 * executes remote content, attributes unknown asset rights, or invents clues.
 *
 * IMPORTANT: raw observed text and unsafe typography/shadow token values are
 * DATA, not HTML/CSS/program instructions. Downstream renderers must escape
 * them. DTCG exports deliberately omit unsafe font-family/shadow strings.
 */
import { createHash } from "node:crypto";

import { CAPTURE_BUDGET } from "./capture-network.ts";
import { inspectJpeg } from "./jpeg-evidence.ts";
import type { CaptureResult } from "./capture-worker.ts";
import { validCaptureDeclarations } from "./capture-worker.ts";
import {
  extractDesignTokens,
  type DesignTokens,
  type StyleDeclaration,
  type TokenObservation,
} from "./design-tokens.ts";
import { validateCaptureUrl } from "./url-guard.ts";

export class ReportError extends Error {
  readonly code = "lens/invalid-report-evidence";
  constructor() {
    super("Lens report evidence is invalid or outside its budget.");
    this.name = "ReportError";
  }
}

interface DtcgColor {
  $type: "color";
  $value: {
    colorSpace: "srgb";
    components: [number, number, number];
    alpha: number;
    hex: string;
  };
}

interface DtcgDimension {
  $type: "dimension";
  $value: { value: number; unit: "px" };
}

interface DtcgExport {
  $schema: "https://www.designtokens.org/schemas/2025.10/format.json";
  colors: Record<string, DtcgColor>;
  fontSizes: Record<string, DtcgDimension>;
  spacing: Record<string, DtcgDimension>;
  radius: Record<string, DtcgDimension>;
}

export interface LensReport {
  schemaVersion: "skelet.lens.report.v1";
  status: "partial";
  analysisId: string;
  source: {
    url: string;
    sha256: string;
    htmlBytes: number;
    redirects: number;
  };
  observed: {
    title: string;
    sections: Array<{ tag: string; text: string }>;
    screenshot: { mime: "image/jpeg"; sha256: string; bytes: number; width: number; height: number; base64: string };
    assets: Array<{ tag: string; href: string; rights: "unknown"; downloadable: false }>;
  };
  designDna: {
    tokens: DesignTokens;
    inputBasis: "caller-supplied-declarations" | "capture-computed-styles";
    dtcg: DtcgExport;
    exclusions: string[];
  };
  unknown: {
    technologyClues: [];
    components: [];
    logos: [];
    qaFindings: [];
    similarReferences: [];
  };
  provenance: {
    observed: string[];
    deterministic: string[];
    heuristic: [];
    modelGenerated: [];
    coverageGaps: string[];
    disclaimers: string[];
  };
}

const HEX_COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const PX_DIMENSION = /^-?(?:0|[1-9]\d*)(?:\.\d+)?px$/;
const HASH = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function validHtmlSource(capture: CaptureResult): void {
  if (capture.status !== "partial" ||
      !validText(capture.sourceUrl, 2_048) ||
      !validText(capture.sourceSha256, 64) || !HASH.test(capture.sourceSha256) ||
      !Number.isSafeInteger(capture.htmlBytes) || capture.htmlBytes < 0 ||
      capture.htmlBytes > CAPTURE_BUDGET.maxHtmlBytes ||
      !Number.isSafeInteger(capture.redirects) || capture.redirects < 0 ||
      capture.redirects > CAPTURE_BUDGET.maxRedirects ||
      !validText(capture.title, 240) ||
      !Array.isArray(capture.sections) ||
      capture.sections.length > CAPTURE_BUDGET.maxSections ||
      Array.from(capture.sections).some((part) =>
        !part || !validText(part.tag, 16) || !validText(part.text, 640)) ||
      !Array.isArray(capture.assets) ||
      capture.assets.length > CAPTURE_BUDGET.maxAssets ||
      Array.from(capture.assets).some((asset) =>
        !asset || !validText(asset.tag, 16) || !validText(asset.href, 2_048)) ||
      !Array.isArray(capture.coverageGaps) ||
      capture.coverageGaps.length > 20 ||
      Array.from(capture.coverageGaps).some((gap) => !validText(gap, 80)) ||
      !validCaptureDeclarations(capture.declarations) ||
      !["javascript-disabled", "external-resources-blocked", "viewport-only-screenshot"]
        .every((required) => capture.coverageGaps.includes(required)) ||
      capture.screenshotMime !== "image/jpeg" ||
      !validText(capture.screenshotBase64, Math.ceil(CAPTURE_BUDGET.maxScreenshotBytes * 4 / 3) + 4) ||
      !BASE64.test(capture.screenshotBase64)) {
    throw new ReportError();
  }
  try {
    if (validateCaptureUrl(capture.sourceUrl).href !== capture.sourceUrl) {
      throw new ReportError();
    }
  } catch {
    throw new ReportError();
  }
}

function dtcgDimension(entries: TokenObservation[]): Record<string, DtcgDimension> {
  const result: Record<string, DtcgDimension> = {};
  entries.filter((entry) => PX_DIMENSION.test(entry.value)).forEach((entry, i) => {
    const numeric = Number(entry.value.slice(0, -2));
    if (Number.isFinite(numeric)) {
      result[`value_${String(i + 1).padStart(3, "0")}`] = {
        $type: "dimension",
        $value: { value: numeric, unit: "px" },
      };
    }
  });
  return result;
}

function exportDtcg(tokens: DesignTokens): DtcgExport {
  const colors: Record<string, DtcgColor> = {};
  tokens.colors.filter((entry) => HEX_COLOR.test(entry.value)).forEach((entry, i) => {
    const rgbHex = entry.value.slice(0, 7);
    const byte = (offset: number) => Number.parseInt(entry.value.slice(offset, offset + 2), 16);
    const alpha = entry.value.length === 9 ? byte(7) / 255 : 1;
    colors[`value_${String(i + 1).padStart(3, "0")}`] = {
      $type: "color",
      $value: {
        colorSpace: "srgb",
        components: [byte(1) / 255, byte(3) / 255, byte(5) / 255],
        alpha,
        hex: rgbHex,
      },
    };
  });
  return {
    $schema: "https://www.designtokens.org/schemas/2025.10/format.json",
    colors,
    fontSizes: dtcgDimension(tokens.typography.sizes),
    spacing: dtcgDimension(tokens.spacing),
    radius: dtcgDimension(tokens.radius),
  };
}

const MAX_TOTAL_STYLE_CHARS = 1_000_000;

/** Pure assembly. A caller must not label an empty-token result complete. */
export function assembleLensReport(capture: CaptureResult, declarations: StyleDeclaration[]): LensReport {
  return assemble(capture, declarations, {
    inputBasis: "caller-supplied-declarations",
    observed: ["source", "title", "sections", "screenshot", "asset-links"],
    deterministic: "design-tokens-from-supplied-declarations",
    styleDisclaimer: "Caller-supplied style declarations must be independently provenance-qualified",
  });
}

/**
 * G09-09: assemble directly from capture-attached computed-style evidence.
 * The declarations were observed by the offline capture worker
 * (JavaScript disabled, remote resources blocked); they remain untrusted
 * page data and must be escaped before re-emission.
 */
export function assembleLensReportFromCapture(capture: CaptureResult): LensReport {
  if (!validCaptureDeclarations(capture.declarations)) throw new ReportError();
  return assemble(capture, capture.declarations, {
    inputBasis: "capture-computed-styles",
    observed: ["source", "title", "sections", "screenshot", "asset-links", "computed-styles"],
    deterministic: "design-tokens-from-capture",
    styleDisclaimer: "Capture-attached style declarations are observed computed values from the offline worker, not author-attested facts",
  });
}

function assemble(
  capture: CaptureResult,
  declarations: StyleDeclaration[],
  basis: {
    inputBasis: LensReport["designDna"]["inputBasis"];
    observed: string[];
    deterministic: string;
    styleDisclaimer: string;
  },
): LensReport {
  validHtmlSource(capture);
  const bytes = Buffer.from(capture.screenshotBase64, "base64");
  const dimensions = inspectJpeg(bytes);
  if (bytes.length > CAPTURE_BUDGET.maxScreenshotBytes ||
      bytes.toString("base64") !== capture.screenshotBase64 ||
      dimensions === null) {
    throw new ReportError();
  }
  const assets = capture.assets.map(({ tag, href }) => {
    let validated;
    try {
      validated = validateCaptureUrl(href);
    } catch {
      throw new ReportError();
    }
    return { tag, href: validated.href, rights: "unknown" as const, downloadable: false as const };
  });
  const ordered = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
  assets.sort((a, b) => ordered(a.href, b.href) || ordered(a.tag, b.tag));
  const dedupedAssets = assets.filter((asset, i) =>
    i === 0 || asset.href !== assets[i - 1]?.href || asset.tag !== assets[i - 1]?.tag);
  const screenshotSha256 = createHash("sha256").update(bytes).digest("hex");
  if (!Array.isArray(declarations) || declarations.length > 20_000) {
    throw new ReportError();
  }
  let styleChars = 0;
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.ref !== "string" ||
        typeof declaration.property !== "string" ||
        typeof declaration.value !== "string") {
      throw new ReportError();
    }
    styleChars += declaration.ref.length + declaration.property.length + declaration.value.length;
    if (styleChars > MAX_TOTAL_STYLE_CHARS) throw new ReportError();
  }
  const tokens = extractDesignTokens(declarations);
  const coverageGaps = [...new Set([
    ...capture.coverageGaps,
    ...(tokens.isEmpty ? ["no-qualified-style-tokens"] : []),
    "no-runtime-technology-detector",
    "no-component-classifier",
    "no-provider-qa",
    "asset-rights-not-verified",
  ])].sort();
  const report: LensReport = {
    schemaVersion: "skelet.lens.report.v1",
    status: "partial",
    analysisId: "",
    source: {
      url: capture.sourceUrl,
      sha256: capture.sourceSha256,
      htmlBytes: capture.htmlBytes,
      redirects: capture.redirects,
    },
    observed: {
      title: capture.title,
      sections: capture.sections.map((item) => ({ tag: item.tag, text: item.text })),
      screenshot: {
        mime: "image/jpeg",
        sha256: screenshotSha256,
        bytes: bytes.length,
        width: dimensions.width,
        height: dimensions.height,
        base64: capture.screenshotBase64,
      },
      assets: dedupedAssets,
    },
    designDna: {
      tokens,
      inputBasis: basis.inputBasis,
      dtcg: exportDtcg(tokens),
      exclusions: [
        "font-family and shadow CSS strings require an escaping/sanitization layer before code export",
        "only absolute px dimensions and normalized hex colors are DTCG-exported",
      ],
    },
    unknown: {
      technologyClues: [],
      components: [],
      logos: [],
      qaFindings: [],
      similarReferences: [],
    },
    provenance: {
      observed: basis.observed,
      deterministic: [basis.deterministic],
      heuristic: [],
      modelGenerated: [],
      coverageGaps,
      disclaimers: [
        "Upstream capture worker reports offline JavaScript-disabled render and blocked remote resources",
        "Links identify resources only; no license or redistribution rights verified",
        basis.styleDisclaimer,
        "Untrusted observed text and shadow/font tokens must never be interpreted as code or instructions",
      ],
    },
  };
  // The report identity is a domain-separated digest of the COMPLETE
  // returned report (with the identity field blank), not a weaker token
  // fingerprint or a selected subset of metadata.
  report.analysisId = createHash("sha256")
    .update("skelet.lens.report.v1\0")
    .update(JSON.stringify(report))
    .digest("hex");
  return report;
}
