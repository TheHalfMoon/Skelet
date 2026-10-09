import { NextResponse } from "next/server";

import { bearerToken, dispatchMcp, MCP_MAX_BODY_CHARS } from "../../../lib/mcp";
import { getSharedDb } from "../../../lib/mcp-db";
import { checkRateLimit } from "../../../lib/rate-limit";

function configuredTokens(): string[] {
  const raw = process.env.SKELET_MCP_TOKENS ?? "";
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}

export async function POST(request: Request): Promise<NextResponse> {
  const limit = checkRateLimit(`mcp:${clientKey(request)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Rate limited." } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400 },
    );
  }
  if (text.length > MCP_MAX_BODY_CHARS) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } },
      { status: 413 },
    );
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400 },
    );
  }
  const token = bearerToken(request.headers.get("authorization"));
  let db;
  try {
    db = await getSharedDb();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error." } },
      { status: 500 },
    );
  }
  const response = await dispatchMcp(db, { tokens: configuredTokens(), token }, body);
  if (response === null) {
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(response);
}

export function GET(): NextResponse {
  // SSE streams land in a follow-up grain; JSON POST is the contract now.
  return NextResponse.json(
    { error: "Use POST with a JSON-RPC body. SSE streams are not served yet." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
