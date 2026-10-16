import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const LOGIN = new URL("../app/login/page.tsx", import.meta.url);
const SIGNUP = new URL("../app/signup/page.tsx", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("login UI signs in over the session cookie without token persistence", async () => {
  const text = await source(LOGIN);
  assert.ok(text.includes("/api/v1/auth/signin"), "UI posts to the sign-in route");
  assert.ok(text.includes("/api/v1/auth/session"), "UI recovers expiry via the session route");
  assert.ok(text.includes("/api/v1/auth/signout"), "UI offers explicit sign-out");
  assert.ok(text.includes("/api/v1/auth/status"), "UI adapts to bootstrap state");
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie"]) {
    assert.ok(!text.includes(forbidden), `UI must not persist tokens via ${forbidden}`);
  }
  assert.ok(!/Bearer [A-Za-z0-9._-]{8,}/.test(text.replace("Bearer ${token.trim()}", "")), "UI carries no hardcoded credential");
  assert.ok(text.includes("HttpOnly"), "UI states the cookie security property");
});

test("login UI shows loading, empty, failure, and signed-in states accessibly", async () => {
  const text = await source(LOGIN);
  for (const marker of ["Working…", "No active session", "Signed in as", "Sign out"]) {
    assert.ok(text.includes(marker), `UI exposes ${marker}`);
  }
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes("aria-live"), "UI exposes state changes to assistive tech");
  for (const tag of ["<form", "<label", "<input", "<button"]) {
    assert.ok(text.includes(tag), `UI uses native ${tag}`);
  }
  assert.ok(text.includes('htmlFor="login-email"'), "UI labels its email field");
  assert.ok(text.includes('htmlFor="login-password"'), "UI labels its password field");
  assert.ok(text.includes('"use client"'), "UI is a client component over the REST routes");
});

test("signup UI offers bootstrap-only owner creation without token persistence", async () => {
  const text = await source(SIGNUP);
  assert.ok(text.includes("/api/v1/auth/signup"), "UI posts to the signup route");
  assert.ok(text.includes("exactly once"), "UI states the bootstrap-only policy");
  assert.ok(text.includes('href="/login"'), "UI routes initialized installations to sign-in");
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie"]) {
    assert.ok(!text.includes(forbidden), `UI must not persist tokens via ${forbidden}`);
  }
  assert.ok(text.includes('role="alert"'), "UI announces failures assertively");
  assert.ok(text.includes('htmlFor="signup-email"'), "UI labels its email field");
  assert.ok(text.includes('htmlFor="signup-password"'), "UI labels its password field");
});
