import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface WebPackageJson {
  version?: unknown;
}

function readVersion(): string {
  const packageJson = require("../../../package.json") as WebPackageJson;
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    throw new Error("skilit-web package.json must define a version");
  }
  return packageJson.version;
}

export interface HealthPayload {
  status: "ok";
  service: "skilit-web";
  version: string;
}

export function buildHealthPayload(): HealthPayload {
  return {
    status: "ok",
    service: "skilit-web",
    version: readVersion(),
  };
}
