import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "../../../packages/db/src/db.ts";
import { migrateUp } from "../../../packages/db/src/migrate.ts";
import { signUp } from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import {
  authStatusRoute,
  clearSessionCookieHeader,
  isOriginAllowed,
  requestToken,
  resolveRequestUserFromRequest,
  sessionCookieHeader,
  sessionStatusRoute,
  signinRoute,
  signoutRoute,
  signupRoute,
  SESSION_COOKIE_NAME,
} from "../lib/session.ts";

const ORIGIN = "http://localhost:3103";

function httpRequest(path, options = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    body: options.body,
  });
}

function jsonRequest(path, body, headers = {}) {
  return httpRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function tokenFromSetCookie(setCookie) {
  assert.ok(typeof setCookie === "string" && setCookie.length > 0, "expected a Set-Cookie value");
  const match = new RegExp(`^${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  assert.ok(match !== null, "Set-Cookie carries the session cookie");
  return match[1];
}

async function fixture() {
  const db = await openDatabase();
  await migrateUp(db);
  return { db };
}

test("auth status reports bootstrap state without leaking identity", async () => {
  const fx = await fixture();
  try {
    const before = await authStatusRoute(fx.db, "rid-status-1");
    assert.equal(before.status, 200);
    assert.deepEqual(before.body.result, { initialized: false });
    const signup = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signup-1",
    );
    assert.equal(signup.status, 201);
    const after = await authStatusRoute(fx.db, "rid-status-2");
    assert.deepEqual(after.body.result, { initialized: true });
  } finally {
    await fx.db.close();
  }
});

test("bootstrap signup creates owner, workspace, and a secure cookie; then closes", async () => {
  const fx = await fixture();
  try {
    const first = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signup-2",
    );
    assert.equal(first.status, 201);
    assert.ok(typeof first.body.result.workspaceId === "string", "bootstrap provisions a workspace");
    const setCookie = first.setCookie ?? "";
    for (const attr of ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age="]) {
      assert.ok(setCookie.includes(attr), `cookie carries ${attr}`);
    }
    assert.ok(!setCookie.includes("Secure"), "plain-http responses omit Secure");
    const token = tokenFromSetCookie(setCookie);
    assert.ok(token.length >= 43, "opaque session token has full entropy");

    const second = await signupRoute(
      fx.db,
      { email: "second@skilit.example", password: "second-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "second@skilit.example", password: "second-password-01" }),
      "rid-signup-3",
    );
    assert.equal(second.status, 400);
    assert.equal(second.body.error?.code, "INVALID_INPUT");
    assert.equal(second.body.result !== undefined, true);
    assert.equal(second.setCookie, undefined);
  } finally {
    await fx.db.close();
  }
});

test("signup validates input and rejects mismatched origins", async () => {
  const fx = await fixture();
  try {
    const badEmail = await signupRoute(
      fx.db,
      { email: "not-an-email", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "not-an-email", password: "owner-password-01" }),
      "rid-signup-4",
    );
    assert.equal(badEmail.status, 400);
    const shortPassword = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "short" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "short" }),
      "rid-signup-5",
    );
    assert.equal(shortPassword.status, 400);
    const csrf = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest(
        "/api/v1/auth/signup",
        { email: "owner@skilit.example", password: "owner-password-01" },
        { Origin: "https://evil.example" },
      ),
      "rid-signup-6",
    );
    assert.equal(csrf.status, 400);
    assert.equal(csrf.body.error?.message, "Request origin is not allowed.");
  } finally {
    await fx.db.close();
  }
});

test("signin succeeds with a cookie and fails closed without enumeration", async () => {
  const fx = await fixture();
  try {
    await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signup-7",
    );
    const ok = await signinRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signin", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signin-1",
    );
    assert.equal(ok.status, 200);
    assert.ok(typeof ok.setCookie === "string");
    const wrongPassword = await signinRoute(
      fx.db,
      { email: "owner@skilit.example", password: "wrong-password-01" },
      jsonRequest("/api/v1/auth/signin", { email: "owner@skilit.example", password: "wrong-password-01" }),
      "rid-signin-2",
    );
    const unknownEmail = await signinRoute(
      fx.db,
      { email: "nobody@skilit.example", password: "wrong-password-01" },
      jsonRequest("/api/v1/auth/signin", { email: "nobody@skilit.example", password: "wrong-password-01" }),
      "rid-signin-3",
    );
    assert.equal(wrongPassword.status, 400);
    assert.equal(unknownEmail.status, wrongPassword.status);
    assert.equal(unknownEmail.body.error?.code, wrongPassword.body.error?.code);
    assert.equal(unknownEmail.body.error?.message, wrongPassword.body.error?.message);
    assert.equal(unknownEmail.setCookie, undefined);
  } finally {
    await fx.db.close();
  }
});

test("session endpoint resolves the cookie identity; signout revokes and clears", async () => {
  const fx = await fixture();
  try {
    const signup = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signup-8",
    );
    const token = tokenFromSetCookie(signup.setCookie);
    const ownerId = signup.body.result.user.id;

    const whoami = await sessionStatusRoute(
      fx.db,
      httpRequest("/api/v1/auth/session", { headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` } }),
      "rid-session-1",
    );
    assert.equal(whoami.status, 200);
    assert.equal(whoami.body.result.user.id, ownerId);

    const tampered = await sessionStatusRoute(
      fx.db,
      httpRequest("/api/v1/auth/session", { headers: { Cookie: `${SESSION_COOKIE_NAME}=bogus-token-value` } }),
      "rid-session-2",
    );
    assert.equal(tampered.status, 401);

    const malformed = await sessionStatusRoute(
      fx.db,
      httpRequest("/api/v1/auth/session", { headers: { Cookie: `${SESSION_COOKIE_NAME}=!!!not-a-token!!!` } }),
      "rid-session-3",
    );
    assert.equal(malformed.status, 401);

    const out = await signoutRoute(
      fx.db,
      httpRequest("/api/v1/auth/signout", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}`, Origin: ORIGIN },
      }),
      "rid-signout-1",
    );
    assert.equal(out.status, 200);
    assert.ok((out.setCookie ?? "").includes("Max-Age=0"), "signout clears the cookie");

    const afterRevoke = await sessionStatusRoute(
      fx.db,
      httpRequest("/api/v1/auth/session", { headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` } }),
      "rid-session-4",
    );
    assert.equal(afterRevoke.status, 401);
  } finally {
    await fx.db.close();
  }
});

test("cookie-authenticated mutations require a matching origin; bearer stays exempt", async () => {
  const fx = await fixture();
  try {
    const signup = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signup-9",
    );
    const token = tokenFromSetCookie(signup.setCookie);
    const ownerId = signup.body.result.user.id;
    const cookie = { Cookie: `${SESSION_COOKIE_NAME}=${token}` };

    const safeMismatch = await resolveRequestUserFromRequest(
      fx.db,
      httpRequest("/api/v1/products", { headers: { ...cookie, Origin: "https://evil.example" } }),
      "rid-csrf-1",
    );
    assert.equal(safeMismatch, ownerId);

    await assert.rejects(
      resolveRequestUserFromRequest(
        fx.db,
        httpRequest("/api/v1/boards", { method: "POST", headers: { ...cookie, Origin: "https://evil.example" } }),
        "rid-csrf-2",
      ),
      (error) => error?.code === "INVALID_INPUT",
    );

    const bearerMismatch = await resolveRequestUserFromRequest(
      fx.db,
      httpRequest("/api/v1/boards", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Origin: "https://evil.example" },
      }),
      "rid-csrf-3",
    );
    assert.equal(bearerMismatch, ownerId);

    const cookieMatch = await resolveRequestUserFromRequest(
      fx.db,
      httpRequest("/api/v1/boards", { method: "POST", headers: { ...cookie, Origin: ORIGIN } }),
      "rid-csrf-4",
    );
    assert.equal(cookieMatch, ownerId);
  } finally {
    await fx.db.close();
  }
});

test("cookie identities stay workspace-scoped and bearer behavior is unchanged", async () => {
  const fx = await fixture();
  try {
    const first = await signupRoute(
      fx.db,
      { email: "owner@skilit.example", password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signup", { email: "owner@skilit.example", password: "owner-password-01" }),
      "rid-signup-10",
    );
    const ownerId = first.body.result.user.id;
    const visitor = await signUp(fx.db, { email: "visitor@skilit.example", password: "visitor-password-01" });
    const visitorSpace = await createWorkspace(fx.db, { name: "Visitor", ownerId: visitor.id });
    assert.notEqual(visitorSpace.workspace.id, first.body.result.workspaceId);

    const ownerToken = tokenFromSetCookie(first.setCookie);
    const resolved = await resolveRequestUserFromRequest(
      fx.db,
      httpRequest("/api/v1/boards", { headers: { Cookie: `${SESSION_COOKIE_NAME}=${ownerToken}` } }),
      "rid-scope-1",
    );
    assert.equal(resolved, ownerId);

    await assert.rejects(resolveRequestUserFromRequest(fx.db, httpRequest("/api/v1/boards"), "rid-scope-2"));
  } finally {
    await fx.db.close();
  }
});

test("concurrent bootstraps converge to one owner without orphans", async () => {
  const fx = await fixture();
  try {
    const attempt = (email, rid) =>
      signupRoute(
        fx.db,
        { email, password: "owner-password-01" },
        jsonRequest("/api/v1/auth/signup", { email, password: "owner-password-01" }),
        rid,
      );
    const [first, second] = await Promise.all([
      attempt("first@skilit.example", "rid-race-1"),
      attempt("second@skilit.example", "rid-race-2"),
    ]);
    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [201, 400]);
    const loser = first.status === 400 ? first : second;
    assert.equal(loser.body.error?.code, "INVALID_INPUT");
    assert.equal(loser.setCookie, undefined);
    const users = await fx.db.query("select count(*) as count from users");
    assert.equal(String(users.rows[0].count), "1");
    const spaces = await fx.db.query("select count(*) as count from workspaces");
    assert.equal(String(spaces.rows[0].count), "1");
    // The single winner is fully usable: retry-style signin works.
    const winnerEmail = first.status === 201 ? "first@skilit.example" : "second@skilit.example";
    const retry = await signinRoute(
      fx.db,
      { email: winnerEmail, password: "owner-password-01" },
      jsonRequest("/api/v1/auth/signin", { email: winnerEmail, password: "owner-password-01" }),
      "rid-race-3",
    );
    assert.equal(retry.status, 200);
  } finally {
    await fx.db.close();
  }
});

test("cookie helpers parse strictly and flag secure contexts", () => {
  assert.equal(requestToken(httpRequest("/x")).token, null);
  const bearer = requestToken(
    httpRequest("/x", { headers: { Authorization: "Bearer abc123" } }),
  );
  assert.deepEqual(bearer, { token: "abc123", viaCookie: false });
  const cookie = requestToken(
    httpRequest("/x", { headers: { Cookie: `a=1; ${SESSION_COOKIE_NAME}=tok_abc-123; b=2` } }),
  );
  assert.deepEqual(cookie, { token: "tok_abc-123", viaCookie: true });
  assert.equal(
    requestToken(httpRequest("/x", { headers: { Cookie: `${SESSION_COOKIE_NAME}=!!!` } })).token,
    null,
  );
  // Bearer wins when both are presented (no ambient authority ambiguity).
  const both = requestToken(
    httpRequest("/x", {
      headers: { Authorization: "Bearer abc123", Cookie: `${SESSION_COOKIE_NAME}=cookie-token` },
    }),
  );
  assert.deepEqual(both, { token: "abc123", viaCookie: false });

  assert.equal(isOriginAllowed(httpRequest("/x")), true);
  assert.equal(
    isOriginAllowed(httpRequest("/x", { method: "POST", headers: { Origin: ORIGIN } })),
    true,
  );
  assert.equal(
    isOriginAllowed(httpRequest("/x", { method: "POST", headers: { Origin: "https://evil.example" } })),
    false,
  );
  const secure = sessionCookieHeader("t", new Request("https://skilit.local/api/x"));
  assert.ok(secure.includes("Secure"), "https responses set Secure");
  assert.ok(clearSessionCookieHeader(httpRequest("/x")).includes("Max-Age=0"));
});
