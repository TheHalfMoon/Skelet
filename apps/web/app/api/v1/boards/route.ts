import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../lib/session";
import { getSharedDb } from "../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { clientKey } from "../../../../lib/http";
import { createBoardRoute, listBoardsRoute } from "../../../../lib/boards";
import { AgentContractError, newRequestId } from "../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

async function guard(request: Request): Promise<
  | { ok: true; db: Awaited<ReturnType<typeof getSharedDb>>; userId: string }
  | { ok: false; response: NextResponse }
> {
  const requestId = requestIdOf(request);
  const token = requestToken(request).token;
  const limit = checkRateLimit(`rest:${clientKey(request, token)}`);
  if (!limit.allowed) {
    const err = new AgentContractError("RATE_LIMITED", { requestId });
    return {
      ok: false,
      response: NextResponse.json(err.toFailureEnvelope(), {
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
    return { ok: false, response: NextResponse.json(err.toFailureEnvelope(), { status: err.httpStatus }) };
  }
  try {
    const userId = await resolveRequestUserFromRequest(db, request);
    return { ok: true, db, userId };
  } catch {
    const err = new AgentContractError("UNAUTHENTICATED", { requestId });
    return {
      ok: false,
      response: NextResponse.json(err.toFailureEnvelope(), {
        status: err.httpStatus,
        headers: { "X-Request-Id": requestId },
      }),
    };
  }
}

/**
 * POST /api/v1/boards — create a reference board in a workspace.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const guarded = await guard(request);
  if (!guarded.ok) return guarded.response;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await createBoardRoute(
    guarded.db,
    body,
    guarded.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}

/**
 * GET /api/v1/boards?workspaceId= — list boards visible to the caller.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const guarded = await guard(request);
  if (!guarded.ok) return guarded.response;
  const url = new URL(request.url);
  const result = await listBoardsRoute(
    guarded.db,
    { workspaceId: url.searchParams.get("workspaceId") ?? undefined },
    guarded.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}
