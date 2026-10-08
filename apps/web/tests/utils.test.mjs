import assert from "node:assert/strict";
import test from "node:test";

import { cn } from "../lib/utils.ts";

test("cn merges class lists and resolves tailwind conflicts", () => {
  assert.equal(cn("px-2", "px-4"), "px-4");
  assert.equal(cn("text-sm", undefined, false, "font-bold"), "text-sm font-bold");
  assert.equal(cn(["p-1", "p-2"]), "p-2");
  assert.equal(cn(), "");
});

test("cn passes through non-conflicting classes untouched", () => {
  assert.equal(cn("flex", "items-center", "gap-2"), "flex items-center gap-2");
});
