/**
 * AF-03c stdio MCP bridge: independent transport for interop proof.
 *
 * Reads line-delimited JSON-RPC requests from stdin, dispatches through the
 * same canonical dispatchMcp + PGlite fixture as the HTTP server, and writes
 * one JSON line per response to stdout. Notifications (requests without IDs)
 * produce no output, per JSON-RPC 2.0.
 *
 * Identity model: stdio binds to an explicitly chosen local profile (the
 * fixture owner). There is no bearer token on this transport; the OS
 * process boundary is the authority. A second fixture outsider owns private
 * objects the stdio identity must be denied, proving the same actor gate
 * applies on a transport without HTTP auth headers.
 *
 * Startup: prints one JSON line to stdout on readiness:
 * {"artifactId":"...","restrictedId":"...","privateId":"...","workspaceId":"...",
 *  "pageIds":[...],"ownerId":"...","outsiderId":"..."}
 * Subsequent lines are responses. Sending {"method":"__shutdown__"} or EOF
 * ends the bridge.
 */

import readline from "node:readline";

import { openDatabase } from "../packages/db/src/db.ts";
import { migrateUp } from "../packages/db/src/migrate.ts";
import { createSource } from "../packages/db/src/repositories.ts";
import { createArtifact } from "../packages/db/src/graph.ts";
import { signUp } from "../packages/db/src/auth.ts";
import { addMember, createWorkspace } from "../packages/db/src/workspaces.ts";
import { registerAsset } from "../packages/assets/src/registry.ts";
import { dispatchMcp } from "../apps/web/lib/mcp.ts";

async function buildFixture() {
  const db = await openDatabase();
  await migrateUp(db);
  const owner = await signUp(db, { email: "stdio-owner@skelet.example", password: "stdio-password-01" });
  const outsider = await signUp(db, { email: "stdio-outsider@skelet.example", password: "stdio-password-01" });
  const member = await signUp(db, { email: "stdio-member@skelet.example", password: "stdio-password-01" });
  const source = await createSource(db, { key: "stdio-source", kind: "synthetic" });
  const space = await createWorkspace(db, { name: "Stdio space", ownerId: owner.id });
  await addMember(db, { workspaceId: space.workspace.id, userId: member.id, role: "member", actorId: owner.id });
  const arrow = await registerAsset(db, {
    kind: "icon",
    title: "Stdio arrow",
    sourceId: source.id,
    contentHash: "d".repeat(64),
    rightsClassification: "permitted",
    metadata: { collection: "iconify:mdi", ref: "arrow", tags: ["stdio-arrow"], license: "MIT" },
    asset: { sha256: "d".repeat(64), mediaType: "image/svg+xml", byteLength: 64, storageKey: "sha256/st/arrow" },
  });
  const pageIds = [];
  for (let index = 0; index < 3; index += 1) {
    const page = await registerAsset(db, {
      kind: "icon",
      title: `Stdio page icon ${index}`,
      sourceId: source.id,
      contentHash: `${index + 5}`.repeat(64).slice(0, 64),
      rightsClassification: "permitted",
      metadata: { collection: "stdio", ref: `page-${index}`, tags: ["stdio-page"], license: "MIT" },
      asset: {
        sha256: `${index + 5}`.repeat(64).slice(0, 64),
        mediaType: "image/svg+xml",
        byteLength: 64,
        storageKey: `sha256/st/page-${index}`,
      },
    });
    pageIds.push(page.artifactId);
  }
  const restricted = await createArtifact(db, {
    sourceId: source.id,
    kind: "screen",
    title: "Stdio restricted screen",
    contentHash: "e".repeat(64),
    rightsClassification: "restricted",
    visibility: "workspace",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  const priv = await createArtifact(db, {
    sourceId: source.id,
    kind: "screen",
    title: "Stdio private screen",
    contentHash: "f".repeat(64),
    rightsClassification: "metadata_only",
    visibility: "private",
    workspaceId: space.workspace.id,
    ownerSubject: owner.id,
  });
  const outsiderSource = await createSource(db, { key: "stdio-outsider-source", kind: "synthetic" });
  const outsiderSpace = await createWorkspace(db, { name: "Stdio outsider space", ownerId: outsider.id });
  const outsiderPrivate = await createArtifact(db, {
    sourceId: outsiderSource.id,
    kind: "screen",
    title: "Stdio outsider private",
    contentHash: "9".repeat(64),
    rightsClassification: "metadata_only",
    visibility: "private",
    workspaceId: outsiderSpace.workspace.id,
    ownerSubject: outsider.id,
  });
  return {
    db,
    owner,
    outsider,
    workspaceId: space.workspace.id,
    artifactId: arrow.artifactId,
    pageIds,
    restrictedId: restricted.id,
    privateId: priv.id,
    outsiderPrivateId: outsiderPrivate.id,
  };
}

async function main() {
  const fx = await buildFixture();
  const ctx = { userId: fx.owner.id };
  console.log(JSON.stringify({
    artifactId: fx.artifactId,
    pageIds: fx.pageIds,
    restrictedId: fx.restrictedId,
    privateId: fx.privateId,
    outsiderPrivateId: fx.outsiderPrivateId,
    workspaceId: fx.workspaceId,
    ownerId: fx.owner.id,
    outsiderId: fx.outsider.id,
  }));
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let request = null;
    try {
      request = JSON.parse(trimmed);
    } catch {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } }));
      continue;
    }
    if (request !== null && typeof request === "object" && request.method === "__shutdown__") {
      break;
    }
    try {
      const response = await dispatchMcp(fx.db, ctx, request);
      if (response !== null) {
        console.log(JSON.stringify(response));
      }
    } catch {
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request?.id ?? null, error: { code: -32000, message: "Request failed." } }));
    }
  }
  try {
    await fx.db.close();
  } catch {
    // Best effort during test teardown.
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
