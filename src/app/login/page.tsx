"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#FFFFFF",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily:
          "'Aeonik Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "#171717",
      }}
    >
      <form
        action={formAction}
        style={{
          width: "100%",
          maxWidth: 360,
          border: "1px solid #F0F0F0",
          borderRadius: 12,
          padding: 28,
          boxShadow: "0px 4px 13.9px rgba(135, 135, 135, 0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 21, lineHeight: "35px", margin: 0 }}>VC Scout</h1>
          <p style={{ fontSize: 13, color: "#616061", margin: "4px 0 0" }}>
            Enter the password to continue.
          </p>
        </div>

        <input
          type="password"
          name="password"
          placeholder="Password"
          autoFocus
          style={{
            height: 44,
            padding: "12px 16px",
            borderRadius: 8,
            border: state?.error ? "2px solid #F59E0B" : "1px solid #D1D1D1",
            fontSize: 14,
            outline: "none",
          }}
        />

        {state?.error && (
          <p style={{ fontSize: 12, color: "#F59E0B", margin: 0 }}>{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          style={{
            height: 44,
            borderRadius: 8,
            border: "0px solid transparent",
            background: "#007AFF",
            color: "#FFFFFF",
            fontSize: 13,
            cursor: pending ? "not-allowed" : "pointer",
            opacity: pending ? 0.6 : 1,
            boxShadow: "0px 4px 12px rgba(0, 122, 255, 0.25)",
          }}
        >
          {pending ? "..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
