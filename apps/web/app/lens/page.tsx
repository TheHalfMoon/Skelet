"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LensJobView {
  uri: string;
  kitId: string;
  analysisId: string;
  status: string;
  revision: number;
  attempt: number;
  maxAttempts: number;
  pipelineStep: number;
  pipelineTotal: number;
  errorClass: string | null;
  purged: boolean;
  expiresAt: string;
}

interface LensJobDetail extends LensJobView {
  scope: Record<string, unknown>;
  sourceUrl: string;
  resultEvidence: Record<string, unknown>;
  artifactSummary: { entries: Array<{ path: string; sha256: string; bytes: number }>; withheld: string[] };
  attemptHistory: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

interface AgentFailure {
  code: string;
  message: string;
}

const TERMINAL = new Set(["completed", "partial", "failed", "canceled"]);

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asJobView(value: unknown): LensJobView | null {
  const record = asRecord(value);
  if (record === null) return null;
  if (
    typeof record.uri !== "string" ||
    typeof record.kitId !== "string" ||
    typeof record.status !== "string" ||
    typeof record.revision !== "number"
  ) {
    return null;
  }
  return record as unknown as LensJobView;
}

function asJobDetail(value: unknown): LensJobDetail | null {
  const view = asJobView(value);
  if (view === null) return null;
  const record = asRecord(value);
  if (record === null) return null;
  if (typeof record.sourceUrl !== "string") return null;
  return { ...(view as LensJobView), ...(record as unknown as LensJobDetail) };
}

export default function LensJobsPage() {
  const [token, setToken] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("https://example.org/");
  const [mode, setMode] = useState("single-page");
  const [idempotencyKey, setIdempotencyKey] = useState(() => `ui-lens-${randomKey()}`);
  const [kitId, setKitId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [job, setJob] = useState<LensJobDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<AgentFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const watchTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const authHeaders = useCallback((): Record<string, string> => {
    return { Authorization: `Bearer ${token.trim()}` };
  }, [token]);

  function readFailure(payload: unknown, fallback: string): AgentFailure {
    const record = asRecord(payload);
    const error = record === null ? null : asRecord(record.error);
    if (error !== null && typeof error.code === "string" && typeof error.message === "string") {
      return { code: error.code, message: error.message };
    }
    return { code: "UNKNOWN", message: fallback };
  }

  const stopWatching = useCallback(() => {
    if (watchTimer.current !== null) {
      clearInterval(watchTimer.current);
      watchTimer.current = null;
    }
    setWatching(false);
  }, []);

  useEffect(() => {
    return () => {
      if (watchTimer.current !== null) clearInterval(watchTimer.current);
    };
  }, []);

  async function callJson(
    label: string,
    path: string,
    init: RequestInit,
    onJob: (detail: LensJobDetail | null, view: LensJobView | null) => void,
  ): Promise<void> {
    setBusy(label);
    setFailure(null);
    setNotice(null);
    try {
      const response = await fetch(path, init);
      const payload: unknown = await response.json();
      if (!response.ok) {
        setFailure(readFailure(payload, `${label} failed with HTTP ${response.status}.`));
        return;
      }
      const result = asRecord(asRecord(payload)?.result);
      const detail = result === null ? null : asJobDetail(result.job);
      const view = result === null ? null : asJobView(result.job);
      if (view === null && detail === null) {
        setFailure({ code: "UNKNOWN", message: `${label} returned an unrecognized job shape.` });
        return;
      }
      onJob(detail, view);
    } catch {
      setFailure({ code: "UNKNOWN", message: `${label} could not reach the server.` });
    } finally {
      setBusy(null);
    }
  }

  async function createJob(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const body = {
      workspaceId: workspaceId.trim(),
      sourceUrl: sourceUrl.trim(),
      mode,
      maxPages: 1,
      maxDepth: 0,
      maxBytes: 1048576,
      timeBudgetMs: 60000,
      idempotencyKey: idempotencyKey.trim(),
    };
    await callJson("Create", "/api/v1/lens/jobs", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, (detail, view) => {
      if (view !== null) {
        setKitId(view.kitId);
        setNotice(`Job ${view.uri} is ${view.status}.`);
      }
      if (detail !== null) setJob(detail);
      else if (view !== null) void refreshDetail(view.kitId);
    });
  }

  async function refreshDetail(targetKitId?: string): Promise<void> {
    const id = (targetKitId ?? kitId).trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a job ID before inspecting." });
      return;
    }
    await callJson("Inspect", `/api/v1/lens/jobs/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId.trim())}`, {
      headers: authHeaders(),
    }, (detail) => {
      if (detail !== null) {
        setJob(detail);
        setKitId(detail.kitId);
      }
    });
  }

  async function pollStatus(): Promise<void> {
    const id = kitId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a job ID before polling." });
      return;
    }
    await callJson("Poll", `/api/v1/lens/jobs?workspaceId=${encodeURIComponent(workspaceId.trim())}&kitId=${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    }, (_detail, view) => {
      if (view !== null && job !== null) {
        setJob({ ...job, status: view.status, revision: view.revision, attempt: view.attempt, purged: view.purged, expiresAt: view.expiresAt, errorClass: view.errorClass });
      } else if (view !== null) {
        void refreshDetail(view.kitId);
      }
    });
  }

  async function mutate(label: string, action: string, withWorker: boolean): Promise<void> {
    const id = kitId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: `Enter a job ID before ${action}.` });
      return;
    }
    const init: RequestInit = { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" } };
    if (withWorker && workerId.trim() !== "") init.body = JSON.stringify({ workerId: workerId.trim() });
    await callJson(label, `/api/v1/lens/jobs/${encodeURIComponent(id)}/${action}?workspaceId=${encodeURIComponent(workspaceId.trim())}`, init, (detail, view) => {
      if (view !== null) setNotice(`${label} applied: ${view.status} (revision ${view.revision}).`);
      if (detail !== null) setJob(detail);
      else void refreshDetail(id);
    });
  }

  async function watchUntilTerminal(): Promise<void> {
    const id = kitId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a job ID before watching." });
      return;
    }
    stopWatching();
    setWatching(true);
    setFailure(null);
    const deadline = Date.now() + 60000;
    watchTimer.current = setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/v1/lens/jobs?workspaceId=${encodeURIComponent(workspaceId.trim())}&kitId=${encodeURIComponent(id)}`,
            { headers: authHeaders() },
          );
          const payload: unknown = await response.json();
          if (!response.ok) {
            setFailure(readFailure(payload, `Watch failed with HTTP ${response.status}.`));
            stopWatching();
            return;
          }
          const view = asJobView(asRecord(asRecord(payload)?.result)?.job);
          if (view === null) {
            setFailure({ code: "UNKNOWN", message: "Watch returned an unrecognized job shape." });
            stopWatching();
            return;
          }
          if (TERMINAL.has(view.status)) {
            stopWatching();
            setNotice(`Job reached terminal state ${view.status}.`);
            await refreshDetail(view.kitId);
          } else if (Date.now() > deadline) {
            stopWatching();
            setNotice(`Watch timed out while job is ${view.status}; poll again later.`);
            await refreshDetail(view.kitId);
          }
        } catch {
          stopWatching();
          setFailure({ code: "UNKNOWN", message: "Watch could not reach the server." });
        }
      })();
    }, 2000);
  }

  async function downloadArtifact(name: string): Promise<void> {
    const id = kitId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a job ID before downloading." });
      return;
    }
    setBusy(`Download ${name}`);
    setFailure(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/v1/lens/jobs/${encodeURIComponent(id)}/artifacts?workspaceId=${encodeURIComponent(workspaceId.trim())}&name=${encodeURIComponent(name)}`,
        { headers: authHeaders() },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setFailure(readFailure(payload, `Download failed with HTTP ${response.status}.`));
        return;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = response.headers.get("X-Content-Sha256") ?? "";
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `lens-${id.slice(0, 12)}-${name}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${name} (${bytes.length} bytes${digest === "" ? "" : `, sha256 ${digest.slice(0, 16)}…`}).`);
    } catch {
      setFailure({ code: "UNKNOWN", message: "Download could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  const canAct = token.trim() !== "" && workspaceId.trim() !== "" && busy === null;

  return (
    <main style={{ maxWidth: 880, margin: "48px auto", padding: "0 20px" }}>
      <h1>Lens Build Kit jobs</h1>
      <p>
        Create, poll, inspect, download, cancel, retry, and resume the same durable Lens jobs served over REST
        and MCP, addressed by the stable <code>skelet://lens/{"{id}"}</code> identifier.
      </p>

      <section aria-label="Credentials">
        <h2>1. Credentials</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="lens-token">Session bearer token</label>
            <input
              id="lens-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token from sign-in"
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label htmlFor="lens-workspace">Workspace ID</label>
            <input
              id="lens-workspace"
              type="text"
              autoComplete="off"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="00000000-0000-4000-8000-000000000000"
              style={{ width: "100%" }}
            />
          </div>
        </form>
      </section>

      <section aria-label="Create job">
        <h2>2. Create job</h2>
        <form onSubmit={(e) => void createJob(e)}>
          <div>
            <label htmlFor="lens-url">Source URL (public https)</label>
            <input id="lens-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div>
            <label htmlFor="lens-mode">Capture mode</label>
            <select id="lens-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="single-page">single-page</option>
              <option value="selected-pages">selected-pages</option>
              <option value="bounded-sitemap">bounded-sitemap</option>
            </select>
          </div>
          <div>
            <label htmlFor="lens-key">Idempotency key</label>
            <input id="lens-key" type="text" autoComplete="off" value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} style={{ width: "100%" }} />
          </div>
          <button type="submit" disabled={!canAct}>Create job</button>
        </form>
      </section>

      <section aria-label="Track job">
        <h2>3. Track job</h2>
        <div>
          <label htmlFor="lens-kit">Job ID (64-hex kit ID)</label>
          <input id="lens-kit" type="text" autoComplete="off" value={kitId} onChange={(e) => setKitId(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div>
          <label htmlFor="lens-worker">Worker label (resume only, optional)</label>
          <input id="lens-worker" type="text" autoComplete="off" value={workerId} onChange={(e) => setWorkerId(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={!canAct} onClick={() => void pollStatus()}>Poll status</button>
          <button type="button" disabled={!canAct} onClick={() => void refreshDetail()}>Inspect</button>
          <button type="button" disabled={!canAct || watching} onClick={() => void watchUntilTerminal()}>
            {watching ? "Watching…" : "Watch until terminal"}
          </button>
          {watching ? <button type="button" onClick={stopWatching}>Stop watch</button> : null}
          <button type="button" disabled={!canAct} onClick={() => void mutate("Cancel", "cancel", false)}>Cancel</button>
          <button type="button" disabled={!canAct} onClick={() => void mutate("Retry", "retry", false)}>Retry</button>
          <button type="button" disabled={!canAct} onClick={() => void mutate("Resume", "resume", true)}>Resume</button>
          <button type="button" disabled={!canAct} onClick={() => void downloadArtifact("manifest.json")}>Download manifest</button>
          <button type="button" disabled={!canAct} onClick={() => void downloadArtifact("evidence.json")}>Download evidence</button>
        </div>
      </section>

      <section aria-label="Job state" aria-live="polite">
        <h2>4. Job state</h2>
        {busy !== null ? <p>Working: {busy}…</p> : null}
        {failure !== null ? <p role="alert">Error {failure.code}: {failure.message}</p> : null}
        {notice !== null ? <p>{notice}</p> : null}
        {job === null ? (
          <p>No job inspected yet. Create a job above, or enter a job ID and choose Inspect.</p>
        ) : (
          <div>
            <p><strong>URI:</strong> <code>{job.uri}</code></p>
            <p><strong>Status:</strong> {job.status} (revision {job.revision}, attempt {job.attempt}/{job.maxAttempts})</p>
            <p><strong>Pipeline:</strong> step {job.pipelineStep}/{job.pipelineTotal}{job.errorClass === null ? "" : `, error ${job.errorClass}`}{job.purged ? ", purged" : ""}</p>
            <p><strong>Source:</strong> {job.sourceUrl} · <strong>Expires:</strong> {job.expiresAt}</p>
            <h3>Scope</h3>
            <pre>{JSON.stringify(job.scope, null, 2)}</pre>
            <h3>Evidence</h3>
            <pre>{JSON.stringify(job.resultEvidence, null, 2)}</pre>
            <h3>Artifacts</h3>
            {job.artifactSummary.entries.length === 0 && job.artifactSummary.withheld.length === 0 ? (
              <p>No downloadable artifacts yet. Withheld or unknown-rights files are never served.</p>
            ) : (
              <ul>
                {job.artifactSummary.entries.map((entry) => (
                  <li key={entry.path}>{entry.path} · {entry.bytes} bytes · sha256 {entry.sha256.slice(0, 16)}…</li>
                ))}
                {job.artifactSummary.withheld.map((name) => (
                  <li key={`withheld-${name}`}>Withheld: {name} (not downloadable)</li>
                ))}
              </ul>
            )}
            <p>Attempt history entries: {job.attemptHistory.length} · Created {job.createdAt}{job.finishedAt === null ? "" : ` · Finished ${job.finishedAt}`}</p>
          </div>
        )}
      </section>
    </main>
  );
}
