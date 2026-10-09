import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../lib/mcp";
import { getSharedDb } from "../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { getObjectRoute } from "../../../../lib/rest";

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}

export async function GET(request: Request): Promise<NextResponse> {
  const limit = checkRateLimit(`rest:${clientKey(request)}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Rate limited." }, { status: 429 });
  }
  const token = bearerToken(request.headers.get("authorization"));
  let db;
  try {
    db = await getSharedDb();
  } catch {
    return NextResponse.json({ error: "Internal error." }, { status: 500 });
  }
  try {
    const userId = await resolveRequestUser(db, token);
    const url = new URL(request.url);
    const result = await getObjectRoute(db, url.searchParams.get("uri") ?? undefined, userId);
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
}
