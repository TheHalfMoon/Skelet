import {
  AUTH_SESSION_TTL_SECONDS,
  signIn,
  signOut,
  signUp,
  validateSession,
} from "../../../packages/db/src/auth.ts";
import { createWorkspace } from "../../../packages/db/src/workspaces.ts";
import type { DbClient } from "../../../packages/db/src/db.ts";
import {
  AgentContractError,
  failureEnvelope,
  newRequestId,
  successEnvelope,
} from "./agent-contract.ts";
import type { AgentEnvelope } from "./agent-contract.ts";

/**
 * Issue #152: first-party browser session layer over the authorized
 * `packages/db` auth/session contract (salted-scrypt verifiers, opaque
 * SHA-256-hashed session tokens, revocation, expiry).
 *
 * Design (local-first, zero paid services):
 * - Agents keep using `Authorization: Bearer` (no ambient authority, so no
 *   CSRF exposure). Browsers use an HttpOnly `skilit_session` cookie that
 *   the server sets on sign-in/sign-up and clears on sign-out. Raw tokens
 *   never appear in URLs, logs, or `localStorage`.
 * - Sign-up is bootstrap-only: it succeeds exactly while the users table
 *   is empty (first owner). Afterwards the route answers 400 with a static
 *   message, so there is no uncontrolled public registration and no
 *   email-taken oracle beyond what `/api/v1/auth/status` already discloses
 *   (`{ initialized }` tells the UI whether to offer owner creation).
 * - Cookie-authenticated unsafe methods (POST/PUT/PATCH/DELETE) require a
 *   matching `Origin` (else `Referer`) against the request origin.
 *   Bearer-authenticated calls are exempt: they carry no ambient authority.
 *   Sign-in/sign-up enforce the same origin rule because they establish
 *   ambient authority (login-CSRF defense); absent headers are tolerated so
 *   headless operator `curl` bootstrap keeps working, while any present
 *   mismatch fails closed.
 * - Every failure uses the canonical agent envelope with static safe
 *   strings; unknown emails and wrong passwords stay indistinguishable.
 */

export const SESSION_COOKIE_NAME = "skilit_session" as const;

/** Raw session tokens are base64url; bound generously, validated strictly. */
const SESSION_TOKEN_MAX_CHARS = 256;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface PresentedCredential {
  token: string | null;
  /** True when the token arrived via cookie (ambient authority). */
  viaCookie: boolean;
}

function readSessionCookie(header: string): string | null {
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(index + 1).trim();
    if (
      value.length === 0 ||
      value.length > SESSION_TOKEN_MAX_CHARS ||
      !SESSION_TOKEN_PATTERN.test(value)
    ) {
      return null;
    }
    return value;
  }
  return null;
}

/**
 * Extract the presented credential: `Authorization: Bearer` first (agent
 * path), then the session cookie (browser path). Malformed cookies read as
 * absent so callers fail closed with 401 instead of crashing.
 */
export function requestToken(request: Request): PresentedCredential {
  const header = request.headers.get("authorization");
  if (typeof header === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    const token = (match?.[1] ?? "").trim();
    if (token.length > 0) return { token, viaCookie: false };
  }
  const cookie = request.headers.get("cookie");
  if (typeof cookie === "string") {
    const token = readSessionCookie(cookie);
    if (token !== null) return { token, viaCookie: true };
  }
  return { token: null, viaCookie: false };
}

function isSecureRequest(request: Request): boolean {
  try {
    if (new URL(request.url).protocol === "https:") return true;
  } catch {
    return true;
  }
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

/** `Set-Cookie` value for an established session (never readable by JS). */
export function sessionCookieHeader(token: string, request: Request): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${AUTH_SESSION_TTL_SECONDS}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

/** `Set-Cookie` value that clears the session (same Path/SameSite scope). */
export function clearSessionCookieHeader(request: Request): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function expectedOrigin(request: Request): string | null {
  const host = request.headers.get("host");
  try {
    const url = new URL(request.url);
    return `${url.protocol}//${host ?? url.host}`;
  } catch {
    return null;
  }
}

/**
 * Origin/Referer check for requests that establish or exercise ambient
 * (cookie) authority. Present-but-mismatched fails closed; absent headers
 * are tolerated for headless operator clients. Bearer-only requests should
 * not call this (they are exempt by construction).
 */
export function isOriginAllowed(request: Request): boolean {
  const expected = expectedOrigin(request);
  if (expected === null) return false;
  const expectedOriginValue = (() => {
    try {
      return new URL(expected).origin;
    } catch {
      return null;
    }
  })();
  if (expectedOriginValue === null) return false;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    try {
      return new URL(origin).origin === expectedOriginValue;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === expectedOriginValue;
    } catch {
      return false;
    }
  }
  return true;
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * Server-resolve the request identity for HTTP routes: Bearer or session
 * cookie, with the cookie path additionally gated by the origin check on
 * unsafe methods. Throws `AgentContractError` (`UNAUTHENTICATED` for
 * missing/invalid sessions, `INVALID_INPUT` for failed origin checks).
 */
export async function resolveRequestUserFromRequest(
  db: DbClient,
  request: Request,
  providedRequestId?: unknown,
): Promise<string> {
  const requestId = newRequestId(providedRequestId);
  const presented = requestToken(request);
  if (presented.token === null) {
    throw new AgentContractError("UNAUTHENTICATED", { requestId });
  }
  if (presented.viaCookie && isUnsafeMethod(request.method) && !isOriginAllowed(request)) {
    throw new AgentContractError("INVALID_INPUT", {
      message: "Request origin is not allowed.",
      requestId,
    });
  }
  try {
    const session = await validateSession(db, presented.token);
    return session.user.id;
  } catch {
    throw new AgentContractError("UNAUTHENTICATED", { requestId });
  }
}

export interface SessionRouteResult {
  status: number;
  body: AgentEnvelope;
  setCookie?: string | undefined;
}

function invalidInput(requestId: string, message: string): SessionRouteResult {
  const err = new AgentContractError("INVALID_INPUT", { message, requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

function unauthenticated(requestId: string): SessionRouteResult {
  const err = new AgentContractError("UNAUTHENTICATED", { requestId });
  return { status: err.httpStatus, body: err.toFailureEnvelope() };
}

async function hasAnyUser(db: DbClient): Promise<boolean> {
  const result = await db.query("select exists (select 1 from users) as present");
  return (result.rows[0] as Record<string, unknown> | undefined)?.present === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * POST /api/v1/auth/signup — bootstrap-only owner creation. Succeeds
 * exactly while no user exists; otherwise answers 400 with a static
 * message (no public registration, no email oracle).
 */
export async function signupRoute(
  db: DbClient,
  body: unknown,
  request: Request,
  providedRequestId?: unknown,
): Promise<SessionRouteResult> {
  const requestId = newRequestId(providedRequestId);
  if (!isOriginAllowed(request)) {
    return invalidInput(requestId, "Request origin is not allowed.");
  }
  const record = isRecord(body) ? body : null;
  const email = record?.email;
  const password = record?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return invalidInput(requestId, "Email and password are required.");
  }
  try {
    if (await hasAnyUser(db)) {
      return invalidInput(requestId, "Signup is not available.");
    }
    // Sequential (never nested transactions): sign-up, then the personal
    // workspace, then the session. A concurrent bootstrap loses on the
    // unique email index and converges to the same closed answer below.
    const user = await db.transaction(async (tx) => signUp(tx, { email, password }));
    const space = await createWorkspace(db, { name: "Personal", ownerId: user.id });
    const signed = await db.transaction(async (tx) => signIn(tx, { email, password }));
    const created = { user, workspaceId: space.workspace.id, token: signed.token };
    return {
      status: 201,
      body: successEnvelope(requestId, {
        user: { id: created.user.id, email: created.user.email },
        workspaceId: created.workspaceId,
      }),
      setCookie: sessionCookieHeader(created.token, request),
    };
  } catch (error: unknown) {
    if (error !== null && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      // A concurrent bootstrap may win first: converge to the same closed
      // answer as the already-initialized case (never leak which email won).
      if (code === "auth/email-taken") {
        return invalidInput(requestId, "Signup is not available.");
      }
      if (code === "auth/invalid-email") {
        return invalidInput(requestId, "Email address is invalid.");
      }
      if (code === "auth/invalid-password") {
        return invalidInput(requestId, "Password must be 8 to 128 characters.");
      }
    }
    const err = new AgentContractError("INTERNAL_OPAQUE", { requestId });
    return { status: err.httpStatus, body: err.toFailureEnvelope() };
  }
}

/**
 * POST /api/v1/auth/signin — credential check with a generic failure
 * message (unknown emails and wrong passwords stay indistinguishable).
 * Success sets the HttpOnly session cookie; the raw token is never
 * returned in a readable body field beyond establishing the cookie.
 */
export async function signinRoute(
  db: DbClient,
  body: unknown,
  request: Request,
  providedRequestId?: unknown,
): Promise<SessionRouteResult> {
  const requestId = newRequestId(providedRequestId);
  if (!isOriginAllowed(request)) {
    return invalidInput(requestId, "Request origin is not allowed.");
  }
  const record = isRecord(body) ? body : null;
  const email = record?.email;
  const password = record?.password;
  if (typeof email !== "string" || typeof password !== "string") {
    return invalidInput(requestId, "Email and password are required.");
  }
  try {
    const signed = await db.transaction(async (tx) => signIn(tx, { email, password }));
    return {
      status: 200,
      body: successEnvelope(requestId, {
        user: { id: signed.user.id, email: signed.user.email },
        expiresAt: signed.session.expiresAt,
      }),
      setCookie: sessionCookieHeader(signed.token, request),
    };
  } catch (error: unknown) {
    if (error !== null && typeof error === "object" && "code" in error) {
      const code = String((error as { code: unknown }).code);
      if (code === "auth/invalid-credentials" || code === "auth/invalid-email") {
        return invalidInput(requestId, "Invalid email or password.");
      }
    }
    const err = new AgentContractError("INTERNAL_OPAQUE", { requestId });
    return { status: err.httpStatus, body: err.toFailureEnvelope() };
  }
}

/**
 * POST /api/v1/auth/signout — revoke the presented session (Bearer or
 * cookie) and always clear the cookie. Unknown sessions still clear the
 * cookie and answer success: logout is not a privileged operation and
 * there is nothing to leak.
 */
export async function signoutRoute(
  db: DbClient,
  request: Request,
  providedRequestId?: unknown,
): Promise<SessionRouteResult> {
  const requestId = newRequestId(providedRequestId);
  const presented = requestToken(request);
  if (presented.viaCookie && isUnsafeMethod(request.method) && !isOriginAllowed(request)) {
    return invalidInput(requestId, "Request origin is not allowed.");
  }
  if (presented.token !== null) {
    try {
      await db.transaction(async (tx) => signOut(tx, presented.token as string));
    } catch {
      // Unknown/expired tokens converge to the same cleared outcome.
    }
  }
  return {
    status: 200,
    body: successEnvelope(requestId, { signedOut: true }),
    setCookie: clearSessionCookieHeader(request),
  };
}

/**
 * GET /api/v1/auth/session — whoami for expiry recovery. Valid sessions
 * answer 200 with the user identity and expiry; everything else answers
 * 401 so the UI can route to sign-in without distinguishing causes.
 */
export async function sessionStatusRoute(
  db: DbClient,
  request: Request,
  providedRequestId?: unknown,
): Promise<SessionRouteResult> {
  const requestId = newRequestId(providedRequestId);
  const presented = requestToken(request);
  if (presented.token === null) return unauthenticated(requestId);
  try {
    const session = await validateSession(db, presented.token);
    return {
      status: 200,
      body: successEnvelope(requestId, {
        user: { id: session.user.id, email: session.user.email },
        expiresAt: session.session.expiresAt,
      }),
    };
  } catch {
    return unauthenticated(requestId);
  }
}

/**
 * GET /api/v1/auth/status — public bootstrap signal for the UI
 * (`{ initialized }`). Discloses only whether any user exists, which the
 * signup route's closed answer already implies; never emails or counts.
 */
export async function authStatusRoute(
  db: DbClient,
  providedRequestId?: unknown,
): Promise<SessionRouteResult> {
  const requestId = newRequestId(providedRequestId);
  try {
    const initialized = await hasAnyUser(db);
    return { status: 200, body: successEnvelope(requestId, { initialized }) };
  } catch {
    const err = failureEnvelope(requestId, "INTERNAL_OPAQUE");
    return { status: 500, body: err };
  }
}
