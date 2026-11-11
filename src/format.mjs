// Plain text tables for the terminal; --json prints the same rows instead.
export const int = (n) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));
export const usd = (n) => (n === null || n === undefined ? "unknown" : `$${n.toFixed(2)}`);
export const pct = (n) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);
export const minutes = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}m` : `${Math.round(m)}m`);

// "YYYY-MM-DD HH:MM" of an ISO instant in the given time zone.
export function localTime(timeZone) {
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return (iso) => (iso ? f.format(new Date(iso)) : "");
}

// columns: [header, (row) => text, "r" for right-aligned]
export function table(rows, columns) {
  const cells = [columns.map(([h]) => h), ...rows.map((r) => columns.map(([, f]) => String(f(r) ?? "")))];
  const width = columns.map((_, i) => Math.max(...cells.map((c) => [...c[i]].length)));
  const pad = (text, i) => (columns[i][2] === "r" ? text.padStart(width[i]) : text.padEnd(width[i]));
  return cells.map((c) => c.map(pad).join("  ").trimEnd()).join("\n");
}
