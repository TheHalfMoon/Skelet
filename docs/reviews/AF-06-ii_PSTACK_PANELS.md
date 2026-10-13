# AF-06-ii PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.38, correctness 0.42, evidence 0.25, reliability 0.46, scope 0.25, security 0.41 (model `jev-1.13.0`, ok true).
- Suites: lens 197/197 (incl. 2 attachment); typecheck/lint (skelet-lens) clean. Graft `check .` green locally; CI graft job re-verifies at the exact head.

## Correctness — PASS

- Attach re-authenticates records (digest recompute over the presented body, mapping and dimension cross-checks); base assembly untouched so existing digests never shift; downstream manifest/export read digests only. Zero must-fix.

## Parsimony — PASS

- One function, one validator, one optional field, one test file, one CI line. No worker/route exposure in this slice. No unrelated refactor.

## Product — PASS

- Completes AF-06's integration requirement at the evidence layer: flow steps can now carry optional, provenance-bound video evidence end to end from mapping through report identity.

## Security — PASS

- Untrusted inputs fail closed at both gates; substitution invalidates digests; no silent overwrite; no network/codec/secrets. Zero must-fix.
