"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowUp, CalendarClock, MessageSquarePlus, PanelLeft, Trash2, X, Square } from "lucide-react";
import ChatMessageRow from "./chat/ChatMessageRow";
import ScheduledRunsModal from "./ScheduledRunsModal";
import { useEscapeKey } from "../hooks/useEscapeKey";
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
  // The real source of truth for commit() — a plain ref, not React state. A
  // background send()/flush() keeps running after this component unmounts (e.g.
  // navigating to "/" mid-reply doesn't cancel the underlying fetch), but React
  // is free to skip invoking a setState updater callback on an unmounted
  // component entirely — which used to mean saveChatStore() (inside that
  // callback) might never run, silently losing whatever the agent produced
  // after you left the page. Reading/writing storeRef is a plain synchronous
  // assignment, so it — and the persistence that depends on it — always
  // happens regardless of mount state.
  const storeRef = useRef<ChatStore | null>(null);
  const [input, setInput] = useState("");
  // Per-thread, not global — lets you send in one conversation while another
  // is still streaming a reply in the background.
  const [sendingThreads, setSendingThreads] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [streamTick, setStreamTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinBottomRef = useRef(false);
  const switchingRef = useRef(false);
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const active = store ? getActiveThread(store) : null;
  const messages = active?.messages ?? [];
  const sending = active ? sendingThreads.has(active.id) : false;
  const error = active ? errors.get(active.id) ?? null : null;

  function stop() {
    if (!active) return;
    abortControllersRef.current.get(active.id)?.abort();
  }

  const { ref: scrollerRef, saveNow, scrollToBottom, restoreSaved } = useScrollMemory(
    active?.id ?? "none",
    [messages.length, sending, active?.id, streamTick],
    { shouldPinBottom: pinBottomRef.current, enabled: Boolean(active) }
  );

  // Always-current mirror of the visible thread id, for background streams
  // (from a different, non-visible thread) to check before touching scroll.
  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = active?.id ?? null;
  }, [active?.id]);

  useEffect(() => {
    const loaded = loadChatStore();
    storeRef.current = loaded;
    setStore(loaded);
  }, []);

  useEscapeKey(drawerOpen, () => setDrawerOpen(false));

  // Applies against storeRef (always current, plain-assignment-only — see its
  // declaration above), not a render-time snapshot — required because a
  // background thread's flush() can update the store concurrently with a
  // foreground action (send/switch/delete) on a different thread, AND because
  // this must keep persisting correctly even after the component that started
  // it has unmounted (left the /chat page mid-reply). saveChatStore/storeRef
  // are plain statements that always run; setStore is only there to trigger a
  // re-render for a still-mounted instance and is safe to no-op otherwise.
  const commit = useCallback((updater: ChatStore | ((prev: ChatStore) => ChatStore)) => {
    const prev = storeRef.current;
    if (!prev) return;
    const next = typeof updater === "function" ? updater(prev) : updater;
    storeRef.current = next;
    saveChatStore(next);
    setStore(next);
  }, []);

  function handleNewChat() {
    if (!store) return;
    saveNow();
    pinBottomRef.current = false;
    switchingRef.current = true;
    commit(createThread);
    setInput("");
    setDrawerOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSelectThread(id: string) {
    if (!store || id === store.activeId) {
      setDrawerOpen(false);
      return;
    }
    saveNow();
    const enteringLive = sendingThreads.has(id);
    pinBottomRef.current = enteringLive;
    switchingRef.current = true;
    commit((prev) => selectThread(prev, id));
    setDrawerOpen(false);
    requestAnimationFrame(() => {
      if (enteringLive) {
        scrollToBottom();
      } else {
        restoreSaved();
      }
      switchingRef.current = false;
    });
  }

  function handleDeleteThread(id: string, e: MouseEvent) {
    e.stopPropagation();
    if (!store) return;
    if (!window.confirm("Delete this chat?")) return;
    abortControllersRef.current.get(id)?.abort();
    abortControllersRef.current.delete(id);
    setSendingThreads((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setErrors((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    saveNow();
    pinBottomRef.current = false;
    switchingRef.current = true;
    commit((prev) => deleteThread(prev, id));
    requestAnimationFrame(() => {
      restoreSaved();
      switchingRef.current = false;
    });
  }

  async function send(value?: string) {
    const text = (value ?? input).trim();
    if (!text || sending || !store || !active) return;
    const threadId = active.id;
    setInput("");
    setErrors((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Map(prev);
      next.delete(threadId);
      return next;
    });
    if (inputRef.current) inputRef.current.style.height = "auto";

    const userMsg: ChatMessage = { role: "user", content: text, ts: Date.now() };
    const withUser = [...active.messages, userMsg];
    const titled = { ...active, messages: withUser, title: threadTitle(withUser), updatedAt: Date.now() };
    commit((prev) => upsertThread(selectThread(prev, threadId), titled));

    pinBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom("smooth"));

    setSendingThreads((prev) => new Set(prev).add(threadId));

    const assistantTs = Date.now();
    const baseLength = withUser.length; // messages before the streaming reply — never inferred from ts, which can collide with userMsg.ts at ms resolution
    let content = "";
    const trace: ToolTraceEntry[] = [];

    function flush() {
      commit((prev) => {
        const thread = prev.threads.find((t) => t.id === threadId);
        if (!thread) return prev;
        const base = thread.messages.slice(0, baseLength);
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
        return upsertThread(prev, finalThread);
      });
      // Only bump the pane's redraw tick if this flush belongs to the thread
      // currently on screen — otherwise a background thread's tokens would
      // yank the visible (unrelated) conversation's scroll position.
      if (threadId === activeIdRef.current) setStreamTick((t) => t + 1);
    }

    const controller = new AbortController();
    abortControllersRef.current.set(threadId, controller);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: withUser.map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error || "Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawTerminal = false; // true once a "done" or "error" event arrives — if the
      // stream ends without one, the connection dropped mid-response (e.g. a server-side
      // timeout that killed the connection before it could send anything), and the user
      // should see that instead of a chat that silently "just stopped."

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
            sawTerminal = true;
            setErrors((prev) => new Map(prev).set(threadId, event.message));
          } else if (event.type === "done") {
            sawTerminal = true;
          }
        }
      }

      if (!sawTerminal) {
        setErrors((prev) => new Map(prev).set(threadId, "connection dropped mid-response — try again"));
      }

      if (threadId === activeIdRef.current) {
        pinBottomRef.current = true;
        requestAnimationFrame(() => scrollToBottom("smooth"));
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // Request aborted by user
      } else {
        setErrors((prev) =>
          new Map(prev).set(threadId, e instanceof Error ? e.message : "Something went wrong")
        );
      }
    } finally {
      abortControllersRef.current.delete(threadId);
      setSendingThreads((prev) => {
        const next = new Set(prev);
        next.delete(threadId);
        return next;
      });
      if (threadId === activeIdRef.current) inputRef.current?.focus();
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
                  {sendingThreads.has(t.id) ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span className="live-dot" style={{ width: 5, height: 5, borderRadius: 999, background: "var(--accent)" }} />
                      Working
                    </span>
                  ) : t.messages.length > 0 ? (
                    formatWhen(t.updatedAt)
                  ) : (
                    "Empty"
                  )}
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => setScheduledOpen(true)}
            aria-label="Scheduled runs"
            title="Scheduled runs"
          >
            <CalendarClock size={16} strokeWidth={2} />
          </button>
          <Link href="/" className="chat-icon-btn" aria-label="Exit chat" title="Exit chat">
            <X size={16} strokeWidth={2} />
          </Link>
        </div>
      </div>

      {scheduledOpen && <ScheduledRunsModal onClose={() => setScheduledOpen(false)} />}

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
          <div className="chat-composer-inner">
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
              {sending ? (
                <button
                  type="button"
                  onClick={stop}
                  className="chat-send chat-stop"
                  aria-label="Stop generating"
                >
                  <Square size={12} fill="currentColor" strokeWidth={0} />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="chat-send"
                  aria-label="Send"
                >
                  <ArrowUp size={17} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
