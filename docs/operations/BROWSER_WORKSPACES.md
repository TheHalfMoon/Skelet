# Browser workspaces — cookie-first access

Skilit's human interface uses an HttpOnly `skilit_session` cookie from the
existing first-party browser sign-in implementation. The Gallery, Patterns,
Flows, Boards and Lens screens now share the same authenticated workflow;
they do **not** ask the user to copy session credentials or paste an API token.

## Browser flow

1. Install and configure the local Skilit service/database using the
   repository's normal deployment instructions.
2. Use `/signup` **exactly once** for owner bootstrap, or `/login` for an
   existing account. Uncontrolled public registration is not supported.
3. Visit `/gallery`, `/patterns`, `/flows`, `/boards` or `/lens`.
   The page displays its current session state, and normal API requests send
   the browser's same-origin cookie automatically.
4. Gallery/Patterns/Flows can list actor-scoped records immediately. Boards
   and Lens discover only the spaces returned by authenticated membership and
   offer a real workspace chooser. A sole workspace is preselected; multiple
   workspaces require explicit selection, never an invented default.
5. When a session expires or is revoked, the page presents a sign-in link
   and server-side access is denied as before.

## Security boundaries

- Browser `sessionRequest` accepts only first-party `/api/v1/` paths,
  sets `credentials: "same-origin"` and `cache: "no-store"`, and explicitly
  rejects any supplied `Authorization` header.
- No `localStorage`, `sessionStorage`, `document.cookie`, raw token
  display, URL tokens, or client-readable bearer token is used for login.
- The existing server validates sessions and enforces same-origin checks on
  cookie-authenticated unsafe methods; this change does **not** create a
  second authentication store or relax membership guards.
- Agent clients continue to send their explicit Bearer credentials over
  REST/MCP unchanged.
- The browser UI communicates expired session state, but authorization is
  always checked server-side on every request.
- Users must not infer successful authentication solely from the banner.

## Qualification

- Existing authentication, workspace isolation and REST/MCP parity suites.
- Unit contract for the first-party cookie transport and no-token UI.
- Real Chromium with 1440px and 390px layouts across all five pages.
- Browser-intercepted session and expiry exercises verify cookie transmission
  without JavaScript access to the credential. These UI transport checks are
  **mocked endpoint** tests; the real DB-backed full-stack proof is recorded
  separately in PR #157.
- Run exact-head GitHub CI before merging. No new release or tag.
