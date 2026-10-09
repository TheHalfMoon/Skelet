import { NextResponse } from "next/server";

import { openDatabase } from "../../../../../packages/db/src/db.ts";
import { bearerToken, dispatchMcp } from "../../../lib/mcp";

function configuredTokens(): string[] {
  const raw = process.env.SKELET_MCP_TOKENS ?? "";
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400 },
    );
  }
  const token = bearerToken(request.headers.get("authorization"));
  const db = await openDatabase(
    process.env.SKELET_MCP_DATABASE_URL === undefined
      ? undefined
      : { connectionString: process.env.SKELET_MCP_DATABASE_URL },
  );
  try {
    const response = await dispatchMcp(db, { tokens: configuredTokens(), token }, body);
    if (response === null) {
      return new NextResponse(null, { status: 202 });
    }
    return NextResponse.json(response);
  } finally {
    await db.close();
  }
}

export function GET(): NextResponse {
  // SSE streams land in a follow-up grain; JSON POST is the contract now.
  return NextResponse.json(
    { error: "Use POST with a JSON-RPC body. SSE streams are not served yet." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
