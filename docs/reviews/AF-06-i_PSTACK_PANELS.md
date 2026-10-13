# AF-06-i PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.35, correctness 0.45, evidence 0.29, reliability 0.47, scope 0.60, security 0.34 (model `jev-1.13.0`, ok true).
- Suites: video-frame-evidence 6/6; typecheck/lint (skelet-lens) clean. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Mapping exactness proven incl. fractional fps; consistency gate rejects self-disagreeing metadata; single-slot division guard added pre-commit; decoder absence is a documented boundary with typed unsupported behavior, not a silent gap. Zero must-fix.

## Parsimony — PASS

- One module, one test file, one CI line. Reuses inspectJpeg; no new dependency. No unrelated refactor.

## Product — PASS

- Gives P10 flow steps an optional, bounded, provenance-bound video-evidence primitive; report-assembly attachment is explicitly deferred to AF-06-ii rather than half-integrated.

## Security — PASS

- Untrusted declarations fail closed; frames authenticated before evidence; budgets enforced at three levels; digests bind identity, mapping, and bytes. Zero must-fix.
