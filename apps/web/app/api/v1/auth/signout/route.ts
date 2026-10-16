import { NextResponse } from "next/server";

import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { signoutRoute } from "../../../../../lib/session";
import { AgentContractError, newRequestId } from "../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * POST /api/v1/auth/signout — revoke the presented session and always
 * clear the cookie. Unknown sessions converge to the same cleared
 * outcome; logout is not a privileged operation.
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
  const result = await signoutRoute(db, request, requestId);
  const headers: Record<string, string> = { "X-Request-Id": result.body.request_id };
  if (result.setCookie !== undefined) headers["Set-Cookie"] = result.setCookie;
  return NextResponse.json(result.body, { status: result.status, headers });
}
