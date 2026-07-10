"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Startup } from "../../lib/supabase";

export default function CommandPalette({ startups }: { startups: Startup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? startups.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            (s.one_liner ?? "").toLowerCase().includes(q)
        )
      : startups;
    return base.slice(0, 8);
  }, [query, startups]);

  function go(slug: string) {
    setOpen(false);
    router.push(`/startups/${slug}`);
  }

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6,31,0,0.18)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        zIndex: 300,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "13vh",
      }}
      className="animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: 540,
          background: "var(--card-bg)",
          borderRadius: 12,
          boxShadow: "0 20px 50px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.06)",
          overflow: "hidden",
          border: "1px solid var(--border)",
          margin: "0 20px",
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--muted)"
            strokeWidth="2.2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && results[active]) go(results[active].slug);
            }}
            placeholder="Search startups…"
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              padding: "17px 0",
              fontSize: 15,
              color: "var(--heading)",
              background: "transparent",
            }}
          />
          <kbd
            style={{
              fontSize: 10.5,
              color: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "2px 6px",
              background: "var(--surface)",
              fontFamily: "inherit",
            }}
          >
            esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 340, overflowY: "auto", padding: 6 }}>
          {results.length === 0 ? (
            <div
              style={{
                padding: "28px 16px",
                color: "var(--muted)",
                fontSize: 13.5,
                textAlign: "center",
              }}
            >
              No matches found.
            </div>
          ) : (
            results.map((s, i) => (
              <button
                key={s.slug}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(s.slug)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  width: "100%",
                  textAlign: "left",
                  border: "none",
                  borderRadius: 7,
                  padding: "10px 12px",
                  background: i === active ? "rgba(0,122,255,0.06)" : "transparent",
                  cursor: "pointer",
                  transition: "background 0.1s ease",
                }}
              >
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: i === active ? "var(--accent)" : "var(--heading)",
                    transition: "color 0.1s ease",
                  }}
                >
                  {s.name}
                </span>
                {s.one_liner && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--label)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
                      marginTop: 1,
                    }}
                  >
                    {s.one_liner}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
