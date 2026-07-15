"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import type { ScheduledTask } from "../../lib/supabase";
import { useScheduledRuns } from "../hooks/useScheduledRuns";

const KIND_LABELS: Record<string, string> = {
  agent_followup: "Follow-up",
  text_followup: "Follow-up",
  daily_check: "Portfolio check",
  signal_recheck: "Signal recheck",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function detailText(task: ScheduledTask): string {
  const p = task.payload ?? {};
  return p.instructions || p.reason || p.notes || "";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** `datetime-local` inputs want local time with no timezone (YYYY-MM-DDTHH:mm). */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TaskCard({
  task,
  onCancel,
  onReschedule,
}: {
  task: ScheduledTask;
  onCancel?: (id: string) => Promise<string | null>;
  onReschedule?: (id: string, dueAtIso: string) => Promise<string | null>;
}) {
  const detail = detailText(task);
  const result = task.payload?.result;
  const isPending = task.status === "pending";

  const [editing, setEditing] = useState(false);
  const [dueValue, setDueValue] = useState(() => toDatetimeLocalValue(task.due_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (!onCancel || busy) return;
    if (!window.confirm("Cancel this scheduled run? It won't fire.")) return;
    setBusy(true);
    setError(null);
    const err = await onCancel(task.id);
    if (err) setError(err);
    setBusy(false);
  }

  async function handleSaveReschedule() {
    if (!onReschedule || busy) return;
    const asDate = new Date(dueValue);
    if (Number.isNaN(asDate.getTime())) {
      setError("invalid date/time");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await onReschedule(task.id, asDate.toISOString());
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setEditing(false);
  }

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--card-bg)",
        padding: "16px 20px",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(255,255,255,0.6) inset",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: isPending ? "var(--accent)" : "var(--success)",
              background: isPending ? "rgba(0,122,255,0.08)" : "rgba(52,199,89,0.08)",
              border: isPending ? "1px solid rgba(0,122,255,0.2)" : "1px solid rgba(52,199,89,0.2)",
              borderRadius: 999,
              padding: "2px 9px",
            }}
          >
            {kindLabel(task.kind)}
          </span>
          {task.payload?.sender && (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>via text</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!editing && (
            <span style={{ fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <Clock size={12} strokeWidth={2.2} />
              {formatWhen(task.due_at)}
            </span>
          )}
          {isPending && (onCancel || onReschedule) && !editing && (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {onReschedule && (
                <button
                  type="button"
                  onClick={() => {
                    setDueValue(toDatetimeLocalValue(task.due_at));
                    setError(null);
                    setEditing(true);
                  }}
                  disabled={busy}
                  aria-label="Change time"
                  title="Change time"
                  style={iconBtnStyle(busy)}
                >
                  <Pencil size={12} strokeWidth={2.2} />
                </button>
              )}
              {onCancel && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={busy}
                  aria-label="Cancel"
                  title="Cancel"
                  style={iconBtnStyle(busy, true)}
                >
                  <Trash2 size={12} strokeWidth={2.2} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input
            type="datetime-local"
            value={dueValue}
            onChange={(e) => setDueValue(e.target.value)}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--card-bg)",
              color: "var(--body)",
              fontSize: 12.5,
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            onClick={handleSaveReschedule}
            disabled={busy}
            style={{
              height: 32,
              padding: "0 12px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 12.5,
              fontWeight: 500,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
            disabled={busy}
            aria-label="Cancel edit"
            style={iconBtnStyle(busy)}
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {detail && (
        <p style={{ fontSize: 13.5, color: "var(--body)", lineHeight: 1.5, margin: 0 }}>{detail}</p>
      )}

      {error && (
        <p style={{ fontSize: 12, color: "var(--danger, #e5484d)", margin: "8px 0 0" }}>{error}</p>
      )}

      {!isPending && result && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
            fontSize: 13,
            color: "var(--label)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {result}
        </div>
      )}
    </div>
  );
}

function iconBtnStyle(busy: boolean, danger = false): CSSProperties {
  return {
    width: 26,
    height: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "rgba(255,255,255,0.7)",
    color: danger ? "var(--danger, #e5484d)" : "var(--label)",
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.5 : 1,
    flexShrink: 0,
  };
}

/** Upcoming + Recent activity sections — shared by the full /scheduled page and
 * the chat page's ScheduledRunsModal, so both stay in sync with one implementation. */
export function ScheduledRunsList({
  tasks,
  cancelTask,
  rescheduleTask,
}: {
  tasks: ScheduledTask[];
  cancelTask?: (id: string) => Promise<string | null>;
  rescheduleTask?: (id: string, dueAtIso: string) => Promise<string | null>;
}) {
  const upcoming = tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime());
  const recent = tasks
    .filter((t) => t.status !== "pending")
    .sort((a, b) => new Date(b.due_at).getTime() - new Date(a.due_at).getTime())
    .slice(0, 30);

  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <h2
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--label)",
            margin: "0 0 12px",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          Upcoming ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border-med)",
              borderRadius: 10,
              padding: 32,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13.5,
            }}
          >
            Nothing scheduled right now.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {upcoming.map((t) => (
              <TaskCard key={t.id} task={t} onCancel={cancelTask} onReschedule={rescheduleTask} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: "var(--label)",
            margin: "0 0 12px",
            letterSpacing: "0.07em",
            textTransform: "uppercase",
          }}
        >
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border-med)",
              borderRadius: 10,
              padding: 32,
              textAlign: "center",
              color: "var(--muted)",
              fontSize: 13.5,
            }}
          >
            Nothing's run yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {recent.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export default function ScheduledRunsClient({ initial }: { initial: ScheduledTask[] }) {
  const { tasks, refresh, refreshing, cancelTask, rescheduleTask } = useScheduledRuns(initial);

  return (
    <main style={{ minHeight: "100vh", background: "var(--page-bg)", color: "var(--body)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 60px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 28,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Link href="/" className="back-link" style={{ marginBottom: 14, display: "inline-flex" }}>
              <ArrowLeft size={14} strokeWidth={2.2} />
              Dealflow
            </Link>
            <h1
              style={{
                fontSize: 28,
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.03em",
                color: "var(--heading)",
                lineHeight: 1.1,
              }}
            >
              Scheduled Runs
            </h1>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: "6px 0 0" }}>
              What the agent has queued up for itself, and what it did last time it woke up.
            </p>
          </div>
          <button
            onClick={() => refresh()}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 32,
              padding: "0 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "rgba(255,255,255,0.7)",
              color: "var(--label)",
              fontSize: 12.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={13} strokeWidth={2.2} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        <ScheduledRunsList tasks={tasks} cancelTask={cancelTask} rescheduleTask={rescheduleTask} />
      </div>
    </main>
  );
}
