"use client";

import { useState } from "react";

interface PatternView {
  uri: string;
  title: string;
  artifactCount: number;
}

interface PatternLinkView {
  uri: string;
  kind: string;
  title: string;
  relation: string;
}

interface AgentFailure {
  code: string;
  message: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asPatterns(value: unknown): PatternView[] | null {
  const record = asRecord(value);
  const patterns = record === null ? null : record.patterns;
  if (!Array.isArray(patterns)) return null;
  const out: PatternView[] = [];
  for (const entry of patterns) {
    const item = asRecord(entry);
    if (
      item === null ||
      typeof item.uri !== "string" ||
      typeof item.title !== "string" ||
      typeof item.artifactCount !== "number"
    ) {
      return null;
    }
    out.push(item as unknown as PatternView);
  }
  return out;
}

function asDetail(value: unknown): { title: string; description: string | null; links: PatternLinkView[] } | null {
  const record = asRecord(value);
  if (record === null) return null;
  const pattern = asRecord(record.pattern);
  const links = record.links;
  if (pattern === null || typeof pattern.title !== "string" || !Array.isArray(links)) return null;
  const out: PatternLinkView[] = [];
  for (const entry of links) {
    const item = asRecord(entry);
    if (
      item === null ||
      typeof item.uri !== "string" ||
      typeof item.kind !== "string" ||
      typeof item.title !== "string" ||
      typeof item.relation !== "string"
    ) {
      return null;
    }
    out.push(item as unknown as PatternLinkView);
  }
  const description = pattern.description;
  return {
    title: pattern.title as string,
    description: description === null || description === undefined ? null : String(description),
    links: out,
  };
}

function cursorOf(payload: unknown): string | null {
  const record = asRecord(payload);
  if (record === null) return null;
  const cursor = record.cursor;
  return typeof cursor === "string" && cursor !== "" ? cursor : null;
}

function slugOf(uri: string): string {
  return uri.replace("skilit://pattern/", "");
}

export default function PatternsPage() {
  const [token, setToken] = useState("");
  const [query, setQuery] = useState("");
  const [slug, setSlug] = useState("");
  const [patterns, setPatterns] = useState<PatternView[] | null>(null);
  const [patternsCursor, setPatternsCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ title: string; description: string | null; links: PatternLinkView[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<AgentFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${token.trim()}` };
  }

  function readFailure(payload: unknown, fallback: string): AgentFailure {
    const record = asRecord(payload);
    const error = record === null ? null : asRecord(record.error);
    if (error !== null && typeof error.code === "string" && typeof error.message === "string") {
      return { code: error.code, message: error.message };
    }
    return { code: "UNKNOWN", message: fallback };
  }

  async function callJson(
    label: string,
    path: string,
    init: RequestInit,
    onOk: (result: Record<string, unknown>, payload: Record<string, unknown>) => void,
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
      const record = asRecord(payload);
      const result = record === null ? null : asRecord(record.result);
      if (result === null || record === null) {
        setFailure({ code: "UNKNOWN", message: `${label} returned an unrecognized shape.` });
        return;
      }
      onOk(result, record);
    } catch {
      setFailure({ code: "UNKNOWN", message: `${label} could not reach the server.` });
    } finally {
      setBusy(null);
    }
  }

  async function listPatterns(cursor?: string): Promise<void> {
    if (token.trim() === "") {
      setFailure({ code: "UNKNOWN", message: "Enter an access token before listing." });
      return;
    }
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (query.trim() !== "") params.set("query", query.trim());
    if (cursor !== undefined && cursor !== "") params.set("cursor", cursor);
    await callJson("List patterns", `/api/v1/patterns?${params.toString()}`, {
      headers: authHeaders(),
    }, (result, payload) => {
      const list = asPatterns(result);
      if (list === null) {
        setFailure({ code: "UNKNOWN", message: "List patterns returned an unrecognized shape." });
        return;
      }
      setPatterns((previous) => (cursor === undefined ? list : [...(previous ?? []), ...list]));
      setPatternsCursor(cursorOf(payload));
      setNotice(`Listed ${list.length} pattern(s).`);
    });
  }

  async function inspectPattern(target?: string): Promise<void> {
    const value = (target ?? slug).trim();
    if (value === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a pattern slug before inspecting." });
      return;
    }
    if (token.trim() === "") {
      setFailure({ code: "UNKNOWN", message: "Enter an access token before inspecting." });
      return;
    }
    await callJson("Inspect pattern", `/api/v1/patterns/${encodeURIComponent(slugOf(value))}`, {
      headers: authHeaders(),
    }, (result) => {
      const parsed = asDetail(result);
      if (parsed === null) {
        setFailure({ code: "UNKNOWN", message: "Inspect pattern returned an unrecognized shape." });
        return;
      }
      setSlug(slugOf(value));
      setDetail(parsed);
      setNotice(`Listed ${parsed.links.length} link(s) for pattern ${slugOf(value)}.`);
    });
  }

  return (
    <main>
      <h1>Pattern taxonomy</h1>
      <p>
        Actor-scoped taxonomy over canonical pattern identities with
        artifact and flow relationships. Patterns without readable linked
        artifacts read as empty; unknown slugs read as not found.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void listPatterns();
        }}
      >
        <label htmlFor="patterns-token">Access token</label>
        <input
          id="patterns-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <label htmlFor="patterns-query">Filter taxonomy</label>
        <input
          id="patterns-query"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit">List patterns</button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setDetail(null);
          void inspectPattern();
        }}
      >
        <label htmlFor="patterns-slug">Pattern slug</label>
        <input
          id="patterns-slug"
          type="text"
          autoComplete="off"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
        <button type="submit">Inspect pattern</button>
      </form>
      <div aria-live="polite">
        {busy !== null ? <p>Working: {busy}.</p> : null}
        {notice !== null ? <p>{notice}</p> : null}
      </div>
      {failure !== null ? (
        <p role="alert">
          {failure.code}: {failure.message}
        </p>
      ) : null}
      <section aria-label="Patterns">
        <h2>Patterns</h2>
        {patterns === null ? <p>No patterns listed yet.</p> : null}
        {patterns !== null && patterns.length === 0 ? <p>No patterns in this scope.</p> : null}
        <ol>
          {(patterns ?? []).map((pattern) => (
            <li key={pattern.uri}>
              <span>
                {pattern.title} (artifacts {pattern.artifactCount})
              </span>{" "}
              <span>{pattern.uri}</span>{" "}
              <button type="button" onClick={() => void inspectPattern(slugOf(pattern.uri))}>
                Inspect pattern
              </button>
            </li>
          ))}
        </ol>
        {patternsCursor !== null ? (
          <button type="button" onClick={() => void listPatterns(patternsCursor)}>
            More patterns
          </button>
        ) : null}
      </section>
      <section aria-label="Pattern detail">
        <h2>Pattern detail</h2>
        {detail === null ? <p>No pattern inspected yet.</p> : null}
        {detail !== null && detail.links.length === 0 ? <p>No links in this pattern.</p> : null}
        {detail !== null ? (
          <article aria-label={detail.title}>
            <p>{detail.title}</p>
            <p>{detail.description ?? "No description recorded."}</p>
            <ul>
              {detail.links.map((link) => (
                <li key={`${link.relation}-${link.uri}`}>
                  <span>
                    {link.relation}: {link.title} ({link.kind})
                  </span>{" "}
                  <span>{link.uri}</span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}
      </section>
      <p>
        Provenance: observed taxonomy reads with reproducible slug order;
        capture-time recording stays with the flow player and the rrweb
        replay surface.
      </p>
    </main>
  );
}
