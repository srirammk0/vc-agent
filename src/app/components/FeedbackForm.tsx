"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";

type Status = "new" | "approved" | "passed";

type Props = {
  slug: string;
  name: string;
  status: Status;
  /** When set, submitting also updates status (e.g. approve/pass flow). */
  targetStatus?: Status;
  placeholder?: string;
  submitLabel?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  compact?: boolean;
};

export default function FeedbackForm({
  slug,
  name,
  status,
  targetStatus,
  placeholder = "why are you approving or passing this one?",
  submitLabel = "Send feedback",
  onSuccess,
  onCancel,
  compact = false,
}: Props) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("write something first");
      return;
    }

    setError(null);
    const res = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        name,
        status: targetStatus ?? status,
        message: trimmed,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "failed to send");
      return;
    }

    setMessage("");
    setSent(true);
    onSuccess?.();
    startTransition(() => router.refresh());
    setTimeout(() => setSent(false), 2500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 10 }}>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={placeholder}
        rows={compact ? 3 : 4}
        disabled={isPending}
        style={{
          width: "100%",
          resize: "vertical",
          minHeight: compact ? 72 : 88,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "rgba(255,255,255,0.75)",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--body)",
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      {error && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--danger)" }}>{error}</p>
      )}
      {sent && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--success)" }}>
          sent to agent — saved to memory
        </p>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            style={secondaryBtn}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          style={{
            ...primaryBtn,
            opacity: isPending ? 0.6 : 1,
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Sending…" : submitLabel}
        </button>
      </div>
    </div>
  );
}

const primaryBtn: CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 500,
};

const secondaryBtn: CSSProperties = {
  height: 34,
  padding: "0 14px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "rgba(255,255,255,0.7)",
  color: "var(--label)",
  fontSize: 12.5,
  fontWeight: 500,
  cursor: "pointer",
};
