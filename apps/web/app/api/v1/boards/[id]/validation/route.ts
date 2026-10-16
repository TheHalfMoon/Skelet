import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../../../lib/session";
import { getSharedDb } from "../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../lib/http";
import { validateBoardItemsRoute } from "../../../../../../lib/boards";
import { AgentContractError, newRequestId } from "../../../../../../lib/agent-contract";

/**
 * GET /api/v1/boards/[id]/validation — per-item validation for handoff
 * inspection (ok/denied/missing with pack-grade metadata). Denied items
 * expose status only; unknown and denied boards answer alike.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
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
    const { id } = await context.params;
    const result = await validateBoardItemsRoute(
      db,
      { boardId: id },
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
