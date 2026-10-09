import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const registryIndex = require("../registry/registry.json") as RegistryIndexFile;
const buttonItem = require("../registry/skelet-button.json") as RegistryItem;
const cardItem = require("../registry/skelet-card.json") as RegistryItem;

export interface RegistryIndexEntry {
  name: string;
  type: string;
  title: string;
  description: string;
}

export interface RegistryIndex {
  name: string;
  version: string;
  items: RegistryIndexEntry[];
}

export interface RegistryFile {
  path: string;
  type: string;
  content: string;
}

export interface RegistryItem {
  name: string;
  type: string;
  title: string;
  description: string;
  dependencies: string[];
  devDependencies: string[];
  registryDependencies: string[];
  files: RegistryFile[];
}

interface RegistryIndexFile {
  name?: unknown;
  version?: unknown;
  items?: unknown;
}

const ITEMS: Record<string, RegistryItem> = {
  "skelet-button": buttonItem,
  "skelet-card": cardItem,
};

function lookupItem(name: string): RegistryItem | undefined {
  // hasOwn, not truthiness: __proto__/constructor must fail closed
  // to not-found instead of reaching the prototype chain.
  if (!Object.hasOwn(ITEMS, name)) return undefined;
  return ITEMS[name];
}

export class RegistryError extends Error {
  readonly code: "registry/not-found" | "registry/invalid";
  constructor(code: RegistryError["code"], message: string) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateItemShape(item: unknown): asserts item is RegistryItem {
  if (!isRecord(item)) {
    throw new RegistryError("registry/invalid", "Registry item is invalid.");
  }
  for (const field of ["name", "type", "title", "description"] as const) {
    if (typeof item[field] !== "string" || (item[field] as string).length === 0) {
      throw new RegistryError("registry/invalid", `Registry item ${field} is invalid.`);
    }
  }
  for (const list of ["dependencies", "devDependencies", "registryDependencies"] as const) {
    const values = item[list];
    if (
      !Array.isArray(values) ||
      values.some((entry) => typeof entry !== "string" || entry.length === 0)
    ) {
      throw new RegistryError("registry/invalid", `Registry item ${list} is invalid.`);
    }
  }
  if (!Array.isArray(item.files) || item.files.length === 0) {
    throw new RegistryError("registry/invalid", "Registry item files are invalid.");
  }
  for (const file of item.files as unknown[]) {
    if (
      !isRecord(file) ||
      typeof file.path !== "string" ||
      !/^components\/[A-Za-z0-9][A-Za-z0-9/_.-]*\.tsx$/.test(file.path) ||
      file.path.includes("..") ||
      file.type !== "registry:ui" ||
      typeof file.content !== "string" ||
      file.content.length === 0
    ) {
      throw new RegistryError("registry/invalid", "Registry item file is invalid.");
    }
  }
}

export function buildRegistryIndex(): RegistryIndex {
  if (
    !isRecord(registryIndex) ||
    typeof registryIndex.name !== "string" ||
    typeof registryIndex.version !== "string" ||
    !Array.isArray(registryIndex.items)
  ) {
    throw new RegistryError("registry/invalid", "Registry index is invalid.");
  }
  const items: RegistryIndexEntry[] = registryIndex.items.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.type !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.description !== "string"
    ) {
      throw new RegistryError("registry/invalid", "Registry index entry is invalid.");
    }
    if (lookupItem(entry.name) === undefined) {
      throw new RegistryError("registry/invalid", `Registry item missing: ${entry.name}.`);
    }
    return {
      name: entry.name,
      type: entry.type,
      title: entry.title,
      description: entry.description,
    };
  });
  return { name: registryIndex.name, version: registryIndex.version, items };
}

export function buildRegistryItem(name: string): RegistryItem {
  const item = lookupItem(name);
  if (item === undefined) {
    throw new RegistryError("registry/not-found", "Registry item was not found.");
  }
  validateItemShape(item);
  return item;
}
