/**
 * AF-03c interop test server: real PGlite-backed MCP + REST over HTTP.
 *
 * Spins an in-memory Skilit database with a fixed interop fixture, then
 * serves the same dispatch paths as the Next.js routes (dispatchMcp for
 * POST /mcp, searchAssetsRoute/getAssetRoute/getObjectRoute for REST).
 * Used by the Node fetch client test and the Python urllib client test so
 * both stacks prove wire compatibility against one real implementation.
 *
 * Protocol: prints one JSON line to stdout on readiness:
 * {"port":N,"baseUrl":"http://127.0.0.1:N","ownerToken":"...","outsiderToken":"...",
 *  "memberToken":"...","workspaceId":"...","artifactId":"...","restrictedId":"...",
 *  "privateId":"...","pageIds":[...]}
 * Then serves until SIGTERM/SIGINT. No auth bypass: every MCP and REST call
 * requires a validated bearer session token, exactly like production.
 */

import http from "node:http";
import { URL } from "node:url";

import { openDatabase } from "../packages/db/src/db.ts";
import { migrateUp } from "../packages/db/src/migrate.ts";
import { createSource } from "../packages/db/src/repositories.ts";
import { createArtifact } from "../packages/db/src/graph.ts";
import { signIn, signUp } from "../packages/db/src/auth.ts";
import { addMember, createWorkspace } from "../packages/db/src/workspaces.ts";
import { registerAsset } from "../packages/assets/src/registry.ts";
import { bearerToken, dispatchMcp, MCP_PROTOCOL_VERSIONS, negotiateVersion, resolveRequestUser } from "../apps/web/lib/mcp.ts";
import { getAssetRoute, getObjectRoute, searchAssetsRoute } from "../apps/web/lib/rest.ts";
import { AgentContractError } from "../apps/web/lib/agent-contract.ts";

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...extraHeaders });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > 512 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}

async function buildFixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "interop-owner@skilit.example", password: "interop-password-01" });
  const outsider = await signUp(db, { email: "interop-outsider@skilit.example", password: "interop-password-01" });
  const member = await signUp(db, { email: "interop-member@skilit.example", password: "interop-password-01" });
  const ownerSession = await signIn(db, { email: "interop-owner@skilit.example", password: "interop-password-01" });
  const outsiderSession = await signIn(db, { email: "interop-outsider@skilit.example", password: "interop-password-01" });
  const memberSession = await signIn(db, { email: "interop-member@skilit.example", password: "interop-password-01" });
  const source = await createSource(db, { key: "interop-source", kind: "synthetic" });
  const space = await createWorkspace(db, { name: "Interop space", ownerId: owner.id });
  await addMember(db, { workspaceId: space.workspace.id, userId: member.id, role: "member", actorId: owner.id });
  const arrow = await registerAsset(db, {
    kind: "icon",
    title: "Interop arrow",
    sourceId: source.id,
    contentHash: "a".repeat(64),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "arrow", tags: ["interop-arrow"], license: "MIT" },
    asset: { sha256: "a".repeat(64), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/in/arrow" },
  });
  const pageIds = [];
  for (let index = 0; index < 3; index += 1) {
    const page = await registerAsset(db, {
      kind: "icon",
      title: `Interop page icon ${index}`,
      sourceId: source.id,
      contentHash: `${index + 2}`.repeat(64).slice(0, 64),
      rightsClassification: "permitted",
      metadata: { collection: "interop", ref: `page-${index}`, tags: ["interop-page"], license: "MIT" },
      asset: {
        sha256: `${index + 2}`.repeat(64).slice(0, 64),
        mediaType: "image/svg+xml",
        byteLength: 64,
        storageKey: `sha256/in/page-${index}`,
      },
    });
    pageIds.push(page.artifactId);
  }
  const restricted = await createArtifact(db, {
    sourceId: source.id,
    kind: "screen",
    title: "Interop restricted screen",
    contentHash: "b".repeat(64),
    rightsClassification: "restricted",
    visibility: "workspace",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  const priv = await createArtifact(db, {
    sourceId: source.id,
    kind: "screen",
    title: "Interop private screen",
    contentHash: "c".repeat(64),
    rightsClassification: "metadata_only",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  return {
    db,
    owner,
    outsider,
    member,
    ownerToken: ownerSession.token,
    outsiderToken: outsiderSession.token,
    memberToken: memberSession.token,
    workspaceId: space.workspace.id,
    artifactId: arrow.artifactId,
    pageIds,
    restrictedId: restricted.id,
    privateId: priv.id,
  };
}

async function main() {
  const fx = await buildFixture();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "POST" && url.pathname === "/mcp") {
        const headerVersion = req.headers["mcp-protocol-version"];
        const negotiated = negotiateVersion(typeof headerVersion === "string" ? headerVersion : undefined);
        const extra = { "MCP-Protocol-Version": negotiated ?? MCP_PROTOCOL_VERSIONS[0] };
        const httpRequestId = req.headers["x-request-id"];
        if (typeof httpRequestId === "string" && httpRequestId.trim().length > 0) {
          extra["X-Request-Id"] = httpRequestId.slice(0, 128);
        }
        const token = bearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : null);
        if (token === null) {
          const err = new AgentContractError("UNAUTHENTICATED");
          sendJson(res, err.httpStatus, { jsonrpc: "2.0", id: null, error: { code: err.mcpCode, message: err.safeMessage, data: { envelope: err.toFailureEnvelope() } } }, extra);
          return;
        }
        let userId;
        try {
          userId = await resolveRequestUser(fx.db, token);
        } catch {
          const err = new AgentContractError("UNAUTHENTICATED");
          sendJson(res, err.httpStatus, { jsonrpc: "2.0", id: null, error: { code: err.mcpCode, message: err.safeMessage, data: { envelope: err.toFailureEnvelope() } } }, extra);
          return;
        }
        let text;
        try {
          text = await readBody(req);
        } catch {
          sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, extra);
          return;
        }
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          sendJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }, extra);
          return;
        }
        const response = await dispatchMcp(fx.db, { userId }, body);
        if (response === null) {
          res.writeHead(202, extra);
          res.end();
          return;
        }
        sendJson(res, 200, response, extra);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/v1/assets") {
        const token = bearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : null);
        let userId;
        try {
          userId = await resolveRequestUser(fx.db, token);
        } catch {
          const err = new AgentContractError("UNAUTHENTICATED", { requestId: undefined });
          sendJson(res, err.httpStatus, err.toFailureEnvelope(), { "X-Request-Id": err.toFailureEnvelope().request_id });
          return;
        }
        const query = {};
        url.searchParams.forEach((value, key) => {
          if (query[key] === undefined) query[key] = value;
        });
        const result = await searchAssetsRoute(fx.db, query, userId, req.headers["x-request-id"] ?? undefined);
        sendJson(res, result.status, result.body, { "X-Request-Id": result.body.request_id });
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/v1/assets/")) {
        const token = bearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : null);
        let userId;
        try {
          userId = await resolveRequestUser(fx.db, token);
        } catch {
          const err = new AgentContractError("UNAUTHENTICATED", { requestId: undefined });
          sendJson(res, err.httpStatus, err.toFailureEnvelope(), { "X-Request-Id": err.toFailureEnvelope().request_id });
          return;
        }
        const id = decodeURIComponent(url.pathname.slice("/api/v1/assets/".length));
        const result = await getAssetRoute(fx.db, id, userId, req.headers["x-request-id"] ?? undefined);
        sendJson(res, result.status, result.body, { "X-Request-Id": result.body.request_id });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/v1/objects") {
        const token = bearerToken(typeof req.headers.authorization === "string" ? req.headers.authorization : null);
        let userId;
        try {
          userId = await resolveRequestUser(fx.db, token);
        } catch {
          const err = new AgentContractError("UNAUTHENTICATED", { requestId: undefined });
          sendJson(res, err.httpStatus, err.toFailureEnvelope(), { "X-Request-Id": err.toFailureEnvelope().request_id });
          return;
        }
        const result = await getObjectRoute(fx.db, url.searchParams.get("uri") ?? undefined, userId, req.headers["x-request-id"] ?? undefined);
        sendJson(res, result.status, result.body, { "X-Request-Id": result.body.request_id });
        return;
      }
      sendJson(res, 404, { error: "Not found." });
    } catch {
      sendJson(res, 500, { error: "Request failed." });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  console.log(JSON.stringify({
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    ownerToken: fx.ownerToken,
    outsiderToken: fx.outsiderToken,
    memberToken: fx.memberToken,
    ownerId: fx.owner.id,
    workspaceId: fx.workspaceId,
    artifactId: fx.artifactId,
    pageIds: fx.pageIds,
    restrictedId: fx.restrictedId,
    privateId: fx.privateId,
  }));
  const shutdown = async () => {
    server.close();
    try {
      await fx.db.close();
    } catch {
      // Best effort during test teardown.
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
