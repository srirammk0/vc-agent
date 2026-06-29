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
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
      className="animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-scale-in"
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0px 20px 40px rgba(0,0,0,0.2)",
          overflow: "hidden",
          border: "1px solid #E8E8E8",
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              go(results[active].slug);
            }
          }}
          placeholder="Search startups..."
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            padding: "18px 20px",
            fontSize: 16,
            color: "#171717",
            borderBottom: "1px solid #F0F0F0",
          }}
        />
        <div style={{ maxHeight: 360, overflowY: "auto", padding: 8 }}>
          {results.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                color: "#999",
                fontSize: 14,
                textAlign: "center",
              }}
            >
              No matches.
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
                  borderRadius: 10,
                  padding: "10px 12px",
                  background: i === active ? "#F2F7FF" : "transparent",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 14, color: "#171717" }}>{s.name}</span>
                {s.one_liner && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#999",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "100%",
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
