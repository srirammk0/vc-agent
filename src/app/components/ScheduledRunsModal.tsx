"use client";

import { useEffect } from "react";
import { RefreshCw, X } from "lucide-react";
import { useScheduledRuns } from "../hooks/useScheduledRuns";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { ScheduledRunsList } from "./ScheduledRunsClient";

/** Scheduled Runs, embedded as a modal (e.g. from the chat page) instead of a full
 * page navigation — same data/actions as /scheduled, fetched client-side since
 * there's no server component here to seed an initial list. */
export default function ScheduledRunsModal({ onClose }: { onClose: () => void }) {
  const { tasks, refresh, refreshing, cancelTask, rescheduleTask } = useScheduledRuns([]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEscapeKey(true, onClose);

  return (
    <>
      <div
        className="animate-fade-in"
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(10,10,12,0.6)",
          backdropFilter: "blur(14px) saturate(140%)",
          WebkitBackdropFilter: "blur(14px) saturate(140%)",
          zIndex: 800,
        }}
      />
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 810,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          pointerEvents: "none",
        }}
      >
        <div
          className="animate-scale-in"
          style={{
            width: "100%",
            maxWidth: 640,
            maxHeight: "min(720px, 86vh)",
            display: "flex",
            flexDirection: "column",
            background: "var(--card-bg)",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            pointerEvents: "auto",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "18px 22px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "var(--heading)" }}>
                Scheduled Runs
              </h2>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "3px 0 0" }}>
                What the agent has queued up, and what it did last time it woke up.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => refresh()}
                title="Refresh"
                style={{
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.7)",
                  color: "var(--label)",
                  cursor: "pointer",
                }}
              >
                <RefreshCw size={13} strokeWidth={2.2} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  width: 30,
                  height: 30,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "rgba(255,255,255,0.7)",
                  color: "var(--label)",
                  cursor: "pointer",
                }}
              >
                <X size={14} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          <div style={{ overflowY: "auto", padding: "20px 22px 24px" }}>
            <ScheduledRunsList tasks={tasks} cancelTask={cancelTask} rescheduleTask={rescheduleTask} />
          </div>
        </div>
      </div>
    </>
  );
}
