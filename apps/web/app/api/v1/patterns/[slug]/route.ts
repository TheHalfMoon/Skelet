import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../../lib/mcp";
import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { getPatternRoute } from "../../../../../lib/rest";
import { AgentContractError, newRequestId } from "../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * P10-C GET /api/v1/patterns/{slug} — actor-scoped pattern detail over
 * the same envelope the get_pattern MCP tool serves.
 */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const token = bearerToken(request.headers.get("authorization"));
  const limit = checkRateLimit(`rest:${clientKey(request, token)}`);
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
  try {
    // AF-SEC-00: identity is server-resolved and threaded as the actor so
    // patterns without readable artifacts answer not-found without oracle.
    const userId = await resolveRequestUser(db, token);
    const { slug } = await context.params;
    const result = await getPatternRoute(
      db,
      decodeURIComponent(slug),
      userId,
      request.headers.get("x-request-id"),
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "X-Request-Id": result.body.request_id },
    });
  } catch {
    const err = new AgentContractError("UNAUTHENTICATED", { requestId });
    return NextResponse.json(err.toFailureEnvelope(), {
      status: err.httpStatus,
      headers: { "X-Request-Id": requestId },
    });
  }
}
