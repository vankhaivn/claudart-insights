// A text field for searching: a magnifier, the text, and a clear button once there is text; Escape clears too.
import { useRef } from "react";

export function Search({ value, onChange, placeholder, clearLabel }: { value: string; onChange: (v: string) => void; placeholder: string; clearLabel: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label className="field search">
      <svg className="mag" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
      <input ref={input} type="text" role="searchbox" spellCheck={false} autoComplete="off" placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); } }} />
      {value ? (
        <button type="button" className="clear" aria-label={clearLabel} onClick={() => { onChange(""); input.current?.focus(); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" /></svg>
        </button>
      ) : null}
    </label>
  );
}
