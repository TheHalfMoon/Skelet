import process from "node:process";

import { run } from "./cli.ts";

const result = run(process.argv.slice(2), process.env);
if (result.stdout !== "") {
  process.stdout.write(result.stdout);
}
if (result.stderr !== "") {
  process.stderr.write(result.stderr);
}
process.exitCode = result.exitCode;
