"use client";

import { useActionState } from "react";
import { login } from "./actions.js";

const CARD: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #ebebeb",
  borderRadius: "12px",
  padding: "48px",
  width: "100%",
  maxWidth: "400px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.05), 0 8px 32px rgba(0,0,0,0.04)",
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  fontSize: "14px",
  color: "#111111",
  background: "#ffffff",
  border: "1px solid #d4d4d0",
  borderRadius: "8px",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
  letterSpacing: "0.05em",
};

const BUTTON: React.CSSProperties = {
  width: "100%",
  padding: "11px 0",
  fontSize: "13px",
  fontWeight: 500,
  color: "#ffffff",
  background: "#111111",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  fontFamily: "inherit",
  letterSpacing: "0.02em",
};

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, null);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f4f4f0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <div style={CARD}>
        {/* Logo / wordmark */}
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              fontSize: "9px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#aaaaaa",
              marginBottom: "10px",
            }}
          >
            Studio RTF · Research Agent
          </div>
          <h1
            style={{
              fontSize: "22px",
              fontWeight: 600,
              color: "#111111",
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Startup Pipeline
          </h1>
          <p
            style={{
              fontSize: "13px",
              color: "#666666",
              margin: "6px 0 0",
              lineHeight: 1.5,
            }}
          >
            Pre-seed AI discovery · private
          </p>
        </div>

        {/* Divider */}
        <div style={{ height: "1px", background: "#ebebeb", marginBottom: "28px" }} />

        {/* Form */}
        <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: "9px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#aaaaaa",
                marginBottom: "7px",
              }}
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoFocus
              required
              placeholder="············"
              style={{
                ...INPUT,
                borderColor: state?.error ? "#fca5a5" : "#d4d4d0",
              }}
            />
            {state?.error && (
              <p
                style={{
                  fontSize: "12px",
                  color: "#ef4444",
                  margin: "6px 0 0",
                }}
              >
                {state.error}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isPending}
            style={{
              ...BUTTON,
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? "Verifying…" : "Enter"}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p
        style={{
          marginTop: "24px",
          fontSize: "11px",
          color: "#aaaaaa",
          letterSpacing: "0.02em",
        }}
      >
        VC Research Agent · auto sweep every 4h
      </p>
    </div>
  );
}
