/** Private, single-use IPC child. Do not run with production credentials. */
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_BUDGET, CaptureError, fetchGuardedHtml, type GuardedHtml } from "./capture-network.ts";
import {
  STYLE_EVIDENCE_BUDGET,
  STYLE_EVIDENCE_PROPERTIES,
  collectStyleEvidence,
  projectPathSnapshots,
} from "./style-evidence.ts";
import {
  TECH_SIGNAL_BUDGET,
  TECH_SIGNAL_HINT_RELS,
  collectTechSignals,
  projectTechPathSignals,
} from "./tech-signal-evidence.ts";

interface CaptureRequest {
  kind: "capture";
  url: string;
}

async function capture(request: CaptureRequest) {
  const sourcePage = await fetchGuardedHtml(request.url);
  return renderOfflineSource(sourcePage);
}

export async function renderOfflineSource(sourcePage: GuardedHtml) {
  const browser = await chromium.launch({
    headless: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      javaScriptEnabled: false,
      serviceWorkers: "block",
      acceptDownloads: false,
      reducedMotion: "reduce",
    });
    try {
      // Browser never gets network access, including iframe/css/img/favicons.
      // Ingress was DNS-pinned and byte-limited in the Node HTTP client.
      await context.route("**/*", (route) => route.abort("blockedbyclient"));
      await context.setOffline(true);
      const page = await context.newPage();
      page.setDefaultTimeout(CAPTURE_BUDGET.pageMs);
      await page.setContent(sourcePage.html, {
        waitUntil: "domcontentloaded",
        timeout: CAPTURE_BUDGET.pageMs,
      });
      const extracted = await page.evaluate(
        ({ source, sectionLimit, assetLimit, styleProps, styleElementLimit, styleValueLimit, tech }) => {
          const clip = (v: string, max: number) => v.trim().replace(/\s+/g, " ").slice(0, max);
          const safeLink = (v: string) => {
            if (!v || v.length > 2_048) return null;
            try {
              const url = new URL(v, source);
              return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
            } catch { return null; }
          };
          // Deterministic closest-6 ancestor chain, root-down:
          // text/attribute-free, so refs identify position, not content.
          const pathSegments = (element: Element) => {
            const segments: Array<{ tag: string; index: number }> = [];
            let cursor: Element | null = element;
            while (cursor instanceof Element && segments.length < 6) {
              const tag = cursor.tagName.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16) || "el";
              const parent: Element | null = cursor.parentElement;
              const index = parent instanceof Element
                ? Array.from(parent.children).indexOf(cursor)
                : 0;
              segments.unshift({ tag, index: Math.max(0, index) });
              cursor = parent;
            }
            return segments;
          };
          const sections = Array.from(document.querySelectorAll(
            "header, nav, main, section, article, aside, footer",
          )).slice(0, sectionLimit).map((node) => ({
            tag: node.tagName.toLowerCase(),
            text: clip(node.textContent || "", 640),
          }));
          const assets = Array.from(document.querySelectorAll(
            "img[src], source[src], source[srcset], video[poster], link[rel~=icon][href]",
          )).slice(0, assetLimit).flatMap((element) => {
            const raw = element.getAttribute("src") || element.getAttribute("poster") ||
              element.getAttribute("href") || element.getAttribute("srcset")?.split(",")[0]?.trim().split(" ")[0] || "";
            const href = safeLink(raw);
            return href ? [{ tag: element.tagName.toLowerCase(), href }] : [];
          });
          // Source-linked computed-style evidence. Inline <style> applies in
          // this offline render; scripts never run and remote sheets never
          // load, so only author-inline and UA declarations are observed.
          // Values are page DATA, not instructions: clipped, never executed.
          const styleCandidates = [
            document.body,
            ...Array.from(document.querySelectorAll(
              "header, nav, main, section, article, aside, footer, h1, h2, h3, p, a, button, img",
            )),
          ].filter((node): node is Element => node instanceof Element).slice(0, styleElementLimit);
          let styleTruncated = false;
          const stylePaths = styleCandidates.map((element) => {
            const computed = window.getComputedStyle(element);
            const styles: Record<string, string> = {};
            for (const property of styleProps as string[]) {
              const value = computed.getPropertyValue(property);
              if (typeof value === "string" && value.trim().length > 0) {
                const collapsed = value.trim().replace(/\s+/g, " ");
                if (collapsed.length > (styleValueLimit as number)) styleTruncated = true;
                styles[property] = collapsed.slice(0, styleValueLimit as number);
              }
            }
            // Closest-6 ancestor chain, root-down: deterministic and
            // text/attribute-free, so refs identify position, not content.
            const segments: Array<{ tag: string; index: number }> = [];
            let cursor: Element | null = element;
            while (cursor instanceof Element && segments.length < 6) {
              const tag = cursor.tagName.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 16) || "el";
              const parent: Element | null = cursor.parentElement;
              const index = parent instanceof Element
                ? Array.from(parent.children).indexOf(cursor)
                : 0;
              segments.unshift({ tag, index: Math.max(0, index) });
              cursor = parent;
            }
            return { segments, styles };
          });
          // G09-11: observable technology signals, DOM only. No crawler,
          // no extra requests (the context is offline and route-blocked),
          // no script execution, no file bodies: attribute strings and
          // resolved http(s) URLs only. Filenames and metadata values are
          // observations, never verified technology identities.
          const techPaths: Array<{ kind: string; value: string; detail: string; segments: Array<{ tag: string; index: number }> }> = [];
          let techTruncated = false;
          const techLimits = tech as {
            metaLimit: number; scriptLimit: number; sheetLimit: number;
            hintLimit: number; markerLimit: number; metaChars: number;
            markerChars: number; hintRels: string[];
          };
          // Slice drops without a flag would silently lose observations:
          // every cap overflow below records techTruncated honestly.
          const metaNodes = Array.from(document.querySelectorAll("meta[name]"))
            .filter((node) => (node.getAttribute("name") || "").toLowerCase() === "generator");
          if (metaNodes.length > (techLimits.metaLimit as number)) techTruncated = true;
          for (const node of metaNodes.slice(0, techLimits.metaLimit)) {
            const collapsed = (node.getAttribute("content") || "").trim().replace(/\s+/g, " ");
            if (collapsed.length === 0) continue;
            if (collapsed.length > (techLimits.metaChars as number)) techTruncated = true;
            techPaths.push({
              kind: "meta-generator",
              value: collapsed.slice(0, techLimits.metaChars as number),
              detail: "content",
              segments: pathSegments(node),
            });
          }
          const scriptNodes = Array.from(document.querySelectorAll("script[src]"));
          if (scriptNodes.length > (techLimits.scriptLimit as number)) techTruncated = true;
          for (const node of scriptNodes.slice(0, techLimits.scriptLimit)) {
            const raw = node.getAttribute("src") || "";
            if (raw.length === 0) continue;
            const href = safeLink(raw);
            if (!href) { techTruncated = true; continue; }
            techPaths.push({ kind: "script-src", value: href, detail: "src", segments: pathSegments(node) });
          }
          for (const node of Array.from(document.querySelectorAll("link[rel][href]"))) {
            const raw = node.getAttribute("href") || "";
            if (raw.length === 0) continue;
            const rels = (node.getAttribute("rel") || "").toLowerCase().split(/\s+/).filter((t) => t.length > 0);
            if (rels.includes("stylesheet")) {
              if (techPaths.filter((s) => s.kind === "stylesheet-href").length >= (techLimits.sheetLimit as number)) {
                techTruncated = true;
                continue;
              }
              const href = safeLink(raw);
              if (!href) { techTruncated = true; continue; }
              techPaths.push({ kind: "stylesheet-href", value: href, detail: "href", segments: pathSegments(node) });
              continue;
            }
            const hint = rels.find((t) => (techLimits.hintRels as string[]).includes(t));
            if (hint === undefined) continue;
            if (techPaths.filter((s) => s.kind === "resource-hint").length >= (techLimits.hintLimit as number)) {
              techTruncated = true;
              continue;
            }
            const href = safeLink(raw);
            if (!href) { techTruncated = true; continue; }
            techPaths.push({ kind: "resource-hint", value: href, detail: `href:${hint}`, segments: pathSegments(node) });
          }
          // Approved non-executable DOM markers: body class strings and
          // data-* attribute NAMES (never values) on html/body.
          const markerNodes = [document.documentElement, document.body].filter(
            (node): node is HTMLElement => node instanceof HTMLElement,
          );
          let markers = 0;
          const takeMarker = (entry: { kind: string; value: string; detail: string; segments: Array<{ tag: string; index: number }> }) => {
            if (markers >= (techLimits.markerLimit as number)) { techTruncated = true; return; }
            markers += 1;
            techPaths.push(entry);
          };
          for (const node of markerNodes) {
            if (node.tagName.toLowerCase() === "body") {
              const collapsed = (node.getAttribute("class") || "").trim().replace(/\s+/g, " ");
              if (collapsed.length > 0) {
                if (collapsed.length > (techLimits.markerChars as number)) techTruncated = true;
                takeMarker({
                  kind: "dom-marker",
                  value: collapsed.slice(0, techLimits.markerChars as number),
                  detail: "class",
                  segments: pathSegments(node),
                });
              }
            }
            for (const attr of Array.from(node.attributes)) {
              const name = attr.name.toLowerCase();
              if (!name.startsWith("data-")) continue;
              // Detail budget: `attr:` (5) + name must fit maxDetailChars
              // (64). Length-excluded names flag truncation honestly;
              // other out-of-contract names are skipped as non-evidence.
              if (name.length > 59) { techTruncated = true; continue; }
              if (!/^data-[a-z0-9-]{1,54}$/.test(name)) continue;
              takeMarker({
                kind: "dom-marker",
                value: node.tagName.toLowerCase(),
                detail: `attr:${name}`,
                segments: pathSegments(node),
              });
            }
          }
          return {
            title: clip(document.title || "", 240),
            sections,
            assets,
            stylePaths,
            styleTruncated,
            techPaths,
            techTruncated,
          };
        },
        {
          source: sourcePage.href,
          sectionLimit: CAPTURE_BUDGET.maxSections,
          assetLimit: CAPTURE_BUDGET.maxAssets,
          styleProps: [...STYLE_EVIDENCE_PROPERTIES],
          styleElementLimit: STYLE_EVIDENCE_BUDGET.maxElements,
          styleValueLimit: STYLE_EVIDENCE_BUDGET.maxValueChars,
          tech: {
            metaLimit: TECH_SIGNAL_BUDGET.maxMetaCandidates,
            scriptLimit: TECH_SIGNAL_BUDGET.maxScriptCandidates,
            sheetLimit: TECH_SIGNAL_BUDGET.maxStylesheetCandidates,
            hintLimit: TECH_SIGNAL_BUDGET.maxHintCandidates,
            markerLimit: TECH_SIGNAL_BUDGET.maxMarkerCandidates,
            metaChars: TECH_SIGNAL_BUDGET.maxMetaChars,
            markerChars: TECH_SIGNAL_BUDGET.maxMarkerChars,
            hintRels: [...TECH_SIGNAL_HINT_RELS],
          },
        },
      );
      let declarations;
      try {
        if (!extracted || !Array.isArray(extracted.stylePaths) ||
            typeof extracted.styleTruncated !== "boolean") {
          throw new CaptureError("capture/browser", "Style evidence exceeds its budget.");
        }
        declarations = collectStyleEvidence(projectPathSnapshots(extracted.stylePaths));
      } catch {
        throw new CaptureError("capture/browser", "Style evidence exceeds its budget.");
      }
      // G09-11: observations only. Values are page DATA, never technology
      // identities; matching and confidence belong to G09-12.
      let techSignals;
      let techTruncated = false;
      try {
        if (!extracted || !Array.isArray((extracted as { techPaths?: unknown }).techPaths) ||
            typeof (extracted as { techTruncated?: unknown }).techTruncated !== "boolean") {
          throw new CaptureError("capture/browser", "Technology-signal evidence exceeds its budget.");
        }
        techSignals = collectTechSignals(projectTechPathSignals(
          (extracted as { techPaths: Parameters<typeof projectTechPathSignals>[0] }).techPaths,
        ));
        techTruncated = (extracted as { techTruncated: boolean }).techTruncated;
      } catch {
        throw new CaptureError("capture/browser", "Technology-signal evidence exceeds its budget.");
      }
      const screenshot = await page.screenshot({
        type: "jpeg", quality: 65, fullPage: false,
        animations: "disabled", caret: "hide",
        timeout: CAPTURE_BUDGET.pageMs,
      });
      if (screenshot.length > CAPTURE_BUDGET.maxScreenshotBytes) {
        throw new CaptureError("capture/too-large", "Screenshot exceeds capture budget.");
      }
      return {
        kind: "result" as const,
        status: "partial" as const, // No JS/external CSS/assets were executed/downloaded.
        sourceUrl: sourcePage.href,
        sourceSha256: sourcePage.sha256,
        htmlBytes: sourcePage.byteCount,
        redirects: sourcePage.redirects,
        title: extracted.title,
        sections: extracted.sections,
        assets: extracted.assets,
        declarations,
        techSignals,
        techTruncated,
        screenshotBase64: screenshot.toString("base64"),
        screenshotMime: "image/jpeg" as const,
        coverageGaps: [
          "javascript-disabled",
          "external-resources-blocked",
          "viewport-only-screenshot",
          ...(extracted.styleTruncated ? ["style-values-truncated"] : []),
          ...(techTruncated ? ["tech-signals-truncated"] : []),
        ],
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

let received = false;
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
process.on("message", async (message: unknown) => {
  if (received) return;
  received = true;
  try {
    if (
      typeof message !== "object" || message === null ||
      !("kind" in message) || message.kind !== "capture" ||
      !("url" in message) || typeof message.url !== "string"
    ) {
      throw new CaptureError("capture/blocked", "Invalid worker request.");
    }
    const input = message as CaptureRequest;
    const result = await capture(input);
    process.send?.(result, () => process.exit(0));
  } catch (error) {
    const code = error instanceof CaptureError ? error.code : "capture/browser";
    // Never expose exception messages, paths, credentials or HTML in IPC errors.
    process.send?.({ kind: "error", code }, () => process.exit(1));
  }
});
}
