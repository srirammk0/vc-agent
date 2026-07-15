"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, X } from "lucide-react";
import type { Founder, Startup } from "../../lib/supabase";
import { hasEnrichmentData } from "../../lib/enrichment";
import { queueWrite } from "../../lib/writeQueue";
import { useToast } from "./Toast";
import StatusBadge from "./StatusBadge";
import OutreachBadges from "./OutreachBadges";

type Status = "new" | "approved" | "passed";

type Props = {
  /** Live, current startup rows — looked up by slug every render so status/enrichment
   * updates show immediately, even for cards already passed in this session. */
  startups: Startup[];
  /** Frozen snapshot of slugs (the filtered/tab view at the moment Speed Review was
   * opened) — the queue itself doesn't reshuffle mid-review even as statuses change. */
  queueSlugs: string[];
  onUpdate: (slug: string, partial: Partial<Startup>) => void;
  onClose: () => void;
};

function truncate(text: string | null | undefined, n: number): string {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).trimEnd() + "…" : text;
}

function toHref(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")
    ? url
    : `https://${url}`;
}

const META_FIELDS: { key: keyof Startup; label: string }[] = [
  { key: "stage", label: "Stage" },
  { key: "raised", label: "Raised" },
  { key: "location", label: "Location" },
];

export default function SpeedReview({ startups, queueSlugs, onUpdate, onClose }: Props) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<"approved" | "passed" | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const { showUndoToast } = useToast();

  const total = queueSlugs.length;
  const done = index >= total;
  const current = !done ? startups.find((s) => s.slug === queueSlugs[index]) : undefined;

  // Collapse the preview whenever the card changes — it shouldn't carry over
  // from whatever the previous card had it set to.
  useEffect(() => {
    setShowPreview(false);
  }, [index]);

  const goPrev = useCallback(() => {
    setFlash(null);
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goNext = useCallback(() => {
    setFlash(null);
    setIndex((i) => Math.min(i + 1, total));
  }, [total]);

  const setStatus = useCallback(
    async (status: Status) => {
      if (!current || busy) return;
      const slug = current.slug;
      const name = current.name;
      const prevStatus = current.status;
      setBusy(true);
      setFlash(status === "passed" ? "passed" : "approved");
      onUpdate(slug, { status });
      try {
        await queueWrite(slug, async () => {
          const res = await fetch(`/api/startup/${slug}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          });
          if (!res.ok) throw new Error("status update failed");
        });
        showUndoToast(`${name} marked ${status}`, async () => {
          onUpdate(slug, { status: prevStatus });
          await queueWrite(slug, async () => {
            const res = await fetch(`/api/startup/${slug}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: prevStatus }),
            });
            if (!res.ok) throw new Error("undo failed");
          }).catch((e) => console.error("undo failed:", e));
        });
      } catch (e) {
        console.error(e);
        onUpdate(slug, { status: prevStatus });
      }
      setBusy(false);
      // Brief flash so the decision registers visually before the card advances.
      setTimeout(() => {
        setIndex((i) => Math.min(i + 1, total));
        setFlash(null);
      }, 200);
    },
    [current, busy, onUpdate, total, showUndoToast]
  );

  // A card can vanish mid-review (agent deletes a duplicate, etc.) — skip past a
  // hole in the queue instead of showing a blank card.
  useEffect(() => {
    if (!done && !current) {
      setIndex((i) => Math.min(i + 1, total));
    }
  }, [current, done, total]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (done) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        goNext();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        setStatus("approved");
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setStatus("passed");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, goPrev, goNext, setStatus, onClose]);

  const founders = (current?.founders ?? []) as Founder[];
  const enriched = current ? hasEnrichmentData(current) : false;
  const metaItems = current ? META_FIELDS.filter(({ key }) => current[key]) : [];

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
          style={{
            width: "100%",
            maxWidth: 640,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            pointerEvents: "auto",
          }}
        >
          {/* Header: progress + close */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.75)" }}>
              {done ? `${total} of ${total}` : `${Math.min(index + 1, total)} of ${total}`}
            </span>
            <button
              onClick={onClose}
              aria-label="Close speed review"
              style={{
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "#fff",
                color: "var(--label)",
                cursor: "pointer",
              }}
            >
              <X size={15} strokeWidth={2.2} />
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, borderRadius: 999, background: "rgba(255,255,255,0.15)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: total > 0 ? `${(Math.min(index, total) / total) * 100}%` : "0%",
                background: "var(--accent)",
                transition: "width 0.2s ease",
              }}
            />
          </div>

          {done ? (
            <div
              className="animate-scale-in"
              style={{
                background: "var(--card-bg)",
                borderRadius: 16,
                padding: "48px 32px",
                textAlign: "center",
                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--heading)", marginBottom: 6 }}>
                All caught up
              </div>
              <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "0 0 20px" }}>
                You've been through everything in this view.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  onClick={() => setIndex(0)}
                  style={{
                    height: 38,
                    padding: "0 16px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.7)",
                    color: "var(--label)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Review again
                </button>
                <button
                  onClick={onClose}
                  style={{
                    height: 38,
                    padding: "0 16px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          ) : current ? (
            <div
              key={current.slug}
              className="animate-scale-in"
              style={{
                background: "var(--card-bg)",
                borderRadius: 16,
                padding: "28px 28px 24px",
                boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
                position: "relative",
                maxHeight: "min(620px, 62vh)",
                overflowY: "auto",
                overflowX: "hidden",
              }}
            >
              {flash && (
                <div
                  className="animate-fade-in"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: flash === "approved" ? "rgba(52,199,89,0.12)" : "rgba(255,59,48,0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 5,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 15,
                      fontWeight: 600,
                      color: flash === "approved" ? "var(--success)" : "var(--danger)",
                      background: "var(--card-bg)",
                      padding: "10px 18px",
                      borderRadius: 999,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                    }}
                  >
                    {flash === "approved" ? <Check size={16} strokeWidth={2.5} /> : <X size={16} strokeWidth={2.5} />}
                    {flash === "approved" ? "Approved" : "Passed"}
                  </span>
                </div>
              )}

              {/* Name + badges */}
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <h2 style={{ fontSize: 21, fontWeight: 700, margin: 0, color: "var(--heading)", letterSpacing: "-0.02em" }}>
                      {current.name}
                    </h2>
                    <StatusBadge status={current.status} />
                    <OutreachBadges
                      stealth={current.stealth}
                      linkedinStatus={current.linkedin_status}
                      emailStatus={current.email_status}
                    />
                  </div>
                  {current.website && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <a
                        href={toHref(current.website)}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        {current.website.replace(/^https?:\/\//, "")}
                        <ExternalLink size={11} strokeWidth={2.2} />
                      </a>
                      <button
                        type="button"
                        onClick={() => setShowPreview((v) => !v)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11.5,
                          fontWeight: 500,
                          color: "var(--label)",
                          background: "var(--surface, #f4f4f4)",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "3px 9px",
                          cursor: "pointer",
                        }}
                      >
                        {showPreview ? "Hide preview" : "Show preview"}
                        <ChevronDown
                          size={12}
                          strokeWidth={2.2}
                          style={{
                            transform: showPreview ? "rotate(180deg)" : "rotate(0deg)",
                            transition: "transform 0.15s ease",
                          }}
                        />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {current.website && showPreview && (
                <div
                  className="animate-fade-in"
                  style={{
                    marginBottom: 16,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                    height: 220,
                    background: "var(--surface, #f4f4f4)",
                  }}
                >
                  <iframe
                    src={toHref(current.website)}
                    title={`${current.name} website preview`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                    style={{ width: "100%", height: "100%", border: "none" }}
                  />
                </div>
              )}

              {/* One-liner + assessment */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: enriched ? 16 : 0 }}>
                {current.one_liner && (
                  <p style={{ fontSize: 14, color: "var(--body)", lineHeight: 1.55, margin: 0, fontWeight: 500 }}>
                    {current.one_liner}
                  </p>
                )}
                {current.assessment && (
                  <p style={{ fontSize: 13, color: "var(--label)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
                    {truncate(current.assessment, 500)}
                  </p>
                )}
              </div>

              {/* Compact enrichment summary */}
              {enriched && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                  {metaItems.length > 0 && (
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {metaItems.map(({ key, label }) => (
                        <div key={key} style={{ fontSize: 12 }}>
                          <span style={{ color: "var(--muted)", marginRight: 4 }}>{label}:</span>
                          <span style={{ color: "var(--body)", fontWeight: 500 }}>{current[key] as string}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {founders.slice(0, 2).map((f, i) => (
                    <div key={i} style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 600, color: "var(--body)" }}>{f.name}</span>
                      {f.credibility_note && (
                        <span style={{ color: "var(--label)" }}> — {truncate(f.credibility_note, 140)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Controls */}
          {!done && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}>
              <button
                onClick={goPrev}
                disabled={index === 0}
                aria-label="Previous"
                title="Previous (←)"
                style={navBtnStyle(index === 0)}
              >
                <ArrowLeft size={17} strokeWidth={2.2} />
              </button>

              <button
                onClick={() => setStatus("passed")}
                disabled={busy}
                style={{
                  height: 52,
                  padding: "0 28px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,59,48,0.35)",
                  background: "rgba(255,59,48,0.12)",
                  color: "var(--danger)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <X size={16} strokeWidth={2.4} />
                Pass
              </button>

              <button
                onClick={() => setStatus("approved")}
                disabled={busy}
                style={{
                  height: 52,
                  padding: "0 28px",
                  borderRadius: 12,
                  border: "1px solid rgba(52,199,89,0.35)",
                  background: "rgba(52,199,89,0.14)",
                  color: "var(--success)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                  opacity: busy ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Check size={16} strokeWidth={2.4} />
                Approve
              </button>

              <button
                onClick={goNext}
                disabled={index >= total - 1}
                aria-label="Next"
                title="Next (→)"
                style={navBtnStyle(index >= total - 1)}
              >
                <ArrowRight size={17} strokeWidth={2.2} />
              </button>
            </div>
          )}

          {/* Keyboard hints */}
          {!done && (
            <div style={{ display: "flex", justifyContent: "center", gap: 14, flexWrap: "wrap" }}>
              <Hint keys="←/→" label="navigate" />
              <Hint keys="A" label="approve" />
              <Hint keys="P" label="pass" />
              <Hint keys="esc" label="close" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function navBtnStyle(disabled: boolean): CSSProperties {
  return {
    width: 44,
    height: 44,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    border: "1px solid var(--border)",
    background: disabled ? "#f0f0f0" : "#fff",
    color: disabled ? "var(--muted)" : "var(--label)",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
      <kbd
        style={{
          fontSize: 10.5,
          color: "var(--label)",
          border: "1px solid var(--border)",
          borderRadius: 5,
          padding: "1px 6px",
          background: "#fff",
          fontFamily: "inherit",
        }}
      >
        {keys}
      </kbd>
      {label}
    </span>
  );
}
