"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreVertical } from "lucide-react";
import { Button, IconButton, Popover, Stack, TextArea } from "@astryxdesign/core";
import { useEnrichmentPoll } from "../hooks/useEnrichmentPoll";
import { showEnrichButton } from "../../lib/enrichment";
import type { Founder } from "../../lib/supabase";

type Status = "new" | "approved" | "passed";

type Props = {
  slug: string;
  name: string;
  status: Status;
  enrichmentStatus: "pending" | "running" | "complete";
  companyDescription: string | null;
  founders: Founder[] | null;
};

const MENU_ITEMS: { value: Status; label: string }[] = [
  { value: "approved", label: "Mark approved" },
  { value: "passed", label: "Mark passed" },
  { value: "new", label: "Mark new" },
];

export default function StartupActions({
  slug,
  name,
  status,
  enrichmentStatus,
  companyDescription,
  founders,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedbackFor, setFeedbackFor] = useState<Status | null>(null);
  const [feedback, setFeedback] = useState("");

  useEnrichmentPoll(slug, enrichmentStatus);

  function closeMenu(open: boolean) {
    setMenuOpen(open);
    if (!open) {
      setFeedbackFor(null);
      setFeedback("");
    }
  }

  const enrichVisible = showEnrichButton({
    status,
    enrichment_status: enrichmentStatus,
    company_description: companyDescription,
    founders,
    stage: null,
    raised: null,
    location: null,
    founded: null,
    team_size: null,
  });

  async function setStatusQuick(next: Status) {
    closeMenu(false);
    setBusy(next);
    await fetch(`/api/startup/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(null);
    router.refresh();
  }

  function handleStatusClick(next: Status) {
    if (next === "new") {
      setStatusQuick(next);
      return;
    }
    setFeedbackFor(next);
    setFeedback("");
  }

  async function skipFeedback() {
    if (!feedbackFor) return;
    await setStatusQuick(feedbackFor);
  }

  async function sendFeedback() {
    if (!feedbackFor || !feedback.trim()) return;
    setBusy("feedback");
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        name,
        status: feedbackFor,
        message: feedback.trim(),
      }),
    });
    setBusy(null);
    closeMenu(false);
    router.refresh();
  }

  async function enrich() {
    setBusy("enrich");
    await fetch(`/api/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name }),
    });
    setBusy(null);
    router.refresh();
  }

  const disabled = busy !== null;

  return (
    <Stack direction="horizontal" gap={2} vAlign="center">
      {enrichVisible && (
        <Button
          label={busy === "enrich" ? "Enriching…" : "Enrich"}
          variant="primary"
          size="sm"
          isDisabled={disabled}
          isLoading={busy === "enrich"}
          clickAction={enrich}
        />
      )}

      <Popover
        isOpen={menuOpen}
        onOpenChange={closeMenu}
        label={feedbackFor ? `Why ${feedbackFor}?` : "Change status"}
        placement="below"
        alignment="end"
        content={
          feedbackFor ? (
            <Stack direction="vertical" gap={2} style={{ width: 220 }}>
              <TextArea
                label={`Why ${feedbackFor}?`}
                isLabelHidden
                value={feedback}
                changeAction={(v) => setFeedback(v)}
                placeholder={feedbackFor === "approved" ? "quick reason…" : "why passing…"}
                size="sm"
                isDisabled={busy === "feedback"}
              />
              <Stack direction="horizontal" hAlign="end" gap={2}>
                <Button
                  label="Skip"
                  variant="ghost"
                  size="sm"
                  clickAction={skipFeedback}
                  isDisabled={busy === "feedback"}
                />
                <Button
                  label={busy === "feedback" ? "Sending…" : "Send"}
                  variant="primary"
                  size="sm"
                  clickAction={sendFeedback}
                  isDisabled={busy === "feedback" || !feedback.trim()}
                />
              </Stack>
            </Stack>
          ) : (
            <Stack direction="vertical" gap={0} style={{ width: 176 }}>
              {MENU_ITEMS.filter((m) => m.value !== status).map((m) => (
                <Button
                  key={m.value}
                  label={m.label}
                  variant="ghost"
                  size="sm"
                  clickAction={() => handleStatusClick(m.value)}
                />
              ))}
            </Stack>
          )
        }
      >
        <IconButton
          label="Change status"
          icon={<MoreVertical size={14} />}
          variant="ghost"
          size="sm"
          isDisabled={disabled}
        />
      </Popover>
    </Stack>
  );
}
