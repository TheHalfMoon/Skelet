import { NextResponse } from "next/server";

import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { authStatusRoute } from "../../../../../lib/session";
import { AgentContractError, newRequestId } from "../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * GET /api/v1/auth/status — public bootstrap signal (`{ initialized }`)
 * so the UI knows whether to offer first-owner creation. Discloses only
 * whether any user exists; never emails or counts.
 */
export async function GET(request: Request): Promise<NextResponse> {
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
  const result = await authStatusRoute(db, requestId);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}
