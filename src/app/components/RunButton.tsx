"use client";

import { useState } from "react";

export function RunButton() {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [runId, setRunId] = useState<string | null>(null);

  async function trigger() {
    setState("loading");
    try {
      const res = await fetch("/api/trigger", { method: "POST" });
      const data = await res.json();
      setRunId(data.runId);
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="flex items-center gap-3">
        <span className="text-emerald-400 text-sm">Run started</span>
        <span className="text-zinc-500 text-xs font-mono">{runId}</span>
        <button
          onClick={() => { setState("idle"); setRunId(null); }}
          className="text-zinc-500 text-xs hover:text-zinc-300 transition-colors"
        >
          reset
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={trigger}
      disabled={state === "loading"}
      className="px-4 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {state === "loading" ? "triggering..." : state === "error" ? "failed — retry" : "run now"}
    </button>
  );
}
