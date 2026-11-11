// Cache rebuilds: requests that write most of their context into the prompt cache again.
import { priceAt } from "./prices.mjs";

export const MIN_REWRITE = 20000; // tokens written to the cache for a request to count
export const SHARE = 0.5; // ...and more than this share of everything the request read or wrote
export const CAUSES = ["start", "compaction", "idle", "other"];
const SHORT_LIFETIME = 5 * 60; // seconds a cache write lives, without the 1h option
const LONG_LIFETIME = 60 * 60;

export const isRebuild = (r) => r.cache_write >= MIN_REWRITE && r.cache_write > SHARE * (r.input + r.cache_read + r.cache_write);

// Rewritten tokens priced as cache writes (5m/1h by the split, as requestCost does) minus the same tokens priced as reads.
export function extraCost(p, r) {
  const w1 = r.cache_write_1h ?? r.cache_write;
  return ((r.cache_write - w1) * p[3] + w1 * p[4] - r.cache_write * p[2]) / 1e6;
}

// requests: { session_id, agent_id, ts, line, model, day, input, cache_read, cache_write, cache_write_1h } in any order.
// compactions: Map of session id to the compaction instants (ms). Returns Map of request to { rebuild, gap, extra } for rebuilds.
export function classify(requests, compactions, prices) {
  const threads = new Map();
  for (const r of requests) {
    if (r.model === "<synthetic>") continue;
    const key = `${r.session_id}\n${r.agent_id ?? ""}`;
    (threads.get(key) ?? threads.set(key, []).get(key)).push(r);
  }
  const out = new Map();
  for (const list of threads.values()) {
    list.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.line - b.line);
    let prev = null;
    let lifetime = SHORT_LIFETIME;
    for (const r of list) {
      const at = Date.parse(r.ts);
      if (isRebuild(r)) {
        const gap = prev === null ? null : Math.round((at - prev) / 1000);
        let cause;
        if (prev === null) cause = "start";
        else if ((compactions.get(r.session_id) ?? []).some((c) => c > prev && c <= at)) cause = "compaction";
        else if (gap > lifetime) cause = "idle";
        else cause = "other";
        const row = priceAt(prices, r.model, r.day);
        out.set(r, { rebuild: cause, gap, extra: row ? extraCost(row.p, r) : null });
      }
      // The cache a thread holds lives as long as its latest write promised.
      if (r.cache_write > 0) lifetime = r.cache_write_1h > 0 ? LONG_LIFETIME : SHORT_LIFETIME;
      prev = at;
    }
  }
  return out;
}

// Recompute the rebuild columns of every request, writing only the rows that changed.
export function markRebuilds(db, prices) {
  const requests = db.prepare(`SELECT message_id, session_id, agent_id, ts, line, model, day, input, cache_read, cache_write, cache_write_1h,
    rebuild, rebuild_gap, rebuild_extra FROM requests`).all();
  const compactions = new Map();
  for (const c of db.prepare("SELECT session_id, ts FROM compactions WHERE ts IS NOT NULL").all()) (compactions.get(c.session_id) ?? compactions.set(c.session_id, []).get(c.session_id)).push(Date.parse(c.ts));
  const found = classify(requests, compactions, prices);
  const set = db.prepare("UPDATE requests SET rebuild = ?, rebuild_gap = ?, rebuild_extra = ? WHERE message_id = ?");
  db.exec("BEGIN");
  try {
    for (const r of requests) {
      const c = found.get(r) ?? { rebuild: null, gap: null, extra: null };
      if (c.rebuild !== r.rebuild || c.gap !== r.rebuild_gap || c.extra !== r.rebuild_extra) set.run(c.rebuild, c.gap, c.extra, r.message_id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
