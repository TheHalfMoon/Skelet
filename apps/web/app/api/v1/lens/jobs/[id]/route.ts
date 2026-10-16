import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../../../lib/session";
import { getSharedDb } from "../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../lib/http";
import { getLensJobRoute } from "../../../../../../lib/lens-jobs";
import { AgentContractError, newRequestId } from "../../../../../../lib/agent-contract";

/**
 * GET /api/v1/lens/jobs/[id]?workspaceId= — full persisted run inspection
 * (evidence, artifact summary, history) for workspace members.
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
    const url = new URL(request.url);
    const result = await getLensJobRoute(
      db,
      { workspaceId: url.searchParams.get("workspaceId") ?? undefined, kitId: id },
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
