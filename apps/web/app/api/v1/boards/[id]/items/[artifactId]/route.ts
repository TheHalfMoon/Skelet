import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../../../../lib/session";
import { getSharedDb } from "../../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../../lib/http";
import { removeBoardItemRoute } from "../../../../../../../lib/boards";
import { AgentContractError, newRequestId } from "../../../../../../../lib/agent-contract";

/**
 * DELETE /api/v1/boards/[id]/items/[artifactId]? — remove one item.
 * Repeat removal succeeds with gaps closed.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; artifactId: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId(request.headers.get("x-request-id"));
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
    const userId = await resolveRequestUserFromRequest(db, request);
    const { id, artifactId } = await context.params;
    const result = await removeBoardItemRoute(
      db,
      { boardId: id, artifactId },
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
