// Each session's main-transcript requests in time order, cut wherever the effort level changes.
export function effortRuns(db) {
  const out = new Map();
  for (const r of db.prepare("SELECT session_id, coalesce(effort, '') effort FROM requests WHERE is_sub = 0 ORDER BY session_id, ts, line").iterate()) {
    const list = out.get(r.session_id) ?? out.set(r.session_id, []).get(r.session_id);
    const last = list[list.length - 1];
    if (last?.level === (r.effort || "unknown")) last.requests++;
    else list.push({ level: r.effort || "unknown", requests: 1 });
  }
  return out;
}

// The level that served most of a session's main requests.
export function mainLevel(runs = []) {
  const n = new Map();
  for (const r of runs) n.set(r.level, (n.get(r.level) ?? 0) + r.requests);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
