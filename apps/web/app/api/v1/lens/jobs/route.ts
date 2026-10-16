import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../../lib/session";
import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { createLensJobRoute, pollLensJobRoute } from "../../../../../lib/lens-jobs";
import { AgentContractError, newRequestId } from "../../../../../lib/agent-contract";

function requestIdOf(request: Request): string {
  return newRequestId(request.headers.get("x-request-id"));
}

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
 * POST /api/v1/lens/jobs — create a durable Lens Build Kit job.
 * Idempotent on (workspace, idempotencyKey): 201 first, 200 replay.
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
  const result = await createLensJobRoute(
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
 * GET /api/v1/lens/jobs?workspaceId=&kitId= — immediate persisted progress.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const guarded = await guard(request);
  if (!guarded.ok) return guarded.response;
  const params = searchParams(request);
  const result = await pollLensJobRoute(
    guarded.db,
    { workspaceId: params.workspaceId, kitId: params.kitId },
    guarded.userId,
    request.headers.get("x-request-id"),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "X-Request-Id": result.body.request_id },
  });
}
