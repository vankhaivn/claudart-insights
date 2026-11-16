// Compactions, the cost of reading the context by its size, and a replay of the same requests under other compaction
// points. loadRows in usage.mjs calls these per session; the rows they return are summed by the page under any filter.
import { priceAt, usageKinds } from "./prices.mjs";

// Context per request in buckets: under 50K, 50–100K, 100–200K, 200–300K, 300–400K, 400–600K, 600K and over.
export const EDGES = [50e3, 100e3, 200e3, 300e3, 400e3, 600e3];
export const BUCKETS = EDGES.length + 1;
export const bucketOf = (ctx) => { let k = 0; while (k < EDGES.length && ctx >= EDGES[k]) k++; return k; };
export const contextOf = (r) => r.input + r.cache_read + r.cache_write;

// The points a session is replayed at, in tokens of context; the last is where a native 1M model compacts by default.
// The replay adds one more point: where compaction fires now.
export const POINTS = [200e3, 250e3, 300e3, 350e3, 400e3, 500e3, 600e3, 800e3, 967e3];
export const REPLAY = POINTS.length + 1; // the points, then now
export const PARTS = 4; // per point: compactions, reading the context, compacting, rebuilds after idle

export const median = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b), m = v.length >> 1;
  return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : null;
};
const byTime = (a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.line - b.line;
const LAST = 5; // compactions that tell where compaction fires now
const TAIL = 15; // requests after a session's last compaction under which it ended soon after

// One session's compactions, each with the requests around it on its own thread. reqs: the session's requests;
// comps: its rows of the compactions table; owners: the timestamps of its owner messages.
export function compactionsOf(reqs, comps, owners) {
  const threads = new Map();
  for (const r of reqs) (threads.get(r.agent_id ?? "") ?? threads.set(r.agent_id ?? "", []).get(r.agent_id ?? "")).push(r);
  for (const list of threads.values()) list.sort(byTime);
  const turns = owners.map((ts) => Date.parse(ts)).sort((a, b) => a - b);
  const out = [];
  const byThread = new Map();
  for (const c of comps) if (c.ts) (byThread.get(c.agent_id ?? "") ?? byThread.set(c.agent_id ?? "", []).get(c.agent_id ?? "")).push(c);
  for (const [agent, list] of byThread) {
    list.sort(byTime);
    const rs = threads.get(agent) ?? [];
    const at = rs.map((r) => Date.parse(r.ts));
    list.forEach((c, k) => {
      const t = Date.parse(c.ts), next = list[k + 1] ? Date.parse(list[k + 1].ts) : Infinity;
      const after = at.findIndex((x) => x > t), i = after < 0 ? rs.length : after;
      const before = rs[i - 1] ?? null, first = rs[i] ?? null;
      const span = at.filter((x) => x > t && x < next).length;
      out.push({
        c, sub: agent !== "", before, after: first, nth: k + 1,
        // Requests and owner turns up to the next compaction on the thread; for the last one, the requests that followed.
        next: k + 1 < list.length ? span : null, tail: k + 1 < list.length ? null : span,
        turns: agent === "" && k + 1 < list.length ? turns.filter((x) => x > t && x < next).length : null,
      });
    });
  }
  return out;
}

// What the request that writes each summary cost. It leaves no record in the transcript, so per model it is the host's
// tokens less the transcript's, priced as a share of the host's cost and split evenly over that model's compactions.
// rows: compactionsOf's rows; tokens, costs: the session's host record per model; targets(key): the requests of a model key.
export function summaryCosts(rows, tokens, costs, targets, prices, day) {
  const out = new Map();
  for (const [key, u] of Object.entries(tokens ?? {})) {
    const reqs = targets(key), mine = rows.filter((x) => x.before && reqs.includes(x.before));
    const row = priceAt(prices, key, day);
    if (!mine.length || !row || !costs?.[key]) continue;
    const sum = (k) => reqs.reduce((n, r) => n + (k(r) ?? 0), 0);
    const w1 = sum((r) => r.cache_write_1h ?? r.cache_write);
    const hidden = {
      input: Math.max(0, u.input - sum((r) => r.input)), output: Math.max(0, u.output - sum((r) => r.output)), read: Math.max(0, u.read - sum((r) => r.cache_read)),
      write: Math.max(0, u.write - sum((r) => r.cache_write)), w1: Math.max(0, (u.w1 ?? 0) - w1), w5: Math.max(0, (u.w5 ?? 0) - (sum((r) => r.cache_write) - w1)), split: u.split,
    };
    const all = usageKinds(row.p, u).reduce((a, b) => a + b, 0), part = usageKinds(row.p, hidden).reduce((a, b) => a + b, 0);
    if (!all) continue;
    const each = (costs[key] * part) / all / mine.length;
    for (const x of mine) out.set(x, { cost: each, input: hidden.input / mine.length, output: hidden.output / mine.length, write: hidden.write / mine.length });
  }
  return out;
}

// Where compaction fires now per model family: the median context of the last auto compactions of the main thread.
// A family that never compacted takes the level of the family that compacted last, as one window usually serves all.
export function levelsOf(rows) {
  const auto = rows.filter((x) => !x.sub && x.c.trigger === "auto" && x.c.pre_tokens && x.before).sort((a, b) => byTime(a.c, b.c));
  const families = new Map();
  for (const x of auto) (families.get(x.before.family) ?? families.set(x.before.family, []).get(x.before.family)).push(x.c.pre_tokens);
  const levels = {};
  for (const [family, list] of families) levels[family] = Math.round(median(list.slice(-LAST)) / 1000) * 1000;
  const fallback = auto.length ? levels[auto.at(-1).before.family] : null;
  return { levels, fallback };
}

// What one compaction takes per model family, from the compactions recorded: the context it restarts at, the tokens the
// summary request writes beyond reading the context, and what the first request after it writes to the cache.
// Without a record of its own, a family takes these defaults.
const DEFAULTS = { restart: 106e3, input: 3800, output: 8600, write: 9100, rebuild: 53e3 };
export function constantsOf(rows, summaries) {
  const by = new Map();
  for (const x of rows) if (x.before) (by.get(x.before.family) ?? by.set(x.before.family, []).get(x.before.family)).push(x);
  const out = {};
  for (const [family, list] of by) {
    const s = list.map((x) => summaries.get(x)).filter(Boolean);
    const main = list.filter((x) => !x.sub && x.after);
    out[family] = {
      restart: median(main.map((x) => contextOf(x.after))) ?? DEFAULTS.restart,
      input: median(s.map((v) => v.input)) ?? DEFAULTS.input, output: median(s.map((v) => v.output)) ?? DEFAULTS.output,
      write: median(s.map((v) => v.write)) ?? DEFAULTS.write,
      rebuild: median(main.filter((x) => x.after.rebuild === "compaction").map((x) => x.after.cache_write)) ?? DEFAULTS.rebuild,
    };
  }
  return (family) => out[family] ?? DEFAULTS;
}

// The main thread replayed at each point: the context grows between requests as it did, a recorded compaction is taken
// out, a sharp drop that is not one (a rewind) is followed, and whenever the context reaches the point it compacts,
// charging the summary request and the rewrite after it, and restarts. Every request reads its context, and a request that
// rebuilt the cache after idle rewrites it. Returns per request a vector of REPLAY × PARTS.
// reqs: the main thread in order; compactions: their instants (ms); levelOf(family): where it fires now, or null.
export function replay(reqs, compactions, prices, constants, levelOf) {
  const out = new Map();
  if (!reqs.length) return out;
  const grows = [];
  for (let i = 1; i < reqs.length; i++) { const d = contextOf(reqs[i]) - contextOf(reqs[i - 1]); if (d > 0) grows.push(d); }
  const growth = median(grows) ?? 2000;
  const long = reqs.some((r) => r.cache_write_1h > 0);
  const cur = new Array(REPLAY).fill(contextOf(reqs[0]));
  for (let i = 0; i < reqs.length; i++) {
    const r = reqs[i], v = new Array(REPLAY * PARTS).fill(0), p = priceAt(prices, r.model, r.day)?.p ?? null, k = constants(r.family);
    if (i > 0) {
      const prev = contextOf(reqs[i - 1]), now = contextOf(r), t0 = Date.parse(reqs[i - 1].ts), t1 = Date.parse(r.ts);
      const compacted = compactions.some((c) => c > t0 && c <= t1);
      for (let j = 0; j < REPLAY; j++) {
        if (compacted) cur[j] += growth;
        else if (now < prev * 0.6) cur[j] = now;
        else cur[j] += now - prev;
      }
    }
    for (let j = 0; j < REPLAY; j++) {
      const at = j < POINTS.length ? POINTS[j] : levelOf(r.family);
      if (!at) continue;
      if (cur[j] >= at) {
        v[j * PARTS] += 1;
        if (p) v[j * PARTS + 2] += (at * p[2] + k.input * p[0] + k.output * p[1] + (k.write + k.rebuild) * (long ? p[4] : p[3])) / 1e6;
        cur[j] = Math.min(k.restart, at / 2);
      }
      if (p) {
        v[j * PARTS + 1] += (cur[j] * p[2]) / 1e6;
        if (r.rebuild === "idle") v[j * PARTS + 3] += (cur[j] * ((long ? p[4] : p[3]) - p[2])) / 1e6;
      }
    }
    out.set(r, v);
  }
  return out;
}
