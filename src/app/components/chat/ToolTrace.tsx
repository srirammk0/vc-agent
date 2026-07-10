"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
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

const SNIPPET_LIMIT = 140;
const ARGS_PREFER_KEYS = ["q", "query", "url", "urls", "pattern", "content", "slug", "slugs", "name"];

function stepLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  const clean = oneLine(text);
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

// A "bit of the output", not a JSON dump — pull the most human-relevant field
// out of the tool's args instead of pretty-printing the whole payload.
function summarizeArgs(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === "string") return args ? truncate(args, SNIPPET_LIMIT) : null;
  if (typeof args !== "object") return truncate(String(args), SNIPPET_LIMIT);

  const obj = args as Record<string, unknown>;
  for (const key of ARGS_PREFER_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v) return truncate(v, SNIPPET_LIMIT);
    if (Array.isArray(v) && v.length) return truncate(v.map(String).join(", "), SNIPPET_LIMIT);
  }
  try {
    const compact = JSON.stringify(obj);
    return compact && compact !== "{}" ? truncate(compact, SNIPPET_LIMIT) : null;
  } catch {
    return null;
  }
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
          <Check size={12} strokeWidth={2.75} />
        )}
        <span>{running ? `${stepLabel(running.toolName)}…` : "Finished working"}</span>
        <ChevronDown size={13} className={`chat-trace-chevron${open ? " chat-trace-chevron-open" : ""}`} />
      </button>
      {open && (
        <div className="chat-trace-body animate-fade-in">
          {trace.map((entry, i) => {
            const argsSummary = summarizeArgs(entry.args);
            return (
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
                  <span className="chat-trace-step-label">{stepLabel(entry.toolName)}</span>
                  {argsSummary && <div className="chat-trace-args">{argsSummary}</div>}
                  {entry.result && <div className="chat-trace-result">{truncate(entry.result, SNIPPET_LIMIT)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
