import type { DbClient } from "../../../packages/db/src/db.ts";
import { validateSession } from "../../../packages/db/src/auth.ts";
import { getArtifact } from "../../../packages/db/src/graph.ts";
import { saveReference } from "../../../packages/db/src/collections.ts";
import { searchAssets, resolveAsset } from "../../../packages/assets/src/registry.ts";
import { buildRegistryItem } from "./registry.ts";
import {
  createReferencePack,
  exportReferencePack,
  parseSkeletUri,
} from "./reference-packs.ts";

/**
 * G08-01 remote agent transport: MCP Streamable HTTP (JSON-RPC 2.0) with
 * a first read-only tool set over the canonical asset corpus.
 *
 * Protocol posture: version negotiation across known revisions, JSON
 * responses to POST (single and batch), explicit 405 on GET/SSE streams
 * until streaming lands in a follow-up grain. Every tool call requires
 * a bearer token; token issuance (OAuth metadata, audience binding,
 * PKCE) arrives in a later P08 grain — this layer only verifies
 * caller-supplied tokens against server configuration.
 */

export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"];
export const MCP_SERVER_NAME = "skelet";
export const MCP_SERVER_VERSION = "0.1.0";
export const MCP_MAX_BATCH = 32;
export const MCP_MAX_BODY_CHARS = 256 * 1024;

export interface McpContext {
  /**
   * Server-resolved caller identity (Skelet user ID), bound by the route
   * from a validated session token. Null only in tests exercising denial;
   * the route never dispatches tools without an identity.
   */
  userId: string | null;
}

interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function negotiateVersion(requested: unknown): string | null {
  if (typeof requested !== "string") return MCP_PROTOCOL_VERSIONS[0] ?? null;
  if (MCP_PROTOCOL_VERSIONS.includes(requested)) return requested;
  return MCP_PROTOCOL_VERSIONS[0] ?? null;
}

function requireUser(ctx: McpContext): string {
  if (ctx.userId === null) {
    throw { code: -32001, message: "Unauthorized." };
  }
  return ctx.userId;
}

function toolSchemas(): unknown[] {
  return [
    {
      name: "search_assets",
      description: "Search Skelet icons, logos, and fonts with rights metadata.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          kinds: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    {
      name: "get_asset",
      description: "Resolve one asset record with provenance and serving policy.",
      inputSchema: {
        type: "object",
        properties: { artifactId: { type: "string" } },
        required: ["artifactId"],
      },
    },
    {
      name: "get_registry_item",
      description: "Fetch a shadcn-compatible registry item document.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    {
      name: "save_reference",
      description: "Save a canonical artifact into a workspace collection as the calling user.",
      inputSchema: {
        type: "object",
        properties: {
          collectionId: { type: "string" },
          artifactId: { type: "string" },
        },
        required: ["collectionId", "artifactId"],
      },
    },
    {
      name: "create_reference_pack",
      description: "Create a reference pack (collection plus versioned export) from evidence as the calling user.",
      inputSchema: {
        type: "object",
        properties: {
          workspaceId: { type: "string" },
          title: { type: "string" },
          artifactIds: { type: "array", items: { type: "string" } },
          visibility: { type: "string" },
        },
        required: ["workspaceId", "title"],
      },
    },
    {
      name: "get_object",
      description: "Retrieve a canonical object by Skelet URI (skelet://artifact/{id}, skelet://collection/{id}).",
      inputSchema: {
        type: "object",
        properties: { uri: { type: "string" } },
        required: ["uri"],
      },
    },
  ];
}

function toAgentAsset(record: {
  artifactId: string;
  kind: string;
  title: string;
  license: string;
  rightsClassification: string;
  serving: string;
  servingReason: string;
  sourceKey: string;
  contentHash: string;
}): Record<string, unknown> {
  // Canonical stable URI scheme per the agent platform contract.
  return {
    uri: `skelet://artifact/${record.artifactId}`,
    kind: record.kind,
    title: record.title,
    license: record.license,
    rights: record.rightsClassification,
    serving: record.serving,
    servingReason: record.servingReason,
    source: record.sourceKey,
    contentHash: record.contentHash,
  };
}

const REGISTRY_KINDS = ["icon", "logo", "font"] as const;

async function callTool(
  db: DbClient,
  ctx: McpContext,
  name: unknown,
  args: unknown,
): Promise<unknown> {
  if (typeof name !== "string") {
    throw { code: -32602, message: "Tool name is invalid." };
  }
  const params = isRecord(args) ? args : {};
  if (name === "search_assets") {
    if (typeof params.query !== "string") {
      throw { code: -32602, message: "search_assets.query is invalid." };
    }
    const search: {
      query: string;
      kinds?: ("icon" | "logo" | "font")[];
      limit?: number;
    } = { query: params.query };
    if (params.kinds !== undefined) {
      if (
        !Array.isArray(params.kinds) ||
        params.kinds.some((kind) => !(REGISTRY_KINDS as readonly string[]).includes(kind))
      ) {
        throw { code: -32602, message: "search_assets.kinds is invalid." };
      }
      search.kinds = params.kinds as ("icon" | "logo" | "font")[];
    }
    if (params.limit !== undefined) {
      const limit = params.limit;
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 50) {
        throw { code: -32602, message: "search_assets.limit is invalid." };
      }
      search.limit = limit as number;
    }
    const records = await searchAssets(db, search);
    return { assets: records.map(toAgentAsset) };
  }
  if (name === "get_asset") {
    if (typeof params.artifactId !== "string") {
      throw { code: -32602, message: "get_asset.artifactId is invalid." };
    }
    return { asset: toAgentAsset(await resolveAsset(db, params.artifactId)) };
  }
  if (name === "get_registry_item") {
    if (typeof params.name !== "string") {
      throw { code: -32602, message: "get_registry_item.name is invalid." };
    }
    return { item: buildRegistryItem(params.name) };
  }
  if (name === "save_reference") {
    if (typeof params.collectionId !== "string" || typeof params.artifactId !== "string") {
      throw { code: -32602, message: "save_reference arguments are invalid." };
    }
    const actorId = requireUser(ctx);
    try {
      await saveReference(db, {
        collectionId: params.collectionId,
        artifactId: params.artifactId,
        actorId,
      });
    } catch {
      throw { code: -32000, message: "Tool execution failed." };
    }
    return { saved: true, uri: `skelet://artifact/${params.artifactId}` };
  }
  if (name === "create_reference_pack") {
    if (typeof params.workspaceId !== "string" || typeof params.title !== "string") {
      throw { code: -32602, message: "create_reference_pack arguments are invalid." };
    }
    if (params.visibility !== undefined && params.visibility !== "private" && params.visibility !== "workspace") {
      throw { code: -32602, message: "create_reference_pack.visibility is invalid." };
    }
    if (
      params.artifactIds !== undefined &&
      (!Array.isArray(params.artifactIds) ||
        params.artifactIds.some((entry) => typeof entry !== "string"))
    ) {
      throw { code: -32602, message: "create_reference_pack.artifactIds is invalid." };
    }
    const actorId = requireUser(ctx);
    const packInput = {
      workspaceId: params.workspaceId as string,
      title: params.title as string,
      actorId,
    } as {
      workspaceId: string;
      title: string;
      actorId: string;
      visibility?: "private" | "workspace";
      artifactIds?: string[];
    };
    if (params.visibility !== undefined) {
      packInput.visibility = params.visibility as "private" | "workspace";
    }
    if (params.artifactIds !== undefined) {
      packInput.artifactIds = params.artifactIds as string[];
    }
    try {
      const pack = await createReferencePack(db, packInput);
      const exported = await exportReferencePack(db, pack.collectionId, actorId);
      return { pack: exported };
    } catch {
      throw { code: -32000, message: "Tool execution failed." };
    }
  }
  if (name === "get_object") {
    if (typeof params.uri !== "string") {
      throw { code: -32602, message: "get_object.uri is invalid." };
    }
    try {
      const parsed = parseSkeletUri(params.uri);
      if (parsed.type === "artifact") {
        const artifact = await getArtifact(db, parsed.id);
        if (artifact === null) {
          throw { code: -32000, message: "Tool execution failed." };
        }
        return {
          object: {
            uri: params.uri,
            kind: artifact.kind,
            title: artifact.title,
            rights: artifact.rightsClassification,
          },
        };
      }
      const actorId = requireUser(ctx);
      try {
        return { pack: await exportReferencePack(db, parsed.id, actorId) };
      } catch {
        throw { code: -32000, message: "Tool execution failed." };
      }
    } catch (thrown) {
      if (isRecord(thrown) && typeof thrown.code === "number") throw thrown;
      if (thrown instanceof Error && thrown.name === "PackError") {
        if ((thrown as { code?: unknown }).code === "packs/invalid") {
          throw { code: -32602, message: "get_object.uri is invalid." };
        }
        throw { code: -32000, message: "Tool execution failed." };
      }
      throw thrown;
    }
  }
  throw { code: -32601, message: "Tool not found." };
}

async function handleOne(
  db: DbClient,
  ctx: McpContext,
  request: unknown,
): Promise<JsonRpcResponse | null> {
  if (!isRecord(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return error(
      isRecord(request) ? (request as { id?: unknown }).id : null,
      -32600,
      "Invalid request.",
    );
  }
  const { id, method } = request as { id: unknown; method: string };
  // Notifications (valid requests without IDs) receive no response.
  if (id === undefined) return null;
  const params = (request as { params?: unknown }).params;
  if (method === "initialize") {
    const version = negotiateVersion(
      isRecord(params) ? (params as { protocolVersion?: unknown }).protocolVersion : undefined,
    );
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: version,
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        capabilities: { tools: {} },
      },
    };
  }
  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/list" || method === "tools/call") {
    try {
      requireUser(ctx);
    } catch (denied) {
      if (isRecord(denied) && typeof denied.code === "number") {
        return error(id, denied.code, "Unauthorized.");
      }
      return error(id, -32001, "Unauthorized.");
    }
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: toolSchemas() } };
  }
  if (method === "tools/call") {
    if (!isRecord(params)) {
      return error(id, -32602, "Invalid params.");
    }
    try {
      const output = await callTool(
        db,
        ctx,
        (params as { name?: unknown }).name,
        (params as { arguments?: unknown }).arguments,
      );
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output) }] } };
    } catch (thrown) {
      // callTool throws JSON-RPC-shaped objects with static messages.
      // Domain failures stay opaque: messages never reach callers.
      if (isRecord(thrown) && typeof thrown.code === "number" && typeof thrown.message === "string") {
        return error(id, thrown.code, thrown.message);
      }
      return error(id, -32000, "Tool execution failed.");
    }
  }
  return error(id, -32601, "Method not found.");
}

/**
 * Dispatch one JSON-RPC request or batch. Notifications without IDs
 * produce no responses, per JSON-RPC 2.0.
 */
export async function dispatchMcp(
  db: DbClient,
  ctx: McpContext,
  body: unknown,
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0 || body.length > MCP_MAX_BATCH) {
      return error(null, -32600, "Invalid request.");
    }
    const responses: JsonRpcResponse[] = [];
    for (const entry of body) {
      const response = await handleOne(db, ctx, entry);
      if (response !== null) responses.push(response);
    }
    // Notification-only batches produce no responses.
    if (responses.length === 0) return null;
    return responses;
  }
  return handleOne(db, ctx, body);
}

export function bearerToken(header: string | null): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = (match[1] ?? "").trim();
  return token.length > 0 ? token : null;
}

/**
 * Bind a presented bearer token to a server-resolved user identity via
 * the session store. Invalid, expired, or revoked sessions throw; the
 * route maps every failure to an opaque 401.
 */
export async function resolveRequestUser(
  db: DbClient,
  token: string | null,
): Promise<string> {
  if (token === null) {
    throw new Error("Missing bearer token.");
  }
  const session = await validateSession(db, token);
  return session.user.id;
}
