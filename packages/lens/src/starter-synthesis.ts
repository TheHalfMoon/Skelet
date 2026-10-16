/**
 * G09b-07 deterministic starter synthesis.
 *
 * Pure and dependency-free: given a kit analysis identity plus an
 * observed section inventory, produce the fixed `starter/` file set
 * (package.json, app/layout.tsx, app/page.tsx, README.md). The starter
 * is Skilit synthesis, never original website source:
 *
 * - structural placeholders only; observed site text is NEVER copied
 *   into starter files (a dedicated test feeds distinctive text and
 *   asserts its absence);
 * - every file carries a synthesis header;
 * - unknown server behavior and unobserved sections become explicit
 *   stubs and truncation notes, never fabricated content;
 * - section tags pass through HTML escaping (tag injection is tested).
 *
 * Deterministic: fixed templates, sorted inputs, capped section list.
 * Unknown request fields fail closed.
 */

export const STARTER_FILES = [
  "starter/package.json",
  "starter/tsconfig.json",
  "starter/next.config.mjs",
  "starter/tailwind.config.js",
  "starter/postcss.config.js",
  "starter/app/globals.css",
  "starter/app/layout.tsx",
  "starter/app/page.tsx",
  "starter/README.md",
] as const;

export const SYNTHESIS_HEADER = "Skilit synthesis — not original website source." as const;

const MAX_SECTIONS = 12;
const MAX_TAG_CHARS = 64;
const HEX64 = /^[0-9a-f]{64}$/;

/** Pinned Skilit synthesis defaults (not claims about the analyzed site). */
const PINNED_DEPS = {
  next: "14.2.5",
  react: "18.3.1",
  "react-dom": "18.3.1",
  tailwindcss: "3.4.10",
  typescript: "5.5.4",
  "@types/node": "20.14.12",
  "@types/react": "18.3.3",
  "@types/react-dom": "18.3.0",
  autoprefixer: "10.4.20",
  postcss: "8.4.40",
} as const;

export interface StarterSection {
  tag: string;
  /**
   * Observed copy, accepted so callers can pass report sections
   * through untouched. NEVER emitted into starter files; present
   * only so tests can prove its absence.
   */
  text?: string;
}

export interface StarterRequest {
  analysisId: string;
  sections: StarterSection[];
  colorCount: number;
  spacingCount: number;
  hasTypography: boolean;
  truncated: boolean;
}

export interface StarterFile {
  path: string;
  content: string;
  bytes: number;
}

export class StarterError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StarterError";
    this.code = code;
  }
}

function invalid(message: string): StarterError {
  return new StarterError("starter/invalid-request", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const KNOWN_FIELDS = new Set([
  "analysisId", "sections", "colorCount", "spacingCount", "hasTypography", "truncated",
]);

function nonNegativeInt(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100000) {
    throw invalid(`${what} must be an integer from 0 to 100000.`);
  }
  return value;
}

/**
 * Synthesize the fixed starter file set. Sections beyond the cap are
 * omitted with an explicit truncation note in the README; when the
 * caller already truncated upstream (`truncated: true`), the note says
 * so instead of claiming full coverage.
 */
export function synthesizeStarterArtifacts(input: StarterRequest): StarterFile[] {
  if (!isRecord(input)) throw invalid("Starter request must be an object.");
  for (const key of Object.keys(input)) {
    if (!KNOWN_FIELDS.has(key)) throw invalid(`Unknown starter field: ${key}.`);
  }
  if (typeof input.analysisId !== "string" || !HEX64.test(input.analysisId)) {
    throw invalid("Analysis ID must be 64 lowercase hex characters.");
  }
  if (!Array.isArray(input.sections) || input.sections.length > 500) {
    throw invalid("Starter sections must be a list of at most 500 entries.");
  }
  const tags: string[] = input.sections.map((section, index) => {
    if (!isRecord(section) || typeof section.tag !== "string" || section.tag.length === 0 || section.tag.length > MAX_TAG_CHARS) {
      throw invalid(`Starter section ${index} has an invalid tag.`);
    }
    if (section.text !== undefined && (typeof section.text !== "string" || section.text.length > 100000)) {
      throw invalid(`Starter section ${index} has invalid text.`);
    }
    return section.tag;
  });
  const colorCount = nonNegativeInt(input.colorCount, "Color count");
  const spacingCount = nonNegativeInt(input.spacingCount, "Spacing count");
  if (typeof input.hasTypography !== "boolean") throw invalid("Typography flag must be a boolean.");
  if (typeof input.truncated !== "boolean") throw invalid("Truncated flag must be a boolean.");

  const kept = tags.slice(0, MAX_SECTIONS);
  const omitted = tags.length - kept.length;
  let coverageNote: string;
  if (omitted > 0) {
    coverageNote = `${omitted} observed section(s) omitted beyond the ${MAX_SECTIONS}-section starter cap; add them by hand.`;
  } else if (input.truncated) {
    coverageNote = "Upstream inventory was truncated; this starter may omit observed sections.";
  } else {
    coverageNote = "All observed sections are represented as placeholders.";
  }

  const sectionBlocks = kept.map((tag) => {
    const safe = escapeHtml(tag);
    return [
      `      <section data-skilit-section="${safe}" className="mx-auto w-full max-w-3xl px-4 py-8">`,
      `        <h2 className="text-xl font-semibold">Section: ${safe}</h2>`,
      `        <p className="mt-2 text-sm opacity-70">Replace with your own copy. Observed tag: ${safe}.</p>`,
      `      </section>`,
    ].join("\n");
  }).join("\n");
  const pageBody = kept.length > 0 ? sectionBlocks : [
    `      <section className="mx-auto w-full max-w-3xl px-4 py-8">`,
    `        <h2 className="text-xl font-semibold">Empty starter</h2>`,
    `        <p className="mt-2 text-sm opacity-70">No sections were observed; add your own.</p>`,
    `      </section>`,
  ].join("\n");

  const files: Array<{ path: string; content: string }> = [
    {
      path: "starter/package.json",
      content: [
        `{`,
        `  "name": "skilit-starter",`,
        `  "private": true,`,
        `  "version": "0.1.0",`,
        `  "scripts": { "dev": "next dev", "build": "next build", "start": "next start", "typecheck": "tsc --noEmit" },`,
        `  "dependencies": {`,
        `    "next": "${PINNED_DEPS.next}",`,
        `    "react": "${PINNED_DEPS.react}",`,
        `    "react-dom": "${PINNED_DEPS["react-dom"]}"`,
        `  },`,
        `  "devDependencies": {`,
        `    "@types/node": "${PINNED_DEPS["@types/node"]}",`,
        `    "@types/react": "${PINNED_DEPS["@types/react"]}",`,
        `    "@types/react-dom": "${PINNED_DEPS["@types/react-dom"]}",`,
        `    "autoprefixer": "${PINNED_DEPS.autoprefixer}",`,
        `    "postcss": "${PINNED_DEPS.postcss}",`,
        `    "tailwindcss": "${PINNED_DEPS.tailwindcss}",`,
        `    "typescript": "${PINNED_DEPS.typescript}"`,
        `  }`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/tsconfig.json",
      content: [
        `{`,
        `  "compilerOptions": {`,
        `    "target": "ES2017",`,
        `    "lib": ["dom", "dom.iterable", "esnext"],`,
        `    "allowJs": true,`,
        `    "skipLibCheck": true,`,
        `    "strict": true,`,
        `    "noEmit": true,`,
        `    "esModuleInterop": true,`,
        `    "module": "esnext",`,
        `    "moduleResolution": "bundler",`,
        `    "resolveJsonModule": true,`,
        `    "isolatedModules": true,`,
        `    "jsx": "preserve",`,
        `    "incremental": true,`,
        `    "plugins": [{ "name": "next" }],`,
        `    "paths": { "@/*": ["./*"] }`,
        `  },`,
        `  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],`,
        `  "exclude": ["node_modules"]`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/next.config.mjs",
      content: [
        `// ${SYNTHESIS_HEADER}`,
        `/** @type {import('next').NextConfig} */`,
        `const nextConfig = { reactStrictMode: true };`,
        `export default nextConfig;`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/tailwind.config.js",
      content: [
        `// ${SYNTHESIS_HEADER}`,
        `/** @type {import('tailwindcss').Config} */`,
        `module.exports = {`,
        `  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],`,
        `  theme: { extend: {} },`,
        `  plugins: [],`,
        `};`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/postcss.config.js",
      content: [
        `// ${SYNTHESIS_HEADER}`,
        `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/app/globals.css",
      content: [
        `/* ${SYNTHESIS_HEADER} */`,
        `@tailwind base;`,
        `@tailwind components;`,
        `@tailwind utilities;`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/app/layout.tsx",
      content: [
        `// ${SYNTHESIS_HEADER}`,
        `// Analysis ${input.analysisId}. Theme comes from the kit siblings:`,
        `// ../../shadcn-theme.css and ../../tailwind.theme.js.`,
        `import "./globals.css";`,
        `import "../../shadcn-theme.css";`,
        ``,
        `export default function RootLayout({ children }: { children: React.ReactNode }) {`,
        `  return (`,
        `    <html lang="en">`,
        `      <body>{children}</body>`,
        `    </html>`,
        `  );`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/app/page.tsx",
      content: [
        `// ${SYNTHESIS_HEADER}`,
        `// Analysis ${input.analysisId}. Placeholders only; no observed site text is reproduced.`,
        `export default function Page() {`,
        `  return (`,
        `    <main>`,
        pageBody,
        `    </main>`,
        `  );`,
        `}`,
        ``,
      ].join("\n"),
    },
    {
      path: "starter/README.md",
      content: [
        `# Skilit starter`,
        ``,
        `> ${SYNTHESIS_HEADER}`,
        `> Analysis \`${input.analysisId}\`.`,
        ``,
        `## Token basis`,
        ``,
        `- Observed colors: ${colorCount}. Observed spacing entries: ${spacingCount}.`,
        `- Typography observed: ${input.hasTypography ? "yes" : "no"}.`,
        `- Theme values live in \`../shadcn-theme.css\`, \`../tailwind.theme.js\`, and \`../tokens.dtcg.json\`; this starter references them and defines nothing of its own.`,
        ``,
        `## Coverage`,
        ``,
        `- ${coverageNote}`,
        ``,
        `## Run it`,
        ``,
        "1. `npm install`",
        "2. `npm run dev` - stubs only; wire your own data and server behavior.",
        ``,
      ].join("\n"),
    },
  ];
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    bytes: new TextEncoder().encode(file.content).byteLength,
  }));
}
