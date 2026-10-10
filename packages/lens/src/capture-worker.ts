/**
 * Lens capture entrypoint. One disposable, deadline-bound child per capture,
 * with an explicit environment allowlist and no inherited secret variables.
 * This is process/environment isolation, NOT an OS network/filesystem sandbox.
 */
import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPTURE_BUDGET, CaptureError } from "./capture-network.ts";
import { validateCaptureUrl } from "./url-guard.ts";

export interface CaptureResult {
  kind: "result";
  status: "partial";
  sourceUrl: string;
  sourceSha256: string;
  htmlBytes: number;
  redirects: number;
  title: string;
  sections: { tag: string; text: string }[];
  assets: { tag: string; href: string }[];
  screenshotBase64: string;
  screenshotMime: "image/jpeg";
  coverageGaps: string[];
}

/** No AWS/GCP/GH/DB/Stripe keys, no NODE_OPTIONS, no HOME/SSH/SSL credentials. */
export function isolatedWorkerEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    TMPDIR: home,
    TMP: home,
    TEMP: home,
    PATH: "/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
  };
}

export async function capturePublicPage(input: string): Promise<CaptureResult> {
  const validated = validateCaptureUrl(input);
  const home = mkdtempSync(join(tmpdir(), "skelet-lens-"));
  const script = fileURLToPath(new URL("./capture-child.ts", import.meta.url));

  try {
    return await new Promise<CaptureResult>((resolve, reject) => {
      const child = fork(script, [], {
        env: isolatedWorkerEnv(home),
        execArgv: ["--experimental-strip-types"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      let finished = false;
      const settle = (err?: Error, result?: CaptureResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (err) reject(err);
        else if (result) resolve(result);
        // Give Playwright's signal handlers a chance to close Chromium first.
        child.kill("SIGTERM");
        const reaper = setTimeout(() => child.kill("SIGKILL"), 1_500);
        reaper.unref();
      };
      const deadline = setTimeout(() => {
        settle(new CaptureError("capture/timeout", "Capture worker deadline exceeded."));
      }, CAPTURE_BUDGET.workerMs);
      child.on("error", () => settle(new CaptureError("capture/browser", "Capture worker failed.")));
      child.on("exit", () => settle(new CaptureError("capture/browser", "Capture worker exited without a result.")));
      child.on("message", (value: unknown) => {
        if (typeof value !== "object" || value === null || !("kind" in value)) {
          settle(new CaptureError("capture/browser", "Invalid worker response."));
          return;
        }
        if (value.kind === "error") {
          const code = "code" in value && typeof value.code === "string"
            ? value.code : "capture/browser";
          const allowed = [
            "capture/blocked", "capture/timeout", "capture/too-large",
            "capture/unsupported", "capture/network", "capture/browser",
          ];
          settle(new CaptureError(
            allowed.includes(code) ? code as CaptureError["code"] : "capture/browser",
            "Capture worker could not produce an offline snapshot.",
          ));
        } else if (value.kind === "result") {
          const result = value as CaptureResult;
          if (result.status !== "partial" || result.screenshotMime !== "image/jpeg" ||
              typeof result.screenshotBase64 !== "string" ||
              result.screenshotBase64.length > Math.ceil(CAPTURE_BUDGET.maxScreenshotBytes * 4 / 3) + 4) {
            settle(new CaptureError("capture/browser", "Invalid capture output."));
            return;
          }
          settle(undefined, result);
        } else {
          settle(new CaptureError("capture/browser", "Unknown worker response."));
        }
      });
      child.send({ kind: "capture", url: validated.href }, (error) => {
        if (error) settle(new CaptureError("capture/browser", "Worker IPC failed."));
      });
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
