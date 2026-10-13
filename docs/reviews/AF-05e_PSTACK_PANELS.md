# AF-05e PStack Panels (manual fresh-context fallback)

- PStack binary unavailable (`which pstack` not found). No paid provider activated. Manual fresh-context four-bar fallback. MUST NOT be described as an independent-model review.
- Jev final: compatibility 0.17, correctness 0.43, evidence 0.45, reliability 0.31, scope 0.43, security 0.43 (model `jev-1.13.0`, ok true).
- Suites on the grain worktree: web 72/72 (incl. 11 lens-jobs, 8 mcp-lens, 2 lens-recovery, 4 lens-ui), db 102/102, lens 186/186, python 170/170, node+worker 21/21, storage+no-model 23/23; typecheck (web, db) clean; lint (web, db) clean; `pnpm --dir apps/web build` succeeds with `/lens` static and 6 lens API routes; validators (agent contract, build kit, skills) pass.

## Correctness — PASS

- MCP lens tools delegate to the same `lens-jobs` route layer REST serves, so success envelopes and error codes are identical by construction; verified by deep-equal poll envelopes and byte-identical artifact digests across transports.
- Malformed kit IDs/URIs answer opaque FORBIDDEN_OR_NOT_FOUND on both transports (first parity test caught an MCP 400 vs REST 404 split; fixed in the resolver before commit, not hidden).
- Lease-expiry resume proven through the route layer with a real time boundary (600s-past claim, live resume); close/reopen persistence proven on a file-backed store.
- Migration 013 fixes the genuine retention bug (expiry of completed/partial runs always violated the CHECKs); purge regression test locks the fix. Zero must-fix.

## Parsimony — PASS

- One shared server layer (`lens-jobs.ts`) serves REST routes, MCP tools, and (via REST) the UI; no parallel job system. MCP adds thin delegation branches plus a kitId/URI resolver; UI is one page over the existing REST contracts.
- Test-count assertions updated in exactly the 3 files that pin the tool inventory (6 to 13). No unrelated refactor.

## Product — PASS

- Satisfies the AF-05e parity item: create, poll-to-terminal (UI watch with 60s timeout), inspect with evidence/artifact summary, authorized download with integrity digest, cancel/retry/resume, all by stable `skelet://lens/{id}` on REST, MCP, and UI.
- UI states: credentials gate, loading indicator, assertive error announcements, empty state, withheld-output disclosure, keyboard-native controls with labels, responsive single-column layout.
- No-model: lens and MCP lens surfaces reference no provider, key, or fetch; validated by test and by the full local suite running without provider credentials.

## Security — PASS

- Membership-resolved actorId is the authority on every path; unknown, denied, malformed, purged, and cross-tenant identifiers answer alike with no oracle.
- Quota enforced deterministically in the store (concurrency cap proven, then released on cancel); idempotent replay converges without double charge; terminal runs immutable; invalid transitions 409; allowlisted artifact names only; withheld files listed, never served; bearer tokens stay in memory, never logged. Zero must-fix. Graft `build` plus `check` green locally (exit 0, fresh graph); CI graft job re-verifies at the exact head.
