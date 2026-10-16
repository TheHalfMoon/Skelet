import { NextResponse } from "next/server";

import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { signinRoute } from "../../../../../lib/session";
import { AgentContractError, newRequestId } from "../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * POST /api/v1/auth/signin — credential check with a generic failure
 * message. Success sets the HttpOnly session cookie; the raw token never
 * appears in a readable body, URL, or log. Origin-checked (login-CSRF
 * defense); absent Origin/Referer is tolerated for headless operator use.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const limit = checkRateLimit(`auth:${clientKey(request, null)}`);
  if (!limit.allowed) {
    const err = new AgentContractError("RATE_LIMITED", { requestId });
    return NextResponse.json(err.toFailureEnvelope(), {
      status: err.httpStatus,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  let db;
  try {
    db = await getSharedDb();
  } catch {
    const err = new AgentContractError("INTERNAL_OPAQUE", { requestId });
    return NextResponse.json(err.toFailureEnvelope(), { status: err.httpStatus });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await signinRoute(db, body, request, requestId);
  const headers: Record<string, string> = { "X-Request-Id": result.body.request_id };
  if (result.setCookie !== undefined) headers["Set-Cookie"] = result.setCookie;
  return NextResponse.json(result.body, { status: result.status, headers });
}
