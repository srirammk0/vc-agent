"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { readSession, writeSession } from "../../lib/persistedState";

function scrollKey(pathname: string): string {
  return `scroll:page:${pathname}`;
}

/** Restores window scroll per route and saves it while browsing. */
export default function ScrollRestoration() {
  const pathname = usePathname();
  const readyRef = useRef(false);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    const key = scrollKey(pathname);
    const y = readSession<number>(key, 0);
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
      readyRef.current = true;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (!readyRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => writeSession(key, window.scrollY), 120);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      if (readyRef.current) writeSession(key, window.scrollY);
      readyRef.current = false;
    };
  }, [pathname]);

  return null;
}
