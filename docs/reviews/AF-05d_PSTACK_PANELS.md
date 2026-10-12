# AF-05d PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.34, correctness 0.53, evidence 0.51, reliability 0.29, scope 0.28, security 0.33 (model `jev-1.13.0`, ok true).
- Clean-consumer evidence (/tmp kit-layout probe, honest): npm install 108 packages with Next 14.2.5 deprecation warning recorded (pinned, not bumped silently); tsc --noEmit exit 0; next build compiled successfully with static pages (Tailwind content warning recorded); next start serves HTTP 200 with placeholder sections and no observed copy. First probe with wrong layout (starter-at-root) failed honestly on sibling import and was corrected to kit layout; both recorded.

## Correctness — PASS

- tsconfig strict/bundler/next-plugin, next.config strict mode, tailwind content globs, postcss tailwind+autoprefixer, globals.css directives, layout imports ./globals.css plus kit sibling, package.json typecheck script plus @types/node, @types/react, @types/react-dom, postcss, autoprefixer pinned. Starter set 4 to 9 files; rebuilds byte-identical. Zero must-fix.

## Parsimony — PASS

- One synthesis module extended; 2 test files updated; no new service, no contract version bump (starter/* prefix is open-ended in the frozen manifest). No unrelated refactor.

## Product — PASS

- Satisfies Build Kit starter clean-consumer item: generated starter installs, typechecks, builds, starts, and serves placeholders from a clean kit extraction without the monorepo. Keyboard smoke: placeholders render headings with no interactive controls to trap focus (honest, no fabricated audit). Responsive: Tailwind max-w-3xl scaffold builds under both viewport captures.

## Security — PASS

- All 9 files carry synthesis headers/placeholders; observed copy excluded (tested); sibling import is a static CSS reference; no secrets or remote code. Zero must-fix. Graft blast isolated to starter synthesis with test reach 1/1.
