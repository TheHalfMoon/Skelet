import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../../../lib/mcp";
import { getSharedDb } from "../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../lib/http";
import { closeReplaySessionRoute } from "../../../../../../lib/rest";
import { AgentContractError, newRequestId } from "../../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

async function context(request: Request): Promise<
  | { db: Awaited<ReturnType<typeof getSharedDb>>; userId: string }
  | { failure: NextResponse }
> {
  const requestId = requestIdOf(request);
  const token = bearerToken(request.headers.get("authorization"));
  const limit = checkRateLimit(`rest:${clientKey(request, token)}`);
  if (!limit.allowed) {
    const err = new AgentContractError("RATE_LIMITED", { requestId });
    return {
      failure: NextResponse.json(err.toFailureEnvelope(), {
        status: err.httpStatus,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      }),
    };
  }
  let db;
  try {
    db = await getSharedDb();
  } catch {
    const err = new AgentContractError("INTERNAL_OPAQUE", { requestId });
    return { failure: NextResponse.json(err.toFailureEnvelope(), { status: err.httpStatus }) };
  }
  try {
    // AF-SEC-00: identity is server-resolved and threaded as the actor so
    // foreign sessions answer not-found without an oracle.
    const userId = await resolveRequestUser(db, token);
    return { db, userId };
  } catch {
    const err = new AgentContractError("UNAUTHENTICATED", { requestId });
    return {
      failure: NextResponse.json(err.toFailureEnvelope(), {
        status: err.httpStatus,
        headers: { "X-Request-Id": requestId },
      }),
    };
  }
}

/**
 * P10-D2 POST /api/v1/replays/{id}/close — close a replay session over
 * the same envelope the replay_close_session MCP tool serves.
 */
export async function POST(request: Request, route: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const resolved = await context(request);
  if ("failure" in resolved) return resolved.failure;
  const { id } = await route.params;
  const result = await closeReplaySessionRoute(
    resolved.db,
    decodeURIComponent(id),
    resolved.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}
