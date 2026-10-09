import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../../lib/mcp";
import { getSharedDb } from "../../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../../lib/rate-limit";
import { clientKey } from "../../../../../lib/http";
import { getAssetRoute } from "../../../../../lib/rest";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = bearerToken(request.headers.get("authorization"));
  const limit = checkRateLimit(`rest:${clientKey(request, token)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }
  let db;
  try {
    db = await getSharedDb();
  } catch {
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
  try {
    await resolveRequestUser(db, token);
    const { id } = await context.params;
    const result = await getAssetRoute(db, id);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
}
