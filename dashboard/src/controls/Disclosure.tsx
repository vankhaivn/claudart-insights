// A section that opens and closes under a button whose chevron turns with it.
import { useId, useState, type ReactNode } from "react";

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="disclosure">
      <button type="button" className="disc" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>{label}
      </button>
      {open ? <div id={id}>{children}</div> : null}
    </div>
  );
}
