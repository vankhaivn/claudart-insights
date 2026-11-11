// Number, money, date and duration formats for the page's language.
import type { Metric, Session } from "./model.ts";

export type Fmt = ReturnType<typeof makeFmt>;

export function makeFmt(lang: "vi" | "en") {
  const loc = lang === "vi" ? "vi-VN" : "en-GB";
  const cmp = (n: number) => {
    const [d, u] = n >= 1e9 ? [1e9, "B"] : n >= 1e6 ? [1e6, "M"] : n >= 1e3 ? [1e3, "K"] : [1, ""], v = n / (d as number);
    return new Intl.NumberFormat(loc, { maximumFractionDigits: !u || v >= 100 ? 0 : v >= 10 ? 1 : 2 }).format(v) + u;
  };
  const int = (n: number) => new Intl.NumberFormat(loc).format(Math.round(n));
  const usd = (n: number) => { const d = n >= 100 || Number.isInteger(n) ? 0 : 2; return "$" + new Intl.NumberFormat(loc, { maximumFractionDigits: d, minimumFractionDigits: d }).format(n); };
  const pct = (n: number) => new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: n > 0 && n < 0.1 ? 1 : 0 }).format(n);
  const dshort = (d: string) => new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));
  return {
    locale: loc, cmp, int, usd, pct, dshort,
    month: (d: string) => new Intl.DateTimeFormat(loc, { month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z")),
    // Minutes rounded first, so 59.6 reads 1h 00m, not 0h 60m or 60m.
    dur: (m: number) => { const r = Math.round(m); return r >= 60 ? Math.floor(r / 60) + "h " + String(r % 60).padStart(2, "0") + "m" : r + "m"; },
    fmt: (metric: Metric, v: number) => (metric === "cost" ? usd(v) : metric === "sess" ? int(v) : cmp(v)),
    usd3: (n: number) => "$" + new Intl.NumberFormat(loc, { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n),
    dec: (n: number) => new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(n),
    times: (n: number) => new Intl.NumberFormat(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n) + "×",
    startText: (x: Session) => `${dshort(x.day)} ${String(x.hour).padStart(2, "0")}:${String(x.min).padStart(2, "0")}`,
    // The time alone for a scan today, with the date otherwise.
    scanTime: (iso: string) => { const d = new Date(iso); return new Intl.DateTimeFormat(loc, d.toDateString() === new Date().toDateString() ? { hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(d); },
  };
}
