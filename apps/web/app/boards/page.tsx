"use client";

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

export default function BoardsPage() {
  const [token, setToken] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [title, setTitle] = useState("Moodboard");
  const [boardId, setBoardId] = useState("");
  const [artifactId, setArtifactId] = useState("");
  const [toPosition, setToPosition] = useState("0");
  const [boards, setBoards] = useState<BoardView[] | null>(null);
  const [items, setItems] = useState<ItemView[] | null>(null);
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
    onOk: (payload: Record<string, unknown>) => void,
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
    await callJson("List", `/api/v1/boards?workspaceId=${encodeURIComponent(workspaceId.trim())}`, {
      headers: authHeaders(),
    }, (result) => {
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
      headers: { ...authHeaders(), "Content-Type": "application/json" },
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
    await callJson("Inspect", `/api/v1/boards/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
    }, (result) => {
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
      headers: { ...authHeaders(), "Content-Type": "application/json" },
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
      headers: { ...authHeaders(), "Content-Type": "application/json" },
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
      headers: authHeaders(),
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
      headers: authHeaders(),
    }, () => {
      setBoardId("");
      setItems(null);
      setNotice("Board deleted.");
      void refreshBoards();
    });
  }

  const canAct = token.trim() !== "" && workspaceId.trim() !== "" && busy === null;

  return (
    <main style={{ maxWidth: 880, margin: "48px auto", padding: "0 20px" }}>
      <h1>Reference boards</h1>
      <p>
        List, create, inspect, curate, reorder, and delete boards backed by
        the ordered collections domain. Every board is addressed by its
        stable <code>skelet://collection/{"{id}"}</code> identifier.
      </p>

      <section aria-label="Credentials">
        <h2>1. Credentials</h2>
        <form onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="boards-token">Session bearer token</label>
            <input
              id="boards-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Bearer token from sign-in"
              style={{ width: "100%" }}
            />
          </div>
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

      <section aria-label="Board state" aria-live="polite">
        <h2>4. Board state</h2>
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
