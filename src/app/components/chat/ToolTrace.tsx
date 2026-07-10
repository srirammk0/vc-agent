"use client";

import { useState } from "react";
import { ChevronDown, Wrench } from "lucide-react";
import type { ToolTraceEntry } from "../../../lib/chatTypes";

const TOOL_LABELS: Record<string, string> = {
  exa_deep_search_many: "Searching Exa…",
  linkup_search: "Searching the web…",
  linkup_search_many: "Searching the web…",
  linkup_fetch: "Fetching a page…",
  supermemory_search: "Checking memory…",
  list_known_startups: "Looking up known startups…",
  save_startups: "Updating dealflow…",
  update_startup_statuses: "Updating dealflow…",
  delete_startups: "Updating dealflow…",
  write_preferences: "Saving a preference…",
  list_preferences: "Looking up preferences…",
  delete_preferences: "Saving a preference…",
  write_reflection: "Saving a note…",
  update_thesis: "Updating thesis…",
};

function liveLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? "Working…";
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export default function ToolTrace({ trace }: { trace?: ToolTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  if (!trace || trace.length === 0) return null;

  const running = trace.find((t) => t.status === "running");

  return (
    <div className="chat-trace">
      <button
        type="button"
        className="chat-trace-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {running ? (
          <span className="live-dot chat-thinking-dot" />
        ) : (
          <Wrench size={12} />
        )}
        <span>{running ? liveLabel(running.toolName) : `${trace.length} tool call${trace.length === 1 ? "" : "s"}`}</span>
        <ChevronDown size={13} className={`chat-trace-chevron${open ? " chat-trace-chevron-open" : ""}`} />
      </button>
      {open && (
        <div className="chat-trace-body animate-fade-in">
          {trace.map((entry) => (
            <div key={entry.id} className="chat-trace-row">
              <div className="chat-trace-row-head">
                <span className="chat-trace-tool-name">{entry.toolName}</span>
                {entry.status === "running" && <span className="live-dot chat-thinking-dot" />}
              </div>
              <pre className="chat-trace-args">{formatArgs(entry.args)}</pre>
              {entry.result && <div className="chat-trace-result">{entry.result}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
