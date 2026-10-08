import { createRequire } from "node:module";

import { loadEnv } from "./env.ts";

const require = createRequire(import.meta.url);

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function version(): string {
  const packageJson = require("../package.json") as { version?: unknown };
  if (
    typeof packageJson.version !== "string" ||
    packageJson.version === ""
  ) {
    throw new Error("skelet-worker package.json must define a version");
  }
  return packageJson.version;
}

const USAGE = `usage: skelet-worker <health|start>
  health   print the worker health contract as JSON
  start    validate env and report readiness (no jobs registered yet)`;

/** Run one worker command. Pure in stdout/stderr/exitCode; never exits. */
export function run(argv: string[], env: NodeJS.ProcessEnv): CliResult {
  const [command] = argv;
  if (command === "health" || command === "start") {
    let loaded;
    try {
      loaded = loadEnv(env);
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `invalid environment: ${(error as Error).message}\n`,
      };
    }
    if (command === "health") {
      return {
        exitCode: 0,
        stdout:
          JSON.stringify({
            status: "ok",
            service: "skelet-worker",
            version: version(),
            env: loaded.SKELET_ENV,
          }) + "\n",
        stderr: "",
      };
    }
    return {
      exitCode: 0,
      stdout:
        `skelet-worker ready (env=${loaded.SKELET_ENV}, ` +
        `concurrency=${loaded.SKELET_WORKER_CONCURRENCY}): ` +
        `no jobs registered\n`,
      stderr: "",
    };
  }
  return { exitCode: 2, stdout: USAGE + "\n", stderr: "" };
}
