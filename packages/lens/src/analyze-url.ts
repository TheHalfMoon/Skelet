/**
 * G09-13: paste-URL-to-report journey service for Skilit Lens.
 *
 * Pure orchestration over already-qualified stages: SSRF-guarded URL
 * validation (G09-01) -> isolated offline capture (G09-03) -> deterministic
 * report assembly with style evidence (G09-08/G09-09), technology signals
 * (G09-11) and graded clues (G09-12) -> provenance-preserving export
 * bundle (G09-10). No new evidence is invented here; every stage keeps its
 * own fail-closed contract, and failures surface as typed AnalyzeUrlError
 * codes carrying only the closed upstream code allowlist (never page
 * bytes, paths, or credentials — capture errors are pre-sanitized).
 */

import { CaptureError } from "./capture-network.ts";
import { capturePublicPage, type CaptureResult } from "./capture-worker.ts";
import { ReportError, assembleLensReportFromCapture, type LensReport } from "./report-assembly.ts";
import { ExportError, exportLensArtifacts, type LensExportBundle } from "./export-surface.ts";
import { LensError, validateCaptureUrl } from "./url-guard.ts";

export type AnalyzeUrlErrorCode =
  | "lens/invalid-url"
  | "lens/capture-failed"
  | "lens/report-failed"
  | "lens/export-failed";

const CAUSE_CODES = [
  "lens/invalid-url",
  "lens/blocked-host",
  "lens/unsupported-scheme",
  "capture/blocked",
  "capture/timeout",
  "capture/too-large",
  "capture/unsupported",
  "capture/network",
  "capture/browser",
  "lens/invalid-report-evidence",
  "lens/invalid-style-evidence",
  "lens/invalid-tech-signal",
  "lens/invalid-tech-clue-input",
  "lens/invalid-export-input",
  "lens/unknown-failure",
] as const;

export type AnalyzeUrlCauseCode = (typeof CAUSE_CODES)[number];

export class AnalyzeUrlError extends Error {
  readonly code: AnalyzeUrlErrorCode;
  readonly causeCode: AnalyzeUrlCauseCode;
  constructor(code: AnalyzeUrlErrorCode, causeCode: AnalyzeUrlCauseCode) {
    super("Lens URL analysis could not complete.");
    this.name = "AnalyzeUrlError";
    this.code = code;
    this.causeCode = causeCode;
  }
}

export interface AnalyzeUrlResult {
  report: LensReport;
  bundle: LensExportBundle;
}

export interface AnalyzeUrlDeps {
  capture?: (url: string, viewport?: "desktop" | "mobile") => Promise<CaptureResult>;
  assemble?: (capture: CaptureResult) => LensReport;
  exportArtifacts?: (report: LensReport) => LensExportBundle;
}

export interface AnalyzeUrlOptions {
  viewport?: "desktop" | "mobile";
}

function causeOf(error: unknown): AnalyzeUrlCauseCode {
  const code =
    error instanceof CaptureError || error instanceof ReportError || error instanceof LensError
      ? (error as { code?: unknown }).code
      : (error instanceof ExportError ? error.code : undefined);
  return typeof code === "string" && (CAUSE_CODES as readonly string[]).includes(code)
    ? (code as AnalyzeUrlCauseCode)
    : "lens/unknown-failure";
}

/**
 * Analyze one public URL end to end: validate, capture offline, assemble
 * the deterministic report, project the export bundle. The injectable
 * stages default to the real qualified implementations; tests inject a
 * stubbed network edge while keeping real assembly and export.
 */
export async function analyzePublicUrl(
  input: string,
  deps: AnalyzeUrlDeps = {},
  options: AnalyzeUrlOptions = {},
): Promise<AnalyzeUrlResult> {
  const capture = deps.capture ?? ((url: string, vp?: "desktop" | "mobile") =>
    capturePublicPage(url, { viewport: vp ?? "desktop" }));
  const assemble = deps.assemble ?? assembleLensReportFromCapture;
  const exportArtifacts = deps.exportArtifacts ?? exportLensArtifacts;
  const viewport = options.viewport ?? "desktop";
  if (viewport !== "desktop" && viewport !== "mobile") {
    throw new AnalyzeUrlError("lens/invalid-url", "lens/invalid-url");
  }
  try {
    validateCaptureUrl(input);
  } catch (error) {
    throw new AnalyzeUrlError("lens/invalid-url", causeOf(error));
  }
  let captured: CaptureResult;
  try {
    captured = await capture(input, viewport);
  } catch (error) {
    throw new AnalyzeUrlError("lens/capture-failed", causeOf(error));
  }
  let report: LensReport;
  try {
    report = assemble(captured);
  } catch (error) {
    throw new AnalyzeUrlError("lens/report-failed", causeOf(error));
  }
  try {
    return { report, bundle: exportArtifacts(report) };
  } catch (error) {
    throw new AnalyzeUrlError("lens/export-failed", causeOf(error));
  }
}
