// One field for a window of days: it opens a calendar of two months (one on a narrow window); the first click
// picks one end, the second the other. Days outside min–max cannot be picked. Arrows move between days,
// PageUp/PageDown between months, Enter picks.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePopover } from "./popover.tsx";

const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const monthOf = (d: string) => d.slice(0, 7);
const addMonths = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number), k = y * 12 + mo - 1 + n; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; };
const clamp = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);

// The weeks of a month, Monday first, with null for the days of the neighbouring months.
function weeks(m: string) {
  const first = m + "-01", lead = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7;
  const n = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

type Props = {
  from: string; to: string; min: string; max: string; onChange: (from: string, to: string) => void;
  locale: string; weekdays: readonly string[]; label: string; prevLabel: string; nextLabel: string;
};

export function DateRange({ from, to, min, max, onChange, locale, weekdays, label, prevLabel, nextLabel }: Props) {
  const p = usePopover();
  const [count, setCount] = useState(2);
  const [start, setStart] = useState(monthOf(to)); // the first month shown
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState(to);
  const grid = useRef<HTMLDivElement>(null);
  const short = (d: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  const monthName = (m: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(m + "-01T00:00:00Z"));
  const longDay = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

  useEffect(() => {
    if (!p.open) return;
    const n = document.documentElement.clientWidth < 640 ? 1 : 2;
    setCount(n); setAnchor(null); setHover(null); setFocus(to);
    setStart(addMonths(monthOf(to), 1 - n) < monthOf(min) ? monthOf(min) : addMonths(monthOf(to), 1 - n));
  }, [p.open]);
  useEffect(() => { if (p.open) grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus(); }, [focus, p.open, start]);

  const months = Array.from({ length: count }, (_, i) => addMonths(start, i));
  const pick = (d: string) => {
    if (!anchor) { setAnchor(d); setFocus(d); return; }
    onChange(anchor < d ? anchor : d, anchor < d ? d : anchor);
    p.close();
  };
  // Keeps the focused day on screen by moving the shown months with it.
  const moveTo = (d: string) => {
    const day = clamp(d, min, max), m = monthOf(day);
    if (m < start) setStart(m); else if (m > addMonths(start, count - 1)) setStart(addMonths(m, 1 - count));
    setFocus(day);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) { e.preventDefault(); moveTo(addDays(focus, step)); return; }
    if (e.key === "PageUp" || e.key === "PageDown") { e.preventDefault(); const d = new Date(focus + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + (e.key === "PageUp" ? -1 : 1)); moveTo(d.toISOString().slice(0, 10)); }
  };
  // The range drawn: the chosen window, or from the first click to the day under the pointer.
  const [lo, hi] = anchor ? [anchor < (hover ?? anchor) ? anchor : hover!, anchor < (hover ?? anchor) ? hover! : anchor] : [from, to];

  return (
    <div className="ctl range" ref={p.root}>
      <button ref={p.trigger} type="button" className="field pick" aria-haspopup="dialog" aria-expanded={p.open} aria-label={label} onClick={() => p.setOpen(!p.open)}>
        <svg className="cal" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="10" rx="2" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg>
        <span className="pv">{from === to ? short(from) : `${short(from)} – ${short(to)}`}</span>
      </button>
      {p.open ? (
        <div ref={p.pop} className="pop cal-pop" style={p.place} role="dialog" aria-label={label}>
          <div className="cal-nav">
            <button type="button" className="cal-step" aria-label={prevLabel} disabled={start <= monthOf(min)} onClick={() => setStart(addMonths(start, -1))}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 4l-4 4 4 4" /></svg></button>
            <button type="button" className="cal-step" aria-label={nextLabel} disabled={addMonths(start, count - 1) >= monthOf(max)} onClick={() => setStart(addMonths(start, 1))}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg></button>
          </div>
          <div className="cal-months" ref={grid} onKeyDown={onKey} onPointerLeave={() => setHover(null)}>
            {months.map((m) => (
              <div key={m} className="cal-month">
                <div className="cal-title">{monthName(m)}</div>
                <div className="cal-grid" role="grid">
                  <div className="cal-row" role="row">{weekdays.map((w) => <span key={w} className="cal-wd" role="columnheader">{w}</span>)}</div>
                  {weeks(m).map((week, i) => (
                    <div key={i} className="cal-row" role="row">
                      {week.map((d, k) => {
                        if (!d) return <span key={k} className="cal-day blank" role="gridcell" />;
                        const off = d < min || d > max, inside = d >= lo && d <= hi, end = d === lo || d === hi;
                        return (
                          <span key={d} role="gridcell" aria-selected={inside} className={`cal-cell${inside ? " in" : ""}${d === lo ? " lo" : ""}${d === hi ? " hi" : ""}`}>
                            <button type="button" data-day={d} className={`cal-day${end ? " end" : ""}${d === max ? " today" : ""}`} disabled={off} tabIndex={d === focus ? 0 : -1} aria-label={longDay(d)}
                              onClick={() => pick(d)} onPointerEnter={() => anchor && setHover(d)} onFocus={() => anchor && setHover(d)}>
                              {Number(d.slice(8))}
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
