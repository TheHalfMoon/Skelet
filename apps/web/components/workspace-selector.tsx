"use client";

import { useEffect, useState } from "react";
import { sessionRequest } from "../lib/browser-session";

interface WorkspaceOption {
  id: string;
  name: string;
}

type Discovery =
  | { status: "checking"; workspaces: WorkspaceOption[] }
  | { status: "ready"; workspaces: WorkspaceOption[] }
  | { status: "signed-out"; workspaces: WorkspaceOption[] }
  | { status: "unavailable"; workspaces: WorkspaceOption[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readWorkspaces(payload: unknown): WorkspaceOption[] | null {
  if (payload === null || typeof payload !== "object" || !("result" in payload)) return null;
  const result = (payload as { result?: unknown }).result;
  if (result === null || typeof result !== "object" || !("workspaces" in result)) return null;
  const data = (result as { workspaces?: unknown }).workspaces;
  if (!Array.isArray(data) || data.length > 1000) return null;
  const workspaces: WorkspaceOption[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object" || !("id" in item) || !("name" in item)) return null;
    const { id, name } = item as { id: unknown; name: unknown };
    if (typeof id !== "string" || !UUID.test(id) || typeof name !== "string" || name.trim() === "" || name.length > 256) return null;
    if (seen.has(id)) return null;
    seen.add(id);
    workspaces.push({ id, name });
  }
  return workspaces;
}

/** One owner workspace is selected automatically; more than one needs an explicit choice. */
export function WorkspaceSelector({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [discovery, setDiscovery] = useState<Discovery>({ status: "checking", workspaces: [] });

  useEffect(() => {
    const controller = new AbortController();
    const onExpired = () => {
      setDiscovery({ status: "signed-out", workspaces: [] });
      onChange("");
    };
    window.addEventListener("skilit:session-expired", onExpired);
    void (async () => {
      try {
        const response = await sessionRequest("/api/v1/auth/session", { signal: controller.signal });
        if (!response.ok) {
          setDiscovery({ status: response.status === 401 ? "signed-out" : "unavailable", workspaces: [] });
          onChange("");
          return;
        }
        const workspaces = readWorkspaces(await response.json());
        if (workspaces === null) {
          setDiscovery({ status: "unavailable", workspaces: [] });
          onChange("");
          return;
        }
        setDiscovery({ status: "ready", workspaces });
        if (workspaces.length === 1) onChange(workspaces[0]!.id);
      } catch {
        if (!controller.signal.aborted) {
          setDiscovery({ status: "unavailable", workspaces: [] });
          onChange("");
        }
      }
    })();
    return () => {
      controller.abort();
      window.removeEventListener("skilit:session-expired", onExpired);
    };
  }, [onChange]);

  const options = discovery.workspaces;
  const selectable = discovery.status === "ready" && options.length > 0;
  return (
    <>
      <select
        id={id}
        value={selectable && options.some((item) => item.id === value) ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={!selectable}
        aria-describedby={id + "-hint"}
        style={{ width: "100%" }}
      >
        <option value="">{discovery.status === "checking" ? "Loading workspaces…" : "Select a workspace"}</option>
        {options.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} ({workspace.id.slice(0, 8)})
          </option>
        ))}
      </select>
      <p id={id + "-hint"} role="status" className="sk-workspace-picker-hint">
        {discovery.status === "checking" && "Finding your authorized workspaces…"}
        {discovery.status === "signed-out" && "Sign in to choose a workspace."}
        {discovery.status === "unavailable" && "Workspaces are temporarily unavailable."}
        {discovery.status === "ready" && options.length === 0 && "No workspace is assigned to this account."}
        {discovery.status === "ready" && options.length === 1 && "Your workspace was selected automatically."}
        {discovery.status === "ready" && options.length > 1 && "Choose the workspace you want to work in."}
      </p>
    </>
  );
}
