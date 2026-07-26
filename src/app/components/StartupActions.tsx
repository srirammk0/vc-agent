"use client";

import { useEffect, useRef, useState } from "react";
import { showEnrichButton } from "../../lib/enrichment";
import { queueWrite } from "../../lib/writeQueue";
import { useToast } from "./Toast";
import type { Founder, Startup } from "../../lib/supabase";

type Status = "new" | "approved" | "passed";
type ChannelStatus = "not_contacted" | "contacted" | "replied";

const STATUS_LABEL: Record<Status, string> = {
  new: "new",
  approved: "approved",
  passed: "passed",
};

type Props = {
  slug: string;
  name: string;
  status: Status;
  enrichmentStatus: "pending" | "running" | "complete" | "failed";
  enrichmentUpdatedAt: string | null;
  companyDescription: string | null;
  founders: Founder[] | null;
  enriched: boolean;
  stealth: boolean;
  linkedinStatus: ChannelStatus;
  emailStatus: ChannelStatus;
  followupCount?: number;
  lastFollowupAt?: string | null;
  onUpdate: (partial: Partial<Startup>) => void;
};

/** Matches the CHECK constraint in scripts/migrate-followups.sql. */
const MAX_FOLLOWUP_COUNT = 99;

const MENU_ITEMS: { value: Status; label: string; accent: string }[] = [
  { value: "approved", label: "Mark approved", accent: "var(--success)" },
  { value: "passed", label: "Mark passed", accent: "var(--danger)" },
  { value: "new", label: "Mark new", accent: "var(--label)" },
];

const NEXT_CHANNEL_STATUS: Record<ChannelStatus, ChannelStatus> = {
  not_contacted: "contacted",
  contacted: "replied",
  replied: "not_contacted",
};

const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  replied: "Replied",
};

export default function StartupActions({
  slug,
  name,
  status,
  enrichmentStatus,
  enrichmentUpdatedAt,
  companyDescription,
  founders,
  enriched,
  stealth,
  linkedinStatus,
  emailStatus,
  followupCount = 0,
  lastFollowupAt = null,
  onUpdate,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<Status | null>(null);
  const [feedback, setFeedback] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const { showUndoToast } = useToast();

  function closeMenu() {
    setMenuOpen(false);
    setFeedbackFor(null);
    setFeedback("");
  }

  useEffect(() => {
    if (!menuOpen) return;
    const card = menuRef.current?.closest("[data-startup-card]");
    if (card instanceof HTMLElement) {
      card.style.zIndex = "100";
      card.style.position = "relative";
      return () => {
        card.style.zIndex = "";
        card.style.position = "";
      };
    }
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const enrichVisible = showEnrichButton({
    status,
    enrichment_status: enrichmentStatus,
    updated_at: enrichmentUpdatedAt,
    enriched,
    company_description: companyDescription,
    founders,
    stage: null,
    raised: null,
    location: null,
    founded: null,
    team_size: null,
  });

  /** Re-applies a previously-reverted patch — used by undo toasts. Best-effort:
   * if the undo write itself fails, the optimistic revert already happened locally
   * and there's no further fallback here (same as any other failed background write). */
  async function applyPatch(body: Record<string, unknown>) {
    onUpdate(body as Partial<Startup>);
    await queueWrite(slug, async () => {
      const res = await fetch(`/api/startup/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("undo failed");
    }).catch((e) => console.error("undo failed:", e));
  }

  async function setStatusQuick(next: Status) {
    closeMenu();
    const prevStatus = status;
    onUpdate({ status: next });
    setBusy(next);
    try {
      await queueWrite(slug, async () => {
        const res = await fetch(`/api/startup/${slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) throw new Error("status update failed");
      });
      showUndoToast(`${name} marked ${STATUS_LABEL[next]}`, () => applyPatch({ status: prevStatus }));
    } catch (e) {
      console.error(e);
      onUpdate({ status: prevStatus });
    }
    setBusy(null);
  }

  async function patchOutreach(
    body: Record<string, unknown>,
    busyKey: string,
    revert: Partial<Startup>,
    toastMessage?: string
  ) {
    onUpdate(body as Partial<Startup>);
    setBusy(busyKey);
    try {
      await queueWrite(slug, async () => {
        const res = await fetch(`/api/startup/${slug}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("outreach update failed");
      });
      if (toastMessage) {
        showUndoToast(toastMessage, () => applyPatch(revert as Record<string, unknown>));
      }
    } catch (e) {
      console.error(e);
      onUpdate(revert);
    }
    setBusy(null);
  }

  function toggleStealth() {
    patchOutreach(
      { stealth: !stealth },
      "stealth",
      { stealth },
      `${name} ${!stealth ? "marked" : "unmarked"} stealth`
    );
  }

  function cycleChannel(channel: "linkedin_status" | "email_status", current: ChannelStatus) {
    const next = NEXT_CHANNEL_STATUS[current];
    const label = channel === "linkedin_status" ? "LinkedIn" : "Email";
    patchOutreach(
      { [channel]: next },
      channel,
      { [channel]: current },
      `${label} marked ${CHANNEL_LABEL[next].toLowerCase()}`
    );
  }

  /** Logs one more follow-up and stamps the time. Undo restores BOTH the old count
   * and the old timestamp — restoring the count alone would leave the row claiming
   * its last follow-up happened just now. */
  function logFollowup() {
    if (followupCount >= MAX_FOLLOWUP_COUNT) return;
    const next = followupCount + 1;
    patchOutreach(
      { followup_count: next, last_followup_at: new Date().toISOString() },
      "followup",
      { followup_count: followupCount, last_followup_at: lastFollowupAt },
      `Follow-up #${next} logged for ${name}`
    );
  }

  function clearFollowups() {
    if (followupCount === 0) return;
    patchOutreach(
      { followup_count: 0, last_followup_at: null },
      "followup",
      { followup_count: followupCount, last_followup_at: lastFollowupAt },
      `Follow-ups cleared for ${name}`
    );
  }

  function openFeedback(next: Status) {
    setFeedbackFor(next);
    setFeedback("");
    setMenuOpen(true);
  }

  function handleStatusClick(next: Status) {
    if (next === "new") {
      setStatusQuick(next);
      return;
    }
    openFeedback(next);
  }

  async function skipFeedback() {
    if (!feedbackFor) return;
    await setStatusQuick(feedbackFor);
  }

  async function sendFeedback() {
    if (!feedbackFor || !feedback.trim()) return;
    const prevStatus = status;
    const next = feedbackFor;
    const message = feedback.trim();
    onUpdate({ status: next });
    closeMenu();
    try {
      await queueWrite(slug, async () => {
        const res = await fetch("/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, name, status: next, message }),
        });
        if (!res.ok) throw new Error("feedback failed");
      });
      // Undo only reverts the status — the reason you gave already got distilled
      // into a learned preference server-side (agent.py's feedback mode), which
      // isn't something this can cleanly claw back.
      showUndoToast(`${name} marked ${STATUS_LABEL[next]}`, () => applyPatch({ status: prevStatus }));
    } catch (e) {
      console.error(e);
      onUpdate({ status: prevStatus });
    }
  }

  async function enrich() {
    const prevEnrichmentStatus = enrichmentStatus;
    onUpdate({ enrichment_status: "running" });
    setBusy("enrich");
    try {
      await queueWrite(slug, async () => {
        const res = await fetch(`/api/enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug, name }),
        });
        if (!res.ok) throw new Error("enrich failed");
      });
    } catch (e) {
      console.error(e);
      onUpdate({ enrichment_status: prevEnrichmentStatus });
    }
    setBusy(null);
  }

  const disabled = busy !== null;
  const menuRaised = menuOpen;

  return (
    <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
      {enrichVisible && (
        <button
          onClick={enrich}
          disabled={disabled}
          style={{
            height: 32,
            padding: "0 13px",
            borderRadius: 5,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.55 : 1,
            boxShadow: "0 2px 8px rgba(0,122,255,0.25)",
            transition: "opacity 0.15s ease, box-shadow 0.15s ease",
            whiteSpace: "nowrap",
          }}
        >
          {busy === "enrich"
            ? "Enriching…"
            : enrichmentStatus === "failed" || enrichmentStatus === "running"
            ? "Retry enrich"
            : "Enrich"}
        </button>
      )}

      <div
        ref={menuRef}
        style={{ position: "relative", zIndex: menuRaised ? 1000 : undefined }}
      >
        <button
          onClick={() => {
            if (menuOpen) closeMenu();
            else setMenuOpen(true);
          }}
          disabled={disabled}
          aria-label="Change status"
          style={{
            width: 32,
            height: 32,
            borderRadius: 5,
            border: "1px solid var(--border)",
            background: menuOpen ? "rgba(0,122,255,0.06)" : "rgba(255,255,255,0.7)",
            color: menuOpen ? "var(--accent)" : "var(--label)",
            cursor: disabled ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: disabled ? 0.5 : 1,
            transition: "background 0.15s ease, color 0.15s ease",
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="12" cy="19" r="1.8" />
          </svg>
        </button>

        {menuOpen && (
          <div
            className="menu-pop"
            style={{
              position: "absolute",
              right: 0,
              top: 38,
              width: feedbackFor ? 220 : 200,
              background: "var(--card-bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
              padding: feedbackFor ? "8px" : 5,
            }}
          >
            {feedbackFor ? (
              <>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--muted)",
                    padding: "4px 8px 6px",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 500,
                  }}
                >
                  Why {feedbackFor}?
                </div>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={
                    feedbackFor === "approved"
                      ? "quick reason…"
                      : "why passing…"
                  }
                  rows={2}
                  disabled={busy === "feedback"}
                  style={{
                    width: "100%",
                    resize: "none",
                    padding: "8px 9px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.8)",
                    fontSize: 12.5,
                    lineHeight: 1.45,
                    color: "var(--body)",
                    fontFamily: "inherit",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    padding: "8px 4px 2px",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    className="menu-item"
                    onClick={skipFeedback}
                    disabled={busy === "feedback"}
                    style={{
                      width: "auto",
                      padding: "6px 10px",
                      fontSize: 12,
                      color: "var(--label)",
                    }}
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={sendFeedback}
                    disabled={busy === "feedback" || !feedback.trim()}
                    style={{
                      height: 28,
                      padding: "0 10px",
                      borderRadius: 5,
                      border: "none",
                      background: "var(--accent)",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor:
                        busy === "feedback" || !feedback.trim()
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        busy === "feedback" || !feedback.trim() ? 0.5 : 1,
                    }}
                  >
                    {busy === "feedback" ? "…" : "Send"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--muted)",
                    padding: "5px 10px 3px",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 500,
                  }}
                >
                  Change status
                </div>
                {MENU_ITEMS.filter((m) => m.value !== status).map((m) => (
                  <button
                    key={m.value}
                    className="menu-item"
                    onClick={() => handleStatusClick(m.value)}
                    style={{
                      color: m.accent,
                      fontSize: 13,
                      fontWeight: 400,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: m.accent,
                        flexShrink: 0,
                      }}
                    />
                    {m.label}
                  </button>
                ))}

                <div
                  style={{
                    fontSize: 10.5,
                    color: "var(--muted)",
                    padding: "8px 8px 3px",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 500,
                    borderTop: "1px solid var(--border)",
                    marginTop: 4,
                  }}
                >
                  Outreach
                </div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={toggleStealth}
                  disabled={busy === "stealth"}
                  style={{ fontSize: 13, fontWeight: 400 }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: stealth ? "#8e44ad" : "var(--label)",
                      flexShrink: 0,
                    }}
                  />
                  {stealth ? "Unmark stealth" : "Mark stealth"}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => cycleChannel("linkedin_status", linkedinStatus)}
                  disabled={busy === "linkedin_status"}
                  style={{ fontSize: 13, fontWeight: 400 }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: "var(--label)",
                      flexShrink: 0,
                    }}
                  />
                  LinkedIn: {CHANNEL_LABEL[linkedinStatus]}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => cycleChannel("email_status", emailStatus)}
                  disabled={busy === "email_status"}
                  style={{ fontSize: 13, fontWeight: 400 }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: "var(--label)",
                      flexShrink: 0,
                    }}
                  />
                  Email: {CHANNEL_LABEL[emailStatus]}
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={logFollowup}
                  disabled={busy === "followup" || followupCount >= MAX_FOLLOWUP_COUNT}
                  style={{ fontSize: 13, fontWeight: 400 }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 999,
                      background: followupCount > 0 ? "#b26a00" : "var(--label)",
                      flexShrink: 0,
                    }}
                  />
                  Log follow-up{followupCount > 0 ? ` (${followupCount})` : ""}
                </button>
                {followupCount > 0 && (
                  <button
                    type="button"
                    className="menu-item"
                    onClick={clearFollowups}
                    disabled={busy === "followup"}
                    style={{ fontSize: 13, fontWeight: 400, color: "var(--muted)" }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 999,
                        background: "var(--muted)",
                        flexShrink: 0,
                      }}
                    />
                    Clear follow-ups
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
