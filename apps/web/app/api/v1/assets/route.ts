import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../lib/mcp";
import { getSharedDb } from "../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { searchAssetsRoute } from "../../../../lib/rest";

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
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
    // Identity gate: corpus reads are global, but every call must be
    // attributable to a validated session.
    await resolveRequestUser(db, token);
    const result = await searchAssetsRoute(db, searchParams(request));
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
}
