"use client";

import { useEffect, useRef } from "react";
import { readSession, writeSession } from "../../lib/persistedState";

const NEAR_BOTTOM_PX = 96;

export function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

/**
 * Persists scroll position per key. Restores on mount.
 * Optionally auto-scrolls to bottom when `shouldPinBottom` is true and user was near bottom.
 */
export function useScrollMemory(
  key: string,
  deps: unknown[],
  options?: {
    shouldPinBottom?: boolean;
    enabled?: boolean;
  }
) {
  const ref = useRef<HTMLDivElement>(null);
  const restoredRef = useRef(false);
  const prevKeyRef = useRef(key);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (prevKeyRef.current !== key) {
      restoredRef.current = false;
      prevKeyRef.current = key;
    }
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    if (!restoredRef.current) {
      const saved = readSession<number>(`scroll:${key}`, 0);
      el.scrollTop = saved;
      restoredRef.current = true;
      return;
    }

    if (options?.shouldPinBottom && isNearBottom(el)) {
      el.scrollTop = el.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        writeSession(`scroll:${key}`, el.scrollTop);
      }, 120);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [key, enabled]);

  function saveNow() {
    const el = ref.current;
    if (el) writeSession(`scroll:${key}`, el.scrollTop);
  }

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    writeSession(`scroll:${key}`, el.scrollHeight);
  }

  function restoreSaved() {
    const el = ref.current;
    if (!el) return;
    const saved = readSession<number>(`scroll:${key}`, 0);
    el.scrollTop = saved;
  }

  return { ref, saveNow, scrollToBottom, restoreSaved };
}
