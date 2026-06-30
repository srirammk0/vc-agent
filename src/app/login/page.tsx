"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--page)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        color: "var(--black)",
      }}
    >
      <form
        action={formAction}
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: 360,
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 32,
          background: "var(--cream)",
          boxShadow: "0 8px 24px rgba(15, 23, 42, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "var(--gray-light)",
              marginBottom: 6,
            }}
          >
            VC Scout
          </div>
          <h1 style={{ fontSize: 24, lineHeight: "30px", margin: 0 }}>
            Dealflow Agent
          </h1>
          <p style={{ fontSize: 13, color: "var(--gray)", margin: "6px 0 0" }}>
            Enter the password to continue.
          </p>
        </div>

        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          style={{
            height: 46,
            padding: "12px 16px",
            borderRadius: 10,
            border: state?.error ? "2px solid var(--red)" : "1px solid var(--border)",
            background: "#fff",
            fontSize: 14,
            outline: "none",
          }}
        />

        {state?.error && (
          <p style={{ fontSize: 12, color: "var(--red)", margin: 0 }}>{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="login-btn"
          style={{
            height: 46,
            borderRadius: 10,
            border: "0 solid transparent",
            fontSize: 14,
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? "Signing in…" : "Sign in"}
          <svg
            className="arrow"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </button>
      </form>
    </main>
  );
}
