"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowUp, MessageSquarePlus, PanelLeft, Trash2, X } from "lucide-react";
import ChatMessageRow from "./chat/ChatMessageRow";
import {
  createThread,
  deleteThread,
  getActiveThread,
  loadChatStore,
  saveChatStore,
  selectThread,
  threadTitle,
  upsertThread,
  type ChatMessage,
  type ChatStore,
  type ChatThread,
} from "../../lib/chatSessions";
import type { ChatSSEEvent, ToolTraceEntry } from "../../lib/chatTypes";
import { useScrollMemory } from "../hooks/useScrollMemory";

const SUGGESTIONS = [
  { label: "What's new?", prompt: "What's new in dealflow?" },
  { label: "Approved pipeline", prompt: "Summarize the approved startups." },
  { label: "Research a company", prompt: "Help me research a startup — ask me which one." },
  { label: "Thesis check", prompt: "Remind me of our investment thesis in one short paragraph." },
];

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function AgentChat() {
  const [store, setStore] = useState<ChatStore | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [streamTick, setStreamTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinBottomRef = useRef(false);
  const switchingRef = useRef(false);

  const active = store ? getActiveThread(store) : null;
  const messages = active?.messages ?? [];

  const { ref: scrollerRef, saveNow, scrollToBottom, restoreSaved } = useScrollMemory(
    active?.id ?? "none",
    [messages.length, sending, active?.id, streamTick],
    { shouldPinBottom: pinBottomRef.current, enabled: Boolean(active) }
  );

  useEffect(() => {
    setStore(loadChatStore());
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const commit = useCallback((next: ChatStore) => {
    setStore(next);
    saveChatStore(next);
  }, []);

  function handleNewChat() {
    if (!store) return;
    saveNow();
    pinBottomRef.current = false;
    switchingRef.current = true;
    const next = createThread(store);
    commit(next);
    setInput("");
    setError(null);
    setDrawerOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSelectThread(id: string) {
    if (!store || id === store.activeId) {
      setDrawerOpen(false);
      return;
    }
    saveNow();
    pinBottomRef.current = false;
    switchingRef.current = true;
    commit(selectThread(store, id));
    setError(null);
    setDrawerOpen(false);
    requestAnimationFrame(() => {
      restoreSaved();
      switchingRef.current = false;
    });
  }

  function handleDeleteThread(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (!store) return;
    if (!window.confirm("Delete this chat?")) return;
    saveNow();
    const next = deleteThread(store, id);
    pinBottomRef.current = false;
    switchingRef.current = true;
    commit(next);
    requestAnimationFrame(() => {
      restoreSaved();
      switchingRef.current = false;
    });
  }

  async function send(value?: string) {
    const text = (value ?? input).trim();
    if (!text || sending || !store || !active) return;
    setInput("");
    setError(null);
    if (inputRef.current) inputRef.current.style.height = "auto";

    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    const withUser = [...active.messages, userMsg];
    const titled = { ...active, messages: withUser, title: threadTitle(withUser), updatedAt: Date.now() };
    commit(upsertThread(selectThread(store, active.id), titled));

    pinBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom("smooth"));

    setSending(true);

    const threadId = active.id;
    const assistantTs = Date.now();
    let content = "";
    const trace: ToolTraceEntry[] = [];

    function flush() {
      setStore((prev) => {
        if (!prev) return prev;
        const thread = prev.threads.find((t) => t.id === threadId);
        if (!thread) return prev;
        const last = thread.messages[thread.messages.length - 1];
        const base = last && last.ts === assistantTs ? thread.messages.slice(0, -1) : thread.messages;
        const assistantMsg: ChatMessage = {
          role: "assistant",
          content,
          ts: assistantTs,
          trace: trace.length ? [...trace] : undefined,
        };
        const finalMessages = [...base, assistantMsg];
        const finalThread: ChatThread = {
          ...thread,
          messages: finalMessages,
          title: threadTitle(finalMessages),
          updatedAt: Date.now(),
        };
        const next = upsertThread(prev, finalThread);
        saveChatStore(next);
        return next;
      });
      setStreamTick((t) => t + 1);
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: withUser.map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          let event: ChatSSEEvent;
          try {
            event = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }

          if (event.type === "text_delta") {
            content += event.text;
            flush();
          } else if (event.type === "tool_call") {
            trace.push({
              id: event.tool_call_id,
              toolName: event.tool_name,
              args: event.args,
              status: "running",
            });
            flush();
          } else if (event.type === "tool_result") {
            const entry = trace.find((t) => t.id === event.tool_call_id);
            if (entry) {
              entry.status = "done";
              entry.result = event.result;
            }
            flush();
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }

      pinBottomRef.current = true;
      requestAnimationFrame(() => scrollToBottom("smooth"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const hydrated = store !== null;
  const empty = hydrated && messages.length === 0 && !sending;

  return (
    <div className="chat-page">
      {drawerOpen && (
        <>
          <button
            type="button"
            className="chat-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close chats"
          />
          <div className="chat-drawer animate-fade-in">
            <button type="button" className="chat-thread-card chat-thread-card-new" onClick={handleNewChat}>
              <MessageSquarePlus size={15} strokeWidth={2} />
              <span>New chat</span>
            </button>
            {(store?.threads ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                className={`chat-thread-card${t.id === store?.activeId ? " chat-thread-card-active" : ""}`}
                onClick={() => handleSelectThread(t.id)}
              >
                <span className="chat-thread-card-title">{t.title}</span>
                <span className="chat-thread-card-meta">
                  {t.messages.length > 0 ? formatWhen(t.updatedAt) : "Empty"}
                </span>
                {store && store.threads.length > 1 && (
                  <span
                    role="button"
                    tabIndex={-1}
                    className="chat-thread-card-delete"
                    onClick={(e) => handleDeleteThread(t.id, e)}
                    aria-label="Delete chat"
                  >
                    <Trash2 size={12} strokeWidth={2} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="chat-chrome">
        <button
          type="button"
          className="chat-icon-btn"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label="Other chats"
          title="Other chats"
        >
          <PanelLeft size={16} strokeWidth={2} />
        </button>
        <Link href="/" className="chat-icon-btn" aria-label="Exit chat" title="Exit chat">
          <X size={16} strokeWidth={2} />
        </Link>
      </div>

      <div className="chat-page-main">
        <div className="chat-messages" ref={scrollerRef}>
          {!hydrated ? null : empty ? (
            <div className="chat-empty">
              <div className="chat-empty-brand">VC Scout</div>
              <h1 className="chat-empty-title">Ask the agent</h1>
              <p className="chat-empty-sub">Dealflow, research, and pipeline — right here.</p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    className="chat-suggestion"
                    onClick={() => send(s.prompt)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="chat-thread">
              {messages.map((m, i) => (
                <ChatMessageRow
                  key={`${m.ts}-${i}`}
                  role={m.role}
                  content={m.content}
                  trace={m.trace}
                  onAction={send}
                />
              ))}
              {sending && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="chat-turn chat-turn-assistant">
                  <div className="chat-thinking">
                    <span className="live-dot chat-thinking-dot" />
                    <span>Working</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {error && <div className="chat-error">{error}</div>}
          <div className="chat-composer-shell">
            <textarea
              ref={inputRef}
              value={input}
              onChange={onInputChange}
              onKeyDown={onKeyDown}
              placeholder="Message the agent…"
              disabled={sending}
              rows={1}
              className="chat-input"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="chat-send"
              aria-label="Send"
            >
              <ArrowUp size={17} strokeWidth={2.5} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
