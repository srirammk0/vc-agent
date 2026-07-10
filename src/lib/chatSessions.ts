import { readLocal, writeLocal } from "./persistedState";

const STORE_KEY = "agent-web-chats-v2";
const LEGACY_KEY = "agent-web-chat-history";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
  ts: number;
};

export type ChatThread = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  scrollTop: number;
};

export type ChatStore = {
  version: 2;
  activeId: string;
  threads: ChatThread[];
};

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function threadTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 42 ? `${t.slice(0, 42).trimEnd()}…` : t;
}

export function emptyThread(): ChatThread {
  const id = newId();
  const now = Date.now();
  return { id, title: "New chat", messages: [], updatedAt: now, scrollTop: 0 };
}

function migrateLegacy(): ChatStore | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const messages = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(messages) || messages.length === 0) return null;
    const thread: ChatThread = {
      id: newId(),
      title: threadTitle(messages),
      messages,
      updatedAt: messages[messages.length - 1]?.ts ?? Date.now(),
      scrollTop: 0,
    };
    localStorage.removeItem(LEGACY_KEY);
    return { version: 2, activeId: thread.id, threads: [thread] };
  } catch {
    return null;
  }
}

export function loadChatStore(): ChatStore {
  const stored = readLocal<ChatStore | null>(STORE_KEY, null);
  if (stored?.version === 2 && stored.threads.length > 0) {
    return stored;
  }
  const migrated = migrateLegacy();
  if (migrated) {
    writeLocal(STORE_KEY, migrated);
    return migrated;
  }
  const thread = emptyThread();
  const store: ChatStore = { version: 2, activeId: thread.id, threads: [thread] };
  writeLocal(STORE_KEY, store);
  return store;
}

export function saveChatStore(store: ChatStore): void {
  writeLocal(STORE_KEY, store);
}

export function getActiveThread(store: ChatStore): ChatThread {
  return store.threads.find((t) => t.id === store.activeId) ?? store.threads[0];
}

export function upsertThread(store: ChatStore, thread: ChatThread): ChatStore {
  const idx = store.threads.findIndex((t) => t.id === thread.id);
  const threads =
    idx === -1
      ? [thread, ...store.threads]
      : store.threads.map((t) => (t.id === thread.id ? thread : t));
  threads.sort((a, b) => b.updatedAt - a.updatedAt);
  return { ...store, threads };
}

export function createThread(store: ChatStore): ChatStore {
  const thread = emptyThread();
  return {
    version: 2,
    activeId: thread.id,
    threads: [thread, ...store.threads],
  };
}

export function deleteThread(store: ChatStore, id: string): ChatStore {
  const threads = store.threads.filter((t) => t.id !== id);
  if (threads.length === 0) {
    const thread = emptyThread();
    return { version: 2, activeId: thread.id, threads: [thread] };
  }
  const activeId = store.activeId === id ? threads[0].id : store.activeId;
  return { ...store, activeId, threads };
}

export function selectThread(store: ChatStore, id: string): ChatStore {
  if (!store.threads.some((t) => t.id === id)) return store;
  return { ...store, activeId: id };
}
