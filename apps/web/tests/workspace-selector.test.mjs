import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("server-side workspace discovery is derived only from authenticated membership", () => {
  const session = read("../lib/session.ts");
  assert.match(session, /validateSession\(db, presented\.token\)/);
  assert.match(session, /listWorkspacesForUser\(tx, session\.user\.id\)/);
  assert.match(session, /workspaces: authorized\.map/);
  assert.doesNotMatch(session.slice(session.indexOf("export async function sessionStatusRoute"), session.indexOf("export async function authStatusRoute")), /request\.json\(/);
});

test("both workspaces use a real accessible picker, not editable UUID inputs", () => {
  const picker = read("../components/workspace-selector.tsx");
  for (const view of ["boards", "lens"]) {
    const source = read(`../app/${view}/page.tsx`);
    assert.ok(source.includes(`id="${view}-workspace" value={workspaceId} onChange={setWorkspaceId}`));
    assert.ok(source.includes(`htmlFor="${view}-workspace"`));
    assert.ok(!source.includes(`type="text"\n              autoComplete="off"\n              value={workspaceId}`));
    assert.ok(source.includes("workspaceId.trim() !== \"\""));
  }
  assert.match(picker, /<select/);
  assert.match(picker, /disabled={!selectable}/);
  assert.match(picker, /workspaces\.length === 1/);
  assert.match(picker, /options\.length > 1/);
  assert.match(picker, /aria-describedby/);
  assert.match(picker, /skilit:session-expired/);
  assert.match(picker, /UUID\.test\(id\)/);
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie"]) {
    assert.ok(!picker.includes(forbidden));
  }
});
