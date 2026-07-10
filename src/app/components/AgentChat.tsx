"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  EmptyState,
  Link,
  Markdown,
  Spinner,
  Stack,
  Text,
  Timestamp,
} from "@astryxdesign/core";

const STORAGE_KEY = "agent-web-chat-history";

type Role = "user" | "assistant";
type ChatMsg = { role: Role; content: string; ts: number };

// Generative UI contract: assistant replies may embed fenced blocks like
// ```ui:startup\n{"name": "...", "website": "...", ...}\n``` or
// ```ui:iframe\n{"url": "...", "title": "..."}\n``` alongside normal markdown.
// Everything outside those blocks renders as plain Markdown.
type Segment =
  | { kind: "text"; value: string }
  | { kind: "startup"; data: Record<string, unknown> }
  | { kind: "iframe"; data: Record<string, unknown> };

const UI_BLOCK_RE = /```ui:([a-z0-9-]+)\n([\s\S]*?)```/g;

function parseSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  UI_BLOCK_RE.lastIndex = 0;
  while ((match = UI_BLOCK_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: content.slice(lastIndex, match.index) });
    }
    const [, blockType, rawBody] = match;
    try {
      const data = JSON.parse(rawBody);
      if (blockType === "startup") segments.push({ kind: "startup", data });
      else if (blockType === "iframe") segments.push({ kind: "iframe", data });
      else segments.push({ kind: "text", value: match[0] });
    } catch {
      segments.push({ kind: "text", value: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ kind: "text", value: content.slice(lastIndex) });
  }
  return segments;
}

function toHref(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

const STATUS_VARIANT: Record<string, "info" | "success" | "error" | "neutral"> = {
  new: "info",
  approved: "success",
  passed: "error",
};

function StartupPreviewCard({ data }: { data: Record<string, unknown> }) {
  const name = typeof data.name === "string" ? data.name : "Untitled";
  const oneLiner = typeof data.one_liner === "string" ? data.one_liner : undefined;
  const status = typeof data.status === "string" ? data.status : undefined;
  const website = typeof data.website === "string" ? data.website : undefined;
  const showEmbed = typeof data.embed === "boolean" ? data.embed : Boolean(website);

  return (
    <Card padding={3} maxWidth={380}>
      <Stack direction="vertical" hAlign="stretch" gap={2}>
        <Stack direction="horizontal" hAlign="between" vAlign="center" gap={2}>
          <Text type="label" size="sm" weight="semibold">
            {name}
          </Text>
          {status && <Badge label={status} variant={STATUS_VARIANT[status] ?? "neutral"} />}
        </Stack>
        {oneLiner && (
          <Text type="body" size="xsm" color="secondary">
            {oneLiner}
          </Text>
        )}
        {website && (
          <Link href={toHref(website)} target="_blank" rel="noreferrer">
            {website.replace(/^https?:\/\//, "")}
          </Link>
        )}
        {website && showEmbed && (
          <div
            style={{
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--color-border)",
              height: 160,
              background: "var(--color-background-surface)",
            }}
          >
            <iframe
              src={toHref(website)}
              title={name}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          </div>
        )}
      </Stack>
    </Card>
  );
}

function IframeCard({ data }: { data: Record<string, unknown> }) {
  const url = typeof data.url === "string" ? data.url : undefined;
  const title = typeof data.title === "string" ? data.title : url ?? "Preview";
  const height = typeof data.height === "number" ? data.height : 220;
  if (!url) return null;

  return (
    <Card padding={1} maxWidth={420}>
      <Stack direction="vertical" gap={1}>
        <Text type="supporting" size="xsm">
          {title}
        </Text>
        <div
          style={{
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid var(--color-border)",
            height,
          }}
        >
          <iframe
            src={toHref(url)}
            title={title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
            style={{ width: "100%", height: "100%", border: "none" }}
          />
        </div>
      </Stack>
    </Card>
  );
}

function AssistantContent({ content }: { content: string }) {
  const segments = useMemo(() => parseSegments(content), [content]);
  return (
    <Stack direction="vertical" gap={2}>
      {segments.map((seg, i) => {
        if (seg.kind === "text") {
          return seg.value.trim() ? <Markdown key={i}>{seg.value}</Markdown> : null;
        }
        if (seg.kind === "startup") return <StartupPreviewCard key={i} data={seg.data} />;
        return <IframeCard key={i} data={seg.data} />;
      })}
    </Stack>
  );
}

export default function AgentChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      // ignore malformed/unavailable storage
    }
  }, []);

  function persist(next: ChatMsg[]) {
    setMessages(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage quota/availability errors
    }
  }

  async function send(value: string) {
    const text = value.trim();
    if (!text || sending) return;
    setInput("");
    setError(null);
    const next = [...messages, { role: "user" as const, content: text, ts: Date.now() }];
    persist(next);
    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Chat request failed");
      persist([...next, { role: "assistant" as const, content: json.reply ?? "", ts: Date.now() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  function clearChat() {
    persist([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <Stack direction="vertical" gap={0} style={{ height: "calc(100vh - 220px)", minHeight: 420 }}>
      <Stack direction="horizontal" hAlign="between" vAlign="center" gap={2} style={{ marginBottom: 8 }}>
        <Text type="supporting" size="xsm">
          Separate from iMessage — this thread lives only in this browser.
        </Text>
        <Button variant="ghost" size="sm" label="Clear chat" clickAction={clearChat} />
      </Stack>

      <ChatLayout
        density="balanced"
        emptyState={
          <EmptyState
            title="Ask the agent anything"
            description="Dealflow questions, startup lookups, quick research — this chat is scoped to your browser."
          />
        }
        composer={
          <ChatComposer
            value={input}
            onChange={setInput}
            onSubmit={send}
            placeholder="Message the agent…"
            isDisabled={sending}
            status={error ? { type: "error", message: error } : undefined}
          />
        }
      >
        {messages.length === 0 && !sending ? null : (
        <ChatMessageList density="balanced">
          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              sender={m.role}
              avatar={m.role === "assistant" ? <Avatar name="Agent" size="small" /> : undefined}
            >
              {m.role === "assistant" ? (
                <ChatMessageBubble
                  variant="ghost"
                  metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.ts} format="time" />} />}
                >
                  <AssistantContent content={m.content} />
                </ChatMessageBubble>
              ) : (
                <ChatMessageBubble
                  metadata={<ChatMessageMetadata timestamp={<Timestamp value={m.ts} format="time" />} />}
                >
                  {m.content}
                </ChatMessageBubble>
              )}
            </ChatMessage>
          ))}
          {sending && (
            <ChatMessage sender="assistant" avatar={<Avatar name="Agent" size="small" />}>
              <ChatMessageBubble variant="ghost">
                <Spinner size="sm" />
              </ChatMessageBubble>
            </ChatMessage>
          )}
        </ChatMessageList>
        )}
      </ChatLayout>
    </Stack>
  );
}
