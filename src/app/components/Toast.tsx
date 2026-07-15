"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

type ToastState = { id: number; message: string; onUndo: () => void } | null;

type ToastContextValue = {
  /** Shows a toast with an Undo action. Calling this again before the previous
   * toast's timeout replaces it — only one undo is ever live at a time, so an
   * action taken before undoing simply supersedes the prior undo opportunity. */
  showUndoToast: (message: string, onUndo: () => void) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  const showUndoToast = useCallback((message: string, onUndo: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const id = ++idRef.current;
    setToast({ id, message, onUndo });
    timerRef.current = setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, TOAST_DURATION_MS);
  }, []);

  function handleUndo() {
    if (!toast) return;
    toast.onUndo();
    dismiss();
  }

  return (
    <ToastContext.Provider value={{ showUndoToast }}>
      {children}
      {toast && (
        <div
          className="animate-fade-in"
          style={{
            position: "fixed",
            top: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 900,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 10px 10px 16px",
            background: "var(--card-bg)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)",
            maxWidth: "min(420px, calc(100vw - 32px))",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--body)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {toast.message}
          </span>
          <button
            type="button"
            onClick={handleUndo}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--accent)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
              padding: "4px 6px",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              flexShrink: 0,
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              borderRadius: 6,
            }}
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
