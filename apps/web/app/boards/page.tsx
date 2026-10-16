"use client";

import { SessionAccessBanner } from "../../components/session-access-banner";
import { sessionRequest } from "../../lib/browser-session";

import { useState } from "react";

interface BoardView {
  uri: string;
  id: string;
  workspaceId: string;
  title: string;
  visibility: string;
}

interface ItemView {
  uri: string;
  artifactId: string;
  position: number;
  savedAt: string;
}

interface HandoffView {
  id: string;
  boardUri: string;
  fromSubject: string;
  toSubject: string;
  actorId: string;
  createdAt: string;
}

interface ValidationView {
  uri: string;
  artifactId: string;
  status: string;
  kind?: string;
  title?: string;
  rights?: string;
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

function asBoards(value: unknown): BoardView[] | null {
  const record = asRecord(value);
  const boards = record === null ? null : record.boards;
  if (!Array.isArray(boards)) return null;
  const out: BoardView[] = [];
  for (const entry of boards) {
    const item = asRecord(entry);
    if (item === null || typeof item.id !== "string" || typeof item.title !== "string") return null;
    out.push(item as unknown as BoardView);
  }
  return out;
}

function asBoard(value: unknown): BoardView | null {
  const record = asRecord(value);
  const board = record === null ? null : asRecord(record.board);
  if (board === null || typeof board.id !== "string") return null;
  return board as unknown as BoardView;
}

function asItems(value: unknown): ItemView[] | null {
  const record = asRecord(value);
  const items = record === null ? null : record.items;
  if (!Array.isArray(items)) return null;
  const out: ItemView[] = [];
  for (const entry of items) {
    const item = asRecord(entry);
    if (item === null || typeof item.artifactId !== "string" || typeof item.position !== "number") return null;
    out.push(item as unknown as ItemView);
  }
  return out;
}

function asHandoffs(value: unknown): HandoffView[] | null {
  const record = asRecord(value);
  const handoffs = record === null ? null : record.handoffs;
  if (!Array.isArray(handoffs)) return null;
  const out: HandoffView[] = [];
  for (const entry of handoffs) {
    const item = asRecord(entry);
    if (item === null || typeof item.id !== "string" || typeof item.toSubject !== "string") return null;
    out.push(item as unknown as HandoffView);
  }
  return out;
}

function asValidation(value: unknown): { items: ValidationView[]; summary: unknown } | null {
  const record = asRecord(value);
  const items = record === null ? null : record.items;
  const summary = record === null ? null : record.summary;
  if (!Array.isArray(items) || summary === null || typeof summary !== "object") return null;
  const out: ValidationView[] = [];
  for (const entry of items) {
    const item = asRecord(entry);
    if (item === null || typeof item.artifactId !== "string" || typeof item.status !== "string") return null;
    out.push(item as unknown as ValidationView);
  }
  return { items: out, summary };
}

export default function BoardsPage() {
    const [workspaceId, setWorkspaceId] = useState("");
  const [title, setTitle] = useState("Moodboard");
  const [boardId, setBoardId] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [toPosition, setToPosition] = useState("0");
  const [toSubjectId, setToSubjectId] = useState("");
  const [boards, setBoards] = useState<BoardView[] | null>(null);
  const [items, setItems] = useState<ItemView[] | null>(null);
  const [handoffs, setHandoffs] = useState<HandoffView[] | null>(null);
  const [validation, setValidation] = useState<{ items: ValidationView[]; summary: unknown } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<AgentFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    onOk: (payload: Record<string, unknown>) => void,
  ): Promise<void> {
    setBusy(label);
    setFailure(null);
    setNotice(null);
    try {
      const response = await sessionRequest(path, init);
      const payload: unknown = await response.json();
      if (!response.ok) {
        setFailure(readFailure(payload, `${label} failed with HTTP ${response.status}.`));
        return;
      }
      const record = asRecord(payload);
      const result = record === null ? null : asRecord(record.result);
      if (result === null) {
        setFailure({ code: "UNKNOWN", message: `${label} returned an unrecognized shape.` });
        return;
      }
      onOk(result);
    } catch {
      setFailure({ code: "UNKNOWN", message: `${label} could not reach the server.` });
    } finally {
      setBusy(null);
    }
  }

  async function refreshBoards(): Promise<void> {
    if (workspaceId.trim() === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a workspace ID before listing." });
      return;
    }
    await callJson("List", `/api/v1/boards?workspaceId=${encodeURIComponent(workspaceId.trim())}`, {}, (result) => {
      const list = asBoards(result);
      if (list === null) {
        setFailure({ code: "UNKNOWN", message: "List returned an unrecognized shape." });
        return;
      }
      setBoards(list);
      setNotice(`Listed ${list.length} board(s).`);
    });
  }

  async function createBoard(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await callJson("Create", "/api/v1/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspaceId.trim(), title: title.trim(), visibility: "workspace" }),
    }, (result) => {
      const board = asBoard(result);
      if (board === null) {
        setFailure({ code: "UNKNOWN", message: "Create returned an unrecognized shape." });
        return;
      }
      setBoardId(board.id);
      setItems([]);
      setNotice(`Board ${board.uri} created.`);
      void refreshBoards();
    });
  }

  async function inspectBoard(target?: string): Promise<void> {
    const id = (target ?? boardId).trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before inspecting." });
      return;
    }
    await callJson("Inspect", `/api/v1/boards/${encodeURIComponent(id)}`, {}, (result) => {
      const board = asBoard(result);
      const list = asItems(result);
      if (board === null || list === null) {
        setFailure({ code: "UNKNOWN", message: "Inspect returned an unrecognized shape." });
        return;
      }
      setBoardId(board.id);
      setItems(list);
    });
  }

  async function saveItem(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const id = boardId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before saving." });
      return;
    }
    await callJson("Save", `/api/v1/boards/${encodeURIComponent(id)}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspaceId.trim(), artifactId: artifactId.trim() }),
    }, (result) => {
      const list = asItems(result);
      if (list === null) {
        setFailure({ code: "UNKNOWN", message: "Save returned an unrecognized shape." });
        return;
      }
      setItems(list);
      setNotice(`Saved at rank ${list.length - 1}.`);
    });
  }

  async function moveItem(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const id = boardId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before moving." });
      return;
    }
    await callJson("Move", `/api/v1/boards/${encodeURIComponent(id)}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspaceId.trim(),
        artifactId: artifactId.trim(),
        toPosition: Number(toPosition),
      }),
    }, (result) => {
      const list = asItems(result);
      if (list === null) {
        setFailure({ code: "UNKNOWN", message: "Move returned an unrecognized shape." });
        return;
      }
      setItems(list);
      setNotice(`Moved to rank ${toPosition}.`);
    });
  }

  async function removeItem(target: string): Promise<void> {
    const id = boardId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before removing." });
      return;
    }
    await callJson("Remove", `/api/v1/boards/${encodeURIComponent(id)}/items/${encodeURIComponent(target)}`, {
      method: "DELETE",
    }, (result) => {
      const list = asItems(result);
      if (list === null) {
        setFailure({ code: "UNKNOWN", message: "Remove returned an unrecognized shape." });
        return;
      }
      setItems(list);
      setNotice("Removed; ranks closed.");
    });
  }

  async function deleteBoard(): Promise<void> {
    const id = boardId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before deleting." });
      return;
    }
    await callJson("Delete", `/api/v1/boards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }, () => {
      setBoardId("");
      setItems(null);
      setHandoffs(null);
      setValidation(null);
      setNotice("Board deleted.");
      void refreshBoards();
    });
  }

  async function handOffBoard(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const id = boardId.trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before handing off." });
      return;
    }
    if (toSubjectId.trim() === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a recipient subject ID before handing off." });
      return;
    }
    await callJson("Handoff", `/api/v1/boards/${encodeURIComponent(id)}/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: workspaceId.trim(), toSubjectId: toSubjectId.trim() }),
    }, (result) => {
      const board = asBoard(result);
      const chain = asHandoffs({ handoffs: (result.handoff === undefined ? [] : [result.handoff]) });
      if (board === null) {
        setFailure({ code: "UNKNOWN", message: "Handoff returned an unrecognized shape." });
        return;
      }
      setBoardId(board.id);
      if (chain !== null) setHandoffs(chain);
      setNotice(`Board handed off to ${toSubjectId.trim()}.`);
      void refreshHandoffs(board.id);
      void refreshValidation(board.id);
    });
  }

  async function refreshHandoffs(target?: string): Promise<void> {
    const id = (target ?? boardId).trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before listing handoffs." });
      return;
    }
    await callJson("Handoffs", `/api/v1/boards/${encodeURIComponent(id)}/handoffs`, {}, (result) => {
      const chain = asHandoffs(result);
      if (chain === null) {
        setFailure({ code: "UNKNOWN", message: "Handoffs returned an unrecognized shape." });
        return;
      }
      setHandoffs(chain);
      setNotice(`Listed ${chain.length} handoff(s).`);
    });
  }

  async function refreshValidation(target?: string): Promise<void> {
    const id = (target ?? boardId).trim();
    if (id === "") {
      setFailure({ code: "UNKNOWN", message: "Enter a board ID before validating." });
      return;
    }
    await callJson("Validate", `/api/v1/boards/${encodeURIComponent(id)}/validation`, {}, (result) => {
      const parsed = asValidation(result);
      if (parsed === null) {
        setFailure({ code: "UNKNOWN", message: "Validation returned an unrecognized shape." });
        return;
      }
      setValidation(parsed);
      setNotice(`Validated ${parsed.items.length} item(s).`);
    });
  }

  const canAct = workspaceId.trim() !== "" && busy === null;

  return (
    <main style={{ maxWidth: 880, margin: "48px auto", padding: "0 20px" }}>
      <h1>Reference boards</h1>
      <p>
        List, create, inspect, curate, reorder, and delete boards backed by
        the ordered collections domain. Every board is addressed by its
        stable <code>skilit://collection/{"{id}"}</code> identifier.
      </p>
      <SessionAccessBanner />

      <section aria-label="Workspace settings">
        <h2>1. Workspace</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="boards-workspace">Workspace ID</label>
            <input
              id="boards-workspace"
              type="text"
              autoComplete="off"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              placeholder="00000000-0000-4000-8000-000000000000"
              style={{ width: "100%" }}
            />
          </div>
          <button type="button" disabled={!canAct} onClick={() => void refreshBoards()}>List boards</button>
        </form>
      </section>

      <section aria-label="Create board">
        <h2>2. Create board</h2>
        <form onSubmit={(e) => void createBoard(e)}>
          <div>
            <label htmlFor="boards-title">Title</label>
            <input id="boards-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
          </div>
          <button type="submit" disabled={!canAct}>Create board</button>
        </form>
      </section>

      <section aria-label="Curate board">
        <h2>3. Curate board</h2>
        <div>
          <label htmlFor="boards-id">Board ID</label>
          <input id="boards-id" type="text" autoComplete="off" value={boardId} onChange={(e) => setBoardId(e.target.value)} style={{ width: "100%" }} />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={!canAct} onClick={() => void inspectBoard()}>Inspect</button>
          <button type="button" disabled={!canAct} onClick={() => void deleteBoard()}>Delete</button>
        </div>
        <form onSubmit={(e) => void saveItem(e)}>
          <div>
            <label htmlFor="boards-artifact">Artifact ID to save</label>
            <input id="boards-artifact" type="text" autoComplete="off" value={artifactId} onChange={(e) => setArtifactId(e.target.value)} style={{ width: "100%" }} />
          </div>
          <button type="submit" disabled={!canAct}>Save item</button>
        </form>
        <form onSubmit={(e) => void moveItem(e)}>
          <div>
            <label htmlFor="boards-rank">Move selected artifact to rank</label>
            <input id="boards-rank" type="number" min={0} value={toPosition} onChange={(e) => setToPosition(e.target.value)} />
          </div>
          <button type="submit" disabled={!canAct}>Move item</button>
        </form>
      </section>

      <section aria-label="Handoff board">
        <h2>4. Handoff board</h2>
        <form onSubmit={(e) => void handOffBoard(e)}>
          <div>
            <label htmlFor="boards-recipient">Recipient subject ID</label>
            <input id="boards-recipient" type="text" autoComplete="off" value={toSubjectId} onChange={(e) => setToSubjectId(e.target.value)} placeholder="00000000-0000-4000-8000-000000000000" style={{ width: "100%" }} />
          </div>
          <button type="submit" disabled={!canAct}>Hand off board</button>
        </form>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <button type="button" disabled={!canAct} onClick={() => void refreshHandoffs()}>List handoffs</button>
          <button type="button" disabled={!canAct} onClick={() => void refreshValidation()}>Validate items</button>
        </div>
        {handoffs === null ? (
          <p>No handoffs listed yet. Hand off the board or choose List handoffs.</p>
        ) : handoffs.length === 0 ? (
          <p>No handoffs recorded for this board.</p>
        ) : (
          <ol>
            {handoffs.map((handoff) => (
              <li key={handoff.id}>
                <code>{handoff.boardUri}</code> · {handoff.fromSubject} → {handoff.toSubject} · {handoff.createdAt}
              </li>
            ))}
          </ol>
        )}
        {validation === null ? (
          <p>No validation run yet. Choose Validate items before handing off.</p>
        ) : validation.items.length === 0 ? (
          <p>Board has no items to validate.</p>
        ) : (
          <ol>
            {validation.items.map((entry) => (
              <li key={entry.artifactId}>
                <code>{entry.uri}</code> · {entry.status}
                {entry.title === undefined ? null : ` · ${entry.title}`}
                {entry.rights === undefined ? null : ` · ${entry.rights}`}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Board state" aria-live="polite">
        <h2>5. Board state</h2>
        {busy !== null ? <p>Working: {busy}…</p> : null}
        {failure !== null ? <p role="alert">Error {failure.code}: {failure.message}</p> : null}
        {notice !== null ? <p>{notice}</p> : null}
        {boards === null ? (
          <p>No boards listed yet. Enter credentials and choose List boards.</p>
        ) : boards.length === 0 ? (
          <p>No boards in this workspace. Create one above.</p>
        ) : (
          <ul>
            {boards.map((board) => (
              <li key={board.id}>
                <button type="button" disabled={!canAct} onClick={() => void inspectBoard(board.id)}>
                  {board.title}
                </button>{" "}
                <code>{board.uri}</code> · {board.visibility}
              </li>
            ))}
          </ul>
        )}
        {items === null ? (
          <p>No board inspected yet.</p>
        ) : items.length === 0 ? (
          <p>Board is empty. Save an artifact above.</p>
        ) : (
          <ol>
            {items.map((item) => (
              <li key={item.artifactId}>
                <code>{item.uri}</code> · rank {item.position}{" "}
                <button type="button" disabled={!canAct} onClick={() => void removeItem(item.artifactId)}>
                  Remove
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
