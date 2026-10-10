/** Private, single-use IPC child. Do not run with production credentials. */
import { chromium } from "playwright-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPTURE_BUDGET, CaptureError, fetchGuardedHtml, type GuardedHtml } from "./capture-network.ts";

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
        ({ source, sectionLimit, assetLimit }) => {
          const clip = (v: string, max: number) => v.trim().replace(/\s+/g, " ").slice(0, max);
          const safeLink = (v: string) => {
            if (!v || v.length > 2_048) return null;
            try {
              const url = new URL(v, source);
              return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
            } catch { return null; }
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
          return { title: clip(document.title || "", 240), sections, assets };
        },
        {
          source: sourcePage.href,
          sectionLimit: CAPTURE_BUDGET.maxSections,
          assetLimit: CAPTURE_BUDGET.maxAssets,
        },
      );
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
        screenshotBase64: screenshot.toString("base64"),
        screenshotMime: "image/jpeg" as const,
        coverageGaps: [
          "javascript-disabled",
          "external-resources-blocked",
          "viewport-only-screenshot",
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
