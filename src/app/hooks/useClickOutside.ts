import { useEffect, useRef } from "react";

/** Closes on any mousedown outside the returned ref's element. `active` gates the
 * listener so it's only attached while the menu/popover is actually open. */
export function useClickOutside<T extends HTMLElement>(active: boolean, onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [active, onOutside]);
  return ref;
}
