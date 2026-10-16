import { NextResponse } from "next/server";

import { requestToken, resolveRequestUserFromRequest } from "../../../../../../../lib/session";
import { getSharedDb } from "../../../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../../../lib/rate-limit";
import { clientKey } from "../../../../../../../lib/http";
import { downloadLensArtifactRoute } from "../../../../../../../lib/lens-jobs";
import { AgentContractError, newRequestId } from "../../../../../../../lib/agent-contract";

/**
 * GET /api/v1/lens/jobs/[id]/artifacts?workspaceId=&name= — authorized
 * output download. Names: manifest.json (default), evidence.json.
 * Integrity digest travels in X-Content-Sha256.
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
    const result = await downloadLensArtifactRoute(
      db,
      {
        workspaceId: url.searchParams.get("workspaceId") ?? undefined,
        kitId: id,
        name: url.searchParams.get("name") ?? undefined,
      },
      userId,
      request.headers.get("x-request-id"),
    );
    if (result.file === undefined || result.body !== undefined) {
      const failure = result.body ?? new AgentContractError("INTERNAL_OPAQUE", { requestId }).toFailureEnvelope();
      return NextResponse.json(failure, {
        status: result.status,
        headers: { "X-Request-Id": requestId },
      });
    }
    return new NextResponse(Buffer.from(result.file.bytes), {
      status: 200,
      headers: {
        "Content-Type": result.file.mediaType,
        "Content-Disposition": `attachment; filename="${result.file.filename}"`,
        "X-Content-Sha256": result.file.sha256,
        "X-Request-Id": requestId,
      },
    });
  } catch {
    const err = new AgentContractError("UNAUTHENTICATED", { requestId });
    return NextResponse.json(err.toFailureEnvelope(), {
      status: err.httpStatus,
      headers: { "X-Request-Id": requestId },
    });
  }
}
