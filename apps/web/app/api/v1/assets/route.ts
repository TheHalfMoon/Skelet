import { NextResponse } from "next/server";

import { bearerToken, resolveRequestUser } from "../../../../lib/mcp";
import { getSharedDb } from "../../../../lib/mcp-db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { clientKey } from "../../../../lib/http";
import { searchAssetsRoute } from "../../../../lib/rest";

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
    // Identity gate: corpus reads are global, but every call must be
    // attributable to a validated session.
    await resolveRequestUser(db, token);
    const result = await searchAssetsRoute(db, searchParams(request));
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
}
