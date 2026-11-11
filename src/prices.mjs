// The price table in prices.md: USD per million tokens per model, each row in force from its date.
// It weighs requests to spread the host's cost, estimates a session the host left without a cost record,
// and checks the host's figures. It is never the source of a cost the host recorded.
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";

export const PRICE_COLUMNS = ["model", "from", "input", "output", "cache read", "cache write 5m", "cache write 1h"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function readPrices(config) {
  const path = basename(config.prices);
  const rows = [], errors = [];
  if (!existsSync(config.prices)) return { rows, errors };
  let header = null;
  readFileSync(config.prices, "utf8").split("\n").forEach((line, i) => {
    if (!line.trim().startsWith("|")) return;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (!header) {
      header = cells;
      if (cells.join("|") !== PRICE_COLUMNS.join("|")) errors.push(`${path}:${i + 1}: expected the columns ${PRICE_COLUMNS.join(", ")}`);
      return;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) return;
    const [model, from, ...nums] = cells;
    const p = nums.map(Number);
    if (cells.length !== PRICE_COLUMNS.length || !model || !DAY.test(from) || nums.some((n) => n === "") || p.some((n) => !Number.isFinite(n) || n < 0)) {
      errors.push(`${path}:${i + 1}: expected a model id, a YYYY-MM-DD date and five prices, got: ${line.trim()}`);
      return;
    }
    rows.push({ model, from, p });
  });
  return { rows, errors };
}

// The row in force for a model id on a local day; an id such as "x[1m]" falls back to "x".
export function priceAt(rows, model, day) {
  for (const id of [model, model.replace(/\[.*\]$/, "")]) {
    let hit = null;
    for (const r of rows) if (r.model === id && r.from <= day && (!hit || r.from > hit.from)) hit = r;
    if (hit) return hit;
    if (rows.some((r) => r.model === id)) return null;
  }
  return null;
}

// One request priced: a cache write without the 5m/1h split (older hosts) is priced as a 1h write,
// which is what the host's own figures for those records match on this machine.
export function requestCost(p, r) {
  const w1 = r.cache_write_1h ?? r.cache_write;
  const w5 = r.cache_write - w1;
  return (r.input * p[0] + r.output * p[1] + r.cache_read * p[2] + w5 * p[3] + w1 * p[4]) / 1e6;
}

// A host cost record's tokens for one model, priced; without the split, the range from all-5m to all-1h writes.
export function usageCost(p, u) {
  const base = (u.input * p[0] + u.output * p[1] + u.read * p[2]) / 1e6;
  if (u.split) return { lo: base + (u.w5 * p[3] + u.w1 * p[4]) / 1e6, hi: base + (u.w5 * p[3] + u.w1 * p[4]) / 1e6 };
  return { lo: base + (u.write * Math.min(p[3], p[4])) / 1e6, hi: base + (u.write * Math.max(p[3], p[4])) / 1e6 };
}

// Relative distance of the host's figure from the priced range; 0 inside it.
export function missOf(host, { lo, hi }) {
  if (host >= lo && host <= hi) return 0;
  const near = host < lo ? lo : hi;
  return Math.abs(host - near) / (host || 1);
}

// Least-squares prices per million tokens from host records: rows of [input, output, read, w5, w1] and cost.
// Only columns with tokens are solved; the rest are null. Needs at least two records per solved column.
export function fitPrices(records) {
  const X = records.map((u) => [u.input, u.output, u.read, u.w5, u.w1].map((v) => v / 1e6));
  const used = [0, 1, 2, 3, 4].filter((j) => X.some((x) => x[j] > 0));
  if (records.length < 2 * used.length) return null;
  const A = used.map(() => used.map(() => 0)), b = used.map(() => 0);
  X.forEach((x, k) => used.forEach((i, a) => { b[a] += x[i] * records[k].cost; used.forEach((j, c) => { A[a][c] += x[i] * x[j]; }); }));
  const n = used.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p], b[i], b[p]] = [A[p], A[i], b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; b[k] -= f * b[i]; }
  }
  const sol = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i][j] * sol[j]; sol[i] = s / A[i][i]; }
  const p = [null, null, null, null, null];
  used.forEach((i, a) => { p[i] = sol[a]; });
  const worst = Math.max(...X.map((x, k) => Math.abs(x.reduce((s, v, i) => s + v * (p[i] ?? 0), 0) - records[k].cost) / (records[k].cost || 1)));
  return { p, worst, n: records.length };
}

// The price check stored on each session by derive, gathered per model: misses above 1% and the first day of one.
export function priceReport(db) {
  const models = new Map();
  for (const s of db.prepare("SELECT id, title, price_check FROM sessions WHERE price_check IS NOT NULL").all()) {
    for (const [model, c] of Object.entries(JSON.parse(s.price_check))) {
      const m = models.get(model) ?? models.set(model, { model, checked: 0, misses: [], skipped: {} }).get(model);
      if (c.skipped) { m.skipped[c.skipped] = (m.skipped[c.skipped] ?? 0) + 1; continue; }
      m.checked++;
      if (c.miss > 0.01) m.misses.push({ id: s.id, title: s.title, day: c.day, host: c.host, lo: c.lo, hi: c.hi, miss: c.miss });
    }
  }
  const out = [...models.values()].sort((a, b) => a.model.localeCompare(b.model));
  for (const m of out) { m.misses.sort((a, b) => a.day.localeCompare(b.day)); m.since = m.misses[0]?.day ?? null; }
  return out;
}

// For `prices`: the table, the check per model, models seen in requests without a row, and fitted prices
// from every complete host record that splits its cache writes and ran no web search.
export function pricesView(db, config) {
  const { rows, errors } = readPrices(config);
  const last = db.prepare(`SELECT c.model_usage, c.incomplete FROM cost_states c JOIN files f ON f.id = c.file_id AND f.kind = 'main'
    WHERE c.line = (SELECT MAX(line) FROM cost_states d WHERE d.file_id = c.file_id)`).all();
  const samples = new Map();
  for (const c of last) {
    if (c.incomplete) continue;
    for (const [m, u] of Object.entries(JSON.parse(c.model_usage))) {
      if (u?.cost > 0 && u.split && !u.web) (samples.get(m) ?? samples.set(m, []).get(m)).push(u);
    }
  }
  const seen = db.prepare("SELECT model, MIN(day) first, MAX(day) last, COUNT(*) n FROM requests GROUP BY model").all();
  const unpriced = seen.filter((r) => !priceAt(rows, r.model, r.last));
  const fits = [...samples].sort((a, b) => a[0].localeCompare(b[0])).map(([model, list]) => ({ model, fit: fitPrices(list), sessions: list.length }));
  return { rows, errors, report: priceReport(db), unpriced, fits };
}
