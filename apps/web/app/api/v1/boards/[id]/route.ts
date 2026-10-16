import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../../lib/session";
import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { deleteBoardRoute, getBoardRoute, updateBoardRoute } from "../../../../../lib/boards";
import { AgentContractError, newRequestId } from "../../../../../lib/agent-contract";

/**
 * GET /api/v1/boards/[id] — one board with items in board order.
 * PATCH /api/v1/boards/[id] — rename and/or visibility.
 * DELETE /api/v1/boards/[id] — delete the board and its items.
 */
async function guard(request: Request): Promise<
  | { ok: true; db: Awaited<ReturnType<typeof getSharedDb>>; userId: string; requestId: string }
  | { ok: false; response: NextResponse }
> {
  const requestId = newRequestId(request.headers.get("x-request-id"));
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
    return { ok: true, db, userId, requestId };
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

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarded = await guard(request);
  if (!guarded.ok) return guarded.response;
  const { id } = await context.params;
  const result = await getBoardRoute(
    guarded.db,
    { boardId: id },
    guarded.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarded = await guard(request);
  if (!guarded.ok) return guarded.response;
  const { id } = await context.params;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await updateBoardRoute(
    guarded.db,
    id,
    body,
    guarded.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const guarded = await guard(request);
  if (!guarded.ok) return guarded.response;
  const { id } = await context.params;
  const result = await deleteBoardRoute(
    guarded.db,
    id,
    guarded.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}
