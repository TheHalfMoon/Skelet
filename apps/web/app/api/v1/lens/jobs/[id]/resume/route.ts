import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../../../../lib/mcp";
import { getSharedDb } from "../../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../../lib/http";
import { resumeLensJobRoute } from "../../../../../../../lib/lens-jobs";
import { AgentContractError, newRequestId } from "../../../../../../../lib/agent-contract";

/**
 * POST /api/v1/lens/jobs/[id]/resume?workspaceId= — transfer the worker
 * lease after interruption so work continues from the persisted checkpoint.
 * Optional JSON body { workerId }: an opaque operator label, not auth.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = newRequestId(request.headers.get("x-request-id"));
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
    const userId = await resolveRequestUser(db, token);
    const { id } = await context.params;
    const url = new URL(request.url);
    let workerId: unknown;
    try {
      const parsed: unknown = await request.json();
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        workerId = (parsed as Record<string, unknown>).workerId;
      }
    } catch {
      workerId = undefined;
    }
    const result = await resumeLensJobRoute(
      db,
      {
        workspaceId: url.searchParams.get("workspaceId") ?? undefined,
        kitId: id,
        workerId,
      },
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
