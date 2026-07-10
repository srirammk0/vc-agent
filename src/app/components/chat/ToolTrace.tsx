"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Wrench } from "lucide-react";
import type { ToolTraceEntry } from "../../../lib/chatTypes";

const TOOL_LABELS: Record<string, string> = {
  exa_deep_search_many: "Searching Exa",
  linkup_search: "Searching the web",
  linkup_search_many: "Searching the web",
  linkup_fetch: "Fetching a page",
  supermemory_search: "Checking memory",
  list_known_startups: "Looking up known startups",
  save_startups: "Updating dealflow",
  update_startup_statuses: "Updating dealflow",
  delete_startups: "Updating dealflow",
  write_preferences: "Saving a preference",
  list_preferences: "Looking up preferences",
  delete_preferences: "Saving a preference",
  write_reflection: "Saving a note",
  update_thesis: "Updating thesis",
};

const ARGS_LIMIT = 320;
const RESULT_LIMIT = 320;

function stepLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function formatArgs(args: unknown): string {
  let str: string;
  try {
    str = JSON.stringify(args, null, 2);
  } catch {
    str = String(args);
  }
  return truncate(str, ARGS_LIMIT);
}

export default function ToolTrace({ trace }: { trace?: ToolTraceEntry[] }) {
  const [open, setOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  const running = trace?.find((t) => t.status === "running");

  useEffect(() => {
    if (!autoOpenedRef.current && running) {
      autoOpenedRef.current = true;
      setOpen(true);
    }
  }, [running]);

  if (!trace || trace.length === 0) return null;

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
        <span>{running ? `${stepLabel(running.toolName)}…` : `${trace.length} tool call${trace.length === 1 ? "" : "s"}`}</span>
        <ChevronDown size={13} className={`chat-trace-chevron${open ? " chat-trace-chevron-open" : ""}`} />
      </button>
      {open && (
        <div className="chat-trace-body animate-fade-in">
          {trace.map((entry, i) => (
            <div key={entry.id} className="chat-trace-step">
              <div className="chat-trace-step-rail">
                <span
                  className={`chat-trace-step-dot${
                    entry.status === "running" ? " chat-trace-step-dot-running" : " chat-trace-step-dot-done"
                  }`}
                >
                  {entry.status === "done" ? <Check size={10} strokeWidth={3} /> : null}
                </span>
                {i < trace.length - 1 && <span className="chat-trace-step-line" />}
              </div>
              <div className="chat-trace-step-body">
                <div className="chat-trace-row-head">
                  <span className="chat-trace-step-label">{stepLabel(entry.toolName)}</span>
                  <span className="chat-trace-tool-name">{entry.toolName}</span>
                </div>
                <pre className="chat-trace-args">{formatArgs(entry.args)}</pre>
                {entry.result && (
                  <div className="chat-trace-result">{truncate(entry.result, RESULT_LIMIT)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
