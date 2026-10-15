import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../../../lib/mcp";
import { getSharedDb } from "../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../lib/http";
import { recordReplayEventsRoute, getReplayEventsRoute } from "../../../../../../lib/rest";
import { AgentContractError, newRequestId } from "../../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

/**
 * P10-D2 GET /api/v1/replays/{id}/events — replay one session over the
 * same envelope the replay_get_events MCP tool serves.
 */
export async function GET(request: Request, route: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    // foreign sessions answer not-found without an oracle.
    const userId = await resolveRequestUser(db, token);
    const { id } = await route.params;
    const result = await getReplayEventsRoute(
      db,
      decodeURIComponent(id),
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

/**
 * P10-D2 POST /api/v1/replays/{id}/events — record redacted events over
 * the same envelope the replay_record_events MCP tool serves.
 */
export async function POST(request: Request, route: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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
    // foreign sessions answer not-found without an oracle.
    const userId = await resolveRequestUser(db, token);
    const { id } = await route.params;
    const result = await recordReplayEventsRoute(
      db,
      decodeURIComponent(id),
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
