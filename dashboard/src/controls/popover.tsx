// Open state for a control with a popover: closes on a click outside it or on Escape, which returns focus to the trigger.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<T>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);

  // The popover opens under the trigger's left edge, moved left as far as it takes to stay 8 px inside the window.
  useLayoutEffect(() => {
    if (!open || !pop.current || !root.current) { setShift(0); return; }
    const left = root.current.getBoundingClientRect().left, room = document.documentElement.clientWidth - 8;
    setShift(Math.max(8 - left, Math.min(0, room - (left + pop.current.offsetWidth))));
  }, [open]);

  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus(); };
  return { open, setOpen, close, root, trigger, pop, place: { left: shift } };
}

export const Chevron = () => <svg className="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>;
