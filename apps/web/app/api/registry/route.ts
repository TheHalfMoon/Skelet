import { NextResponse } from "next/server";

import { buildRegistryIndex } from "../../../lib/registry";
import { searchRegistryRoute } from "../../../lib/rest";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  // AF-13b-i: bare GET keeps the legacy full-index response byte-identical;
  // any q/limit parameter selects the versioned envelope search path with
  // MCP deep-equal parity.
  if (!url.searchParams.has("q") && !url.searchParams.has("limit")) {
    return NextResponse.json(buildRegistryIndex());
  }
  const query: Record<string, string | undefined> = {};
  const q = url.searchParams.get("q");
  const limit = url.searchParams.get("limit");
  if (q !== null) query.q = q;
  if (limit !== null) query.limit = limit;
  const outcome = await searchRegistryRoute(query);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
