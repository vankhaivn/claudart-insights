// A dropdown of options: a button showing the chosen label and a listbox, driven by mouse or keyboard
// (arrows, Home/End, Enter or Space to pick, Escape to close, a letter to jump).
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Chevron, usePopover } from "./popover.tsx";

export type Option = { value: string; label: string };

export function Select({ value, options, onChange, label }: { value: string; options: Option[]; onChange: (v: string) => void; label: string }) {
  const p = usePopover();
  const id = useId();
  const chosen = Math.max(0, options.findIndex((o) => o.value === value));
  const [active, setActive] = useState(chosen);

  useEffect(() => { if (p.open) { setActive(chosen); p.pop.current?.focus(); } }, [p.open]);
  useEffect(() => { if (p.open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, p.open, id]);

  const pick = (k: number) => { onChange(options[k].value); p.close(); };
  const onKey = (e: KeyboardEvent) => {
    const last = options.length - 1;
    const move = { ArrowDown: (a: number) => a + 1, ArrowUp: (a: number) => a - 1, Home: () => 0, End: () => last, PageDown: (a: number) => a + 8, PageUp: (a: number) => a - 8 }[e.key];
    if (move) { e.preventDefault(); setActive((a) => Math.max(0, Math.min(last, move(a)))); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); return; }
    if (e.key === "Tab") { p.close(false); return; }
    if (e.key.length === 1) {
      const k = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      const wrap = k < 0 ? options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase())) : k;
      if (wrap >= 0) setActive(wrap);
    }
  };
  const onTriggerKey = (e: KeyboardEvent) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); p.setOpen(true); } };

  return (
    <div className="ctl" ref={p.root}>
      <button ref={p.trigger} type="button" className={`field pick${value !== options[0]?.value ? " on" : ""}`} aria-haspopup="listbox" aria-expanded={p.open} aria-label={label} onClick={() => p.setOpen(!p.open)} onKeyDown={onTriggerKey}>
        <span className="pv">{options[chosen]?.label}</span><Chevron />
      </button>
      {p.open ? (
        <div ref={p.pop} className="pop list" style={p.place} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${id}-${active}`} onKeyDown={onKey}>
          {options.map((o, k) => (
            <div key={o.value} id={`${id}-${k}`} role="option" aria-selected={k === chosen} className={`opt${k === active ? " active" : ""}`} onPointerEnter={() => setActive(k)} onClick={() => pick(k)}>
              <span>{o.label}</span>{k === chosen ? <svg className="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
