import { NextResponse } from "next/server";

import {
  dispatchMcp,
  MCP_MAX_BODY_CHARS,
  MCP_PROTOCOL_VERSIONS,
  negotiateVersion,
} from "../../../lib/mcp";
import {
  requestToken,
  resolveRequestUserFromRequest,
} from "../../../lib/session";
import { getSharedDb } from "../../../lib/mcp-db";
import { checkRateLimit } from "../../../lib/rate-limit";
import { AgentContractError, newRequestId } from "../../../lib/agent-contract";

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}

function unauthorized(): NextResponse {
  const err = new AgentContractError("UNAUTHENTICATED");
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: err.mcpCode, message: err.safeMessage, data: { envelope: err.toFailureEnvelope() } } },
    { status: err.httpStatus },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  // AF-03c: Streamable HTTP version negotiation. Official MCP clients send
  // MCP-Protocol-Version as a header; older Skilit clients send it only in
  // initialize params. Both are accepted; the negotiated version is echoed
  // so independent clients can assert compatibility without forking logic.
  const headerVersion = request.headers.get("mcp-protocol-version");
  const negotiatedHeader = headerVersion === null ? null : negotiateVersion(headerVersion);
  const headerOut: Record<string, string> = {};
  if (negotiatedHeader !== null) {
    headerOut["MCP-Protocol-Version"] = negotiatedHeader;
  } else {
    headerOut["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSIONS[0] ?? "2026-07-28";
  }
  const httpRequestId = request.headers.get("x-request-id");
  if (httpRequestId !== null && httpRequestId.trim().length > 0) {
    headerOut["X-Request-Id"] = newRequestId(httpRequestId);
  }
  const limit = checkRateLimit(`mcp:${clientKey(request)}`);
  if (!limit.allowed) {
    const err = new AgentContractError("RATE_LIMITED");
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: err.mcpCode, message: err.safeMessage, data: { envelope: err.toFailureEnvelope() } } },
      { status: err.httpStatus, headers: { "Retry-After": String(limit.retryAfterSeconds), ...headerOut } },
    );
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400, headers: headerOut },
    );
  }
  if (text.length > MCP_MAX_BODY_CHARS) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } },
      { status: 413, headers: headerOut },
    );
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
      { status: 400, headers: headerOut },
    );
  }
  const presented = requestToken(request);
  if (presented.token === null) {
    const unauthorizedBody = unauthorized();
    for (const [key, value] of Object.entries(headerOut)) {
      unauthorizedBody.headers.set(key, value);
    }
    return unauthorizedBody;
  }
  let db;
  try {
    db = await getSharedDb();
  } catch {
    const err = new AgentContractError("INTERNAL_OPAQUE");
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: err.mcpCode, message: err.safeMessage, data: { envelope: err.toFailureEnvelope() } } },
      { status: err.httpStatus, headers: headerOut },
    );
  }
  // The presented credential (Bearer or session cookie) IS a Skilit
  // session token: the actor identity is server-resolved here, never taken
  // from client arguments. Cookie callers additionally pass the origin
  // check inside resolveRequestUserFromRequest. Token issuance upgrades
  // (OAuth metadata, PKCE) land in a later P08 grain.
  try {
    const userId = await resolveRequestUserFromRequest(db, request);
    const response = await dispatchMcp(db, { userId }, body);
    if (response === null) {
      return new NextResponse(null, { status: 202, headers: headerOut });
    }
    return NextResponse.json(response, { headers: headerOut });
  } catch {
    const unauthorizedBody = unauthorized();
    for (const [key, value] of Object.entries(headerOut)) {
      unauthorizedBody.headers.set(key, value);
    }
    return unauthorizedBody;
  }
}

export function GET(): NextResponse {
  // SSE streams land in a follow-up grain; JSON POST is the contract now.
  return NextResponse.json(
    { error: "Use POST with a JSON-RPC body. SSE streams are not served yet." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
