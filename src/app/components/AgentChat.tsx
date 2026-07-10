"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUp, MessageSquarePlus, PanelLeft, Trash2 } from "lucide-react";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinBottomRef = useRef(false);
  const switchingRef = useRef(false);

  const active = store ? getActiveThread(store) : null;
  const messages = active?.messages ?? [];

  const { ref: scrollerRef, saveNow, scrollToBottom, restoreSaved } = useScrollMemory(
    active?.id ?? "none",
    [messages.length, sending, active?.id],
    { shouldPinBottom: pinBottomRef.current, enabled: Boolean(active) }
  );

  useEffect(() => {
    setStore(loadChatStore());
    if (window.matchMedia("(max-width: 768px)").matches) {
      setSidebarOpen(false);
    }
  }, []);

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
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSelectThread(id: string) {
    if (!store || id === store.activeId) return;
    saveNow();
    pinBottomRef.current = false;
    switchingRef.current = true;
    commit(selectThread(store, id));
    setError(null);
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
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: withUser.map(({ role, content }) => ({ role, content })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Chat request failed");

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: json.reply ?? "",
        ts: Date.now(),
      };
      const finalMessages = [...withUser, assistantMsg];
      const finalThread: ChatThread = {
        ...titled,
        messages: finalMessages,
        title: threadTitle(finalMessages),
        updatedAt: Date.now(),
      };
      setStore((prev) => {
        if (!prev) return prev;
        const next = upsertThread(selectThread(prev, active.id), finalThread);
        saveChatStore(next);
        return next;
      });
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
    <div className="chat-layout">
      <aside className={`chat-sidebar${sidebarOpen ? " chat-sidebar-open" : ""}`}>
        <div className="chat-sidebar-head">
          <Link href="/" className="chat-sidebar-back" title="Dealflow">
            <ArrowLeft size={15} strokeWidth={2} />
            <span>Dealflow</span>
          </Link>
          <button
            type="button"
            className="chat-sidebar-new"
            onClick={handleNewChat}
            title="New chat"
          >
            <MessageSquarePlus size={16} strokeWidth={2} />
            <span>New</span>
          </button>
        </div>
        <div className="chat-sidebar-list">
          {(store?.threads ?? []).map((t) => (
            <button
              key={t.id}
              type="button"
              className={`chat-sidebar-item${t.id === store?.activeId ? " chat-sidebar-item-active" : ""}`}
              onClick={() => handleSelectThread(t.id)}
            >
              <span className="chat-sidebar-item-title">{t.title}</span>
              <span className="chat-sidebar-item-meta">
                {t.messages.length > 0 ? formatWhen(t.updatedAt) : "Empty"}
              </span>
              {store && store.threads.length > 1 && (
                <span
                  role="button"
                  tabIndex={-1}
                  className="chat-sidebar-item-delete"
                  onClick={(e) => handleDeleteThread(t.id, e)}
                  aria-label="Delete chat"
                >
                  <Trash2 size={13} strokeWidth={2} />
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <div className="chat-page">
        <div className="chat-chrome">
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle chats"
            title="Chats"
          >
            <PanelLeft size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="chat-icon-btn"
            onClick={handleNewChat}
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus size={15} strokeWidth={2} />
          </button>
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
                    onAction={send}
                  />
                ))}
                {sending && (
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
    </div>
  );
}
