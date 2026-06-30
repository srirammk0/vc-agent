"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--page-bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form
        action={formAction}
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: 390,
          borderRadius: 10,
          padding: "60px 38px 56px",
          background: "var(--card-bg)",
          border: "1px solid var(--border)",
          boxShadow:
            "0 4px 24px rgba(0,0,0,0.07), 0 1px 0 rgba(255,255,255,0.9) inset",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "var(--heading)",
              margin: 0,
              letterSpacing: "-0.3px",
              lineHeight: 1.25,
            }}
          >
            Dealflow Agent
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--label)", margin: 0, lineHeight: 1.4 }}>
            Enter the password to continue.
          </p>
        </div>

        {/* Input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoFocus
            className={state?.error ? "login-input login-input-error" : "login-input"}
          />
          {state?.error && (
            <p style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}>
              {state.error}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="expand-btn"
          style={{ opacity: pending ? 0.65 : 1 }}
        >
          <span className="expand-btn-label">
            {pending ? "Signing in…" : "Sign in"}
          </span>
          <span className="expand-btn-pill">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </span>
        </button>
      </form>
    </main>
  );
}
