/** Lightweight sessionStorage/localStorage helpers — session survives route changes and
 * clears on tab close, local persists across tabs/sessions. */

function read<T>(pick: (w: Window) => Storage, key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = pick(window).getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(pick: (w: Window) => Storage, key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    pick(window).setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export const readSession = <T>(key: string, fallback: T): T =>
  read((w) => w.sessionStorage, key, fallback);
export const writeSession = (key: string, value: unknown): void =>
  write((w) => w.sessionStorage, key, value);

export const readLocal = <T>(key: string, fallback: T): T =>
  read((w) => w.localStorage, key, fallback);
export const writeLocal = (key: string, value: unknown): void =>
  write((w) => w.localStorage, key, value);
