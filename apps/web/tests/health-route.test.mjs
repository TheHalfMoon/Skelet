import assert from "node:assert/strict";
import test from "node:test";

import { buildHealthPayload } from "../app/api/health/payload.ts";

test("health payload satisfies the Skilit web contract", () => {
  const payload = buildHealthPayload();
  assert.equal(payload.status, "ok");
  assert.equal(payload.service, "skilit-web");
  assert.equal(typeof payload.version, "string");
  assert.ok(payload.version.length > 0);
});
