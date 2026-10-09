/** Clean-consumer install proof for the Skelet component registry (G07-02).
 *
 * Proves the P07 exit criterion without a deployed server: given a
 * registry item document (the exact JSON served at
 * /api/registry/[name]), a pristine consumer directory with only pinned
 * third-party dependencies can install the component files, resolve the
 * documented `@/lib/utils` helper from the item's own dependency set,
 * typecheck strictly, and server-render the component.
 *
 * Usage: `node scripts/prove_registry_install.mjs [item.json ...]`.
 * Defaults to the in-repo button + card documents. Exit non-zero with a
 * fail-closed message on the first violation. Network is required for
 * the one-time pinned dependency install.
 */
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ITEMS = [
  "apps/web/registry/skelet-button.json",
  "apps/web/registry/skelet-card.json",
];

const PINNED_DEPS = {
  clsx: "2.1.1",
  "tailwind-merge": "2.6.0",
  react: "19.3.0",
  "react-dom": "19.3.0",
};
const PINNED_DEVS = {
  "@types/node": "22.20.5",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  typescript: "5.9.3",
};

const CN_UTIL = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
`;

function fail(message) {
  console.error(`REGISTRY_INSTALL_FAIL ${message}`);
  process.exit(1);
}

async function run(cwd, command, args, useShell = false) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd,
      timeout: 180_000,
      shell: useShell,
    });
    if (stdout) process.stdout.write(String(stdout).slice(-2000));
    if (stderr) process.stderr.write(String(stderr).slice(-2000));
  } catch (error) {
    const detail = [error.stdout, error.stderr]
      .filter((part) => typeof part === "string" && part.length > 0)
      .join("\n")
      .slice(-3000);
    fail(`${command} ${args.join(" ")} failed: ${error.message.split("\n")[0]}${detail ? `\n${detail}` : ""}`);
  }
}

async function main() {
  const itemPaths = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_ITEMS;
  const sandbox = await mkdtemp(join(tmpdir(), "skelet-registry-proof-"));
  try {
    const packageJson = {
      name: "skelet-registry-proof",
      version: "0.0.0",
      private: true,
      type: "module",
      dependencies: PINNED_DEPS,
      devDependencies: PINNED_DEVS,
    };
    await writeFile(join(sandbox, "package.json"), JSON.stringify(packageJson, null, 2));
    await writeFile(
      join(sandbox, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "esnext"],
            strict: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            jsx: "react-jsx",
            baseUrl: ".",
            paths: { "@/*": ["./*"] },
            types: ["node", "react", "react-dom"],
            skipLibCheck: true,
          },
          include: ["components/**/*.tsx", "lib/**/*.ts"],
        },
        null,
        2,
      ),
    );
    await mkdir(join(sandbox, "lib"), { recursive: true });
    await writeFile(join(sandbox, "lib", "utils.ts"), CN_UTIL);

    const installed = [];
    const declaredDeps = new Set();
    for (const itemPath of itemPaths) {
      const resolvedPath = resolve(ROOT, itemPath);
      if (!resolvedPath.startsWith(ROOT + sep)) fail(`item path escapes repository: ${itemPath}`);
      let item;
      try {
        item = JSON.parse(await readFile(resolvedPath, "utf-8"));
      } catch (error) {
        fail(`unreadable item document ${itemPath}: ${error.message}`);
      }
      if (typeof item?.name !== "string" || !Array.isArray(item?.files) || item.files.length === 0) {
        fail(`invalid item document ${itemPath}`);
      }
      for (const list of ["dependencies", "devDependencies", "registryDependencies"]) {
        for (const dep of item[list] ?? []) {
          if (typeof dep === "string" && dep.length > 0) declaredDeps.add(dep.split("@")[0]);
        }
      }
      for (const file of item.files) {
        if (typeof file?.path !== "string" || typeof file?.content !== "string") {
          fail(`invalid file entry in ${itemPath}`);
        }
        if (
          isAbsolute(file.path) ||
          file.path.includes("..") ||
          file.path.includes("\\") ||
          /^[a-zA-Z]:/.test(file.path) ||
          !file.path.endsWith(".tsx")
        ) {
          fail(`unsafe file path in ${itemPath}: ${file.path}`);
        }
        const target = resolve(sandbox, file.path);
        if (target !== sandbox && !target.startsWith(sandbox + sep)) {
          fail(`escaping file path in ${itemPath}`);
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
      }
      installed.push(item.name);
    }
    for (const dep of declaredDeps) {
      if (!(dep in PINNED_DEPS) && !(dep in PINNED_DEVS)) {
        fail(`item declares dependency outside proof pins: ${dep}`);
      }
    }
    console.log("CN_FALLBACK_USED lib/utils.ts is proof scaffolding, not item content");

    await run(
      sandbox,
      NPM,
      ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"],
      process.platform === "win32",
    );
    await run(sandbox, process.execPath, [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "-p",
      "tsconfig.json",
    ]);
    await run(sandbox, process.execPath, [
      "node_modules/typescript/bin/tsc",
      "-p",
      "tsconfig.json",
      "--outDir",
      "dist",
      "--declaration",
      "false",
      "--sourceMap",
      "false",
    ]);

    // Consumer bundlers resolve the documented @/* alias (shadcn
    // convention); the proof rewrites it to relative paths explicitly.
    const emittedFiles = await readdir(join(sandbox, "dist", "components")).catch(() => {
      fail("missing emitted components");
    });
    for (const emittedName of emittedFiles.filter((name) => name.endsWith(".js"))) {
      const emitted = join(sandbox, "dist", "components", emittedName);
      let code;
      try {
        code = await readFile(emitted, "utf-8");
      } catch {
        fail(`missing emitted component: ${emittedName}`);
      }
      await writeFile(emitted, code.replaceAll("@/lib/utils", "../lib/utils.js"));
    }
    const remaining = [];
    for (const emittedName of emittedFiles.filter((name) => name.endsWith(".js"))) {
      const code = await readFile(join(sandbox, "dist", "components", emittedName), "utf-8");
      if (code.includes("@/")) remaining.push(emittedName);
    }
    if (remaining.length > 0) fail(`unresolved aliases in: ${remaining.join(",")}`);

    const renderImports = [];
    const renderAsserts = [];
    if (installed.includes("skelet-button")) {
      renderImports.push('import { SkeletButton } from "./components/skelet-button.js";');
      renderAsserts.push(
        'const button = renderToStaticMarkup(SkeletButton({ children: "Ship it", evidenceUri: "skelet://artifact/demo" }));',
        'if (!button.includes("Ship it") || !button.includes("data-evidence-uri")) throw new Error("button render mismatch");',
      );
    }
    if (installed.includes("skelet-card")) {
      renderImports.push('import { SkeletCard } from "./components/skelet-card.js";');
      renderAsserts.push(
        'const card = renderToStaticMarkup(SkeletCard({ title: "Demo", summary: "Summary", rightsNote: "MIT", evidenceUri: "skelet://artifact/demo" }));',
        'if (!card.includes("Demo") || !card.includes("MIT") || !card.includes("data-evidence-uri")) throw new Error("card render mismatch");',
      );
    }
    if (renderImports.length === 0) {
      console.log("RENDER_SKIPPED no known render targets; install and typecheck proven");
      console.log(`REGISTRY_INSTALL_PROOF_OK items=${installed.join(",")}`);
      return;
    }
    const render = `import { renderToStaticMarkup } from "react-dom/server";
${renderImports.join("\n")}
${renderAsserts.join("\n")}
console.log("RENDER_OK");
`;
    await writeFile(join(sandbox, "dist", "render.mjs"), render);
    await run(join(sandbox, "dist"), process.execPath, ["render.mjs"]);
    console.log(`REGISTRY_INSTALL_PROOF_OK items=${installed.join(",")}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

await main();
