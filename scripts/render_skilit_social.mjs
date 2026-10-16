#!/usr/bin/env node
/**
 * Convert Skilit's deterministic social SVG compositions into standard PNGs.
 * Reuses the Chromium dependency already pinned by Skilit Lens; no paid
 * services, new third-party icon source, or external network requests.
 *
 * Prerequisites: pnpm install --frozen-lockfile
 *               pnpm --dir packages/lens exec playwright install chromium-headless-shell
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLens = createRequire(path.join(root, "packages/lens/package.json"));
const { chromium } = requireLens("playwright-core");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const variant of ["light", "orange"]) {
    const basename = `skilit-social-${variant}`;
    const svg = await readFile(path.join(root, "apps/web/public/brand", basename + ".svg"));
    const base64 = svg.toString("base64");
    await page.setContent(
      '<!doctype html><html><head><meta charset="utf-8"/></head>' +
      '<body style="padding:0;margin:0;overflow:hidden">' +
      '<img width="1200" height="630" alt="" src="data:image/svg+xml;base64,' +
      base64 + '"/></body></html>',
      { waitUntil: "load" },
    );
    const dimensions = await page.locator("img").evaluate((img) => {
      if (!(img instanceof HTMLImageElement)) throw new Error("Expected image");
      const rect = img.getBoundingClientRect();
      return { width: rect.width, height: rect.height, loaded: img.complete && img.naturalWidth > 0 };
    });
    if (dimensions.width !== 1200 || dimensions.height !== 630 || !dimensions.loaded) {
      throw new Error(`Incorrect ${basename} dimensions: ${JSON.stringify(dimensions)}`);
    }
    await page.screenshot({
      path: path.join(root, "apps/web/public/brand", basename + ".png"),
      animations: "disabled",
      timeout: 30000,
    });
    process.stdout.write(`Generated ${basename}.png (1200x630)\n`);
  }
  await page.close();
} finally {
  await browser.close();
}
