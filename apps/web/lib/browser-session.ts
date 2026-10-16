/**
 * First-party browser API transport. Browser UI uses only the HttpOnly session
 * cookie; agents keep the existing Authorization: Bearer REST/MCP contracts.
 * Never put session credentials in JavaScript, URLs, or browser storage.
 */
export async function sessionRequest(path: string, init: RequestInit = {}): Promise<Response> {
  // Explicitly restrict ambient cookie requests to the same-origin REST API.
  if (!/^\/api\/v1\/[a-z]/.test(path)) {
    throw new Error("Only same-origin Skilit API paths are permitted.");
  }
  const headers = new Headers(init.headers);
  if (headers.has("authorization")) {
    throw new Error("Browser session requests must not send bearer tokens.");
  }
  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  // Reconcile visual session status on an expired/revoked cookie; do not
  // attempt to surface the HttpOnly token to client JavaScript.
  if (response.status === 401 && path !== "/api/v1/auth/session" && typeof window !== "undefined") {
    window.dispatchEvent(new Event("skilit:session-expired"));
  }
  return response;
}
