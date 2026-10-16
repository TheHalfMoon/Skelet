import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../lib/session";
import { getSharedDb } from "../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { clientKey } from "../../../../lib/http";
import { openReplaySessionRoute } from "../../../../lib/rest";
import { AgentContractError, newRequestId } from "../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * P10-D2 POST /api/v1/replays — open a consented replay session over the
 * same envelope the replay_open_session MCP tool serves.
 */
export async function POST(request: Request): Promise<NextResponse> {
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
  let body: Record<string, unknown> | null;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    const err = new AgentContractError("INVALID_INPUT", { requestId });
    return NextResponse.json(err.toFailureEnvelope(), {
      status: err.httpStatus,
      headers: { "X-Request-Id": requestId },
    });
  }
  try {
    // AF-SEC-00: identity is server-resolved and threaded as the actor so
    // sessions for unreadable flows answer not-found without an oracle.
    const userId = await resolveRequestUserFromRequest(db, request);
    const result = await openReplaySessionRoute(
      db,
      body,
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
