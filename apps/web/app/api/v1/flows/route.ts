import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../lib/session";
import { getSharedDb } from "../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { clientKey } from "../../../../lib/http";
import { listFlowsRoute } from "../../../../lib/rest";
import { AgentContractError, newRequestId } from "../../../../lib/agent-contract";

function searchParams(request: Request): Record<string, string | undefined> {
  const url = new URL(request.url);
  const params: Record<string, string | undefined> = {};
  url.searchParams.forEach((value, key) => {
    if (params[key] === undefined) {
      params[key] = value;
    }
  });
  return params;
}

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * AF-14a GET /api/v1/flows — actor-scoped flow listing over the same
 * envelope the list_flows MCP tool serves.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const token = requestToken(request).token;
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
    // flow visibility filters before pagination.
    const userId = await resolveRequestUserFromRequest(db, request);
    const result = await listFlowsRoute(
      db,
      searchParams(request),
      userId,
      request.headers.get("x-request-id"),
    );
    // AF-03c: echo the canonical envelope request_id so independent REST
    // clients correlate retries without parsing the body first.
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
