import { readDb } from "./db.mjs";
import { effortRuns } from "./effort.mjs";
import { EDGES, POINTS } from "./context.mjs";
import { EFFORTS, effortOrder, loadRows } from "./usage.mjs";

const round = (n, d = 6) => Math.round(n * 10 ** d) / 10 ** d;

export function dashboardData(db, config, now = new Date()) {
  const rows = loadRows(db, config, now);
  const typeCount = new Map();
  for (const a of rows.subagents) typeCount.set(a.type, (typeCount.get(a.type) ?? 0) + 1);
  const types = [...typeCount.keys()].sort((a, b) => typeCount.get(b) - typeCount.get(a));
  // Effort as an index: the five levels first, so a level keeps its color, then any other value seen; none is "unknown".
  const runs = effortRuns(db);
  const seen = new Set([...rows.facts.map((f) => f.e || "unknown"), ...[...runs.values()].flat().map((r) => r.level)]);
  const efforts = [...EFFORTS, ...[...seen].filter((e) => !EFFORTS.includes(e) && e !== "unknown").sort(effortOrder), ...(seen.has("unknown") ? ["unknown"] : [])];
  const ei = (e) => efforts.indexOf(e || "unknown");
  return {
    today: rows.today, scanned: rows.scanned, models: rows.models, projects: rows.projects, types, efforts,
    transcripts: db.prepare("SELECT COUNT(*) n FROM files WHERE kind = 'main'").get().n,
    sessions: rows.sessions.map((s) => ({ ...s, id: s.id.slice(0, 8), dur: round(s.dur, 2), tool: round(s.tool, 1), runs: (runs.get(s.id) ?? []).map((r) => [ei(r.level), r.requests]) })),
    // rb: the rebuild vector of src/usage.mjs, or null when no request of the fact rebuilt the cache.
    // k: the cost split into reading the context, writing the cache, output and web search, or null when nothing of it was priced.
    // sv: what the cache saved; tc, te: tool calls and failed ones; ot: owner turns the fact's requests answered first.
    facts: rows.facts.map((f) => [f.s, f.d, f.h, f.m, f.sub, ei(f.e), f.q, f.i, f.o, f.cr, f.cw, f.th, f.c, f.rb && f.rb.map((x) => round(x)), f.k && f.k.map((x) => round(x)), round(f.sv), f.tc, f.te, f.ot]),
    subagents: rows.subagents.map((a) => ({ ...a, type: types.indexOf(a.type) })),
    tools: rows.tools.map(shortToolNames),
    skills: rows.skills, skillSources: rows.skillSources,
    // One row per compaction: session, day, model, effort, subagent, auto (1), manual (0) or unknown (null), context before,
    // summary tokens, wait (ms), context of the next request, its order on the thread, requests and owner turns to the next one
    // (null for the last), requests after the last one (null otherwise), the summary request's cost and the rewrite after it.
    compactions: rows.compactions.map((x) => [x.s, x.d, x.m, ei(x.e), x.sub, x.auto, x.pre, x.post, x.wait, x.kept, x.nth, x.next, x.turns, x.tail, x.sum === null ? null : round(x.sum), round(x.rb)]),
    // Per session, day, model and effort: the cost of reading the context per size bucket (plus a last part with no
    // request), requests per bucket, and the replay as compactions, reading, compacting and idle rebuilds per point.
    context: rows.context.map((x) => [x.s, x.d, x.m, ei(x.e), x.b.map((v) => round(v)), x.n, x.r && x.r.map((v) => round(v, 4))]),
    edges: EDGES, points: POINTS, fires: rows.levels,
  };
}

// An MCP tool reads better by its own name than by mcp__<server>__<tool>; tools sharing a name are summed.
export function shortToolNames(calls) {
  const out = {};
  for (const [name, [n, e]] of Object.entries(calls)) {
    const short = name.startsWith("mcp__") ? name.split("__").at(-1) : name;
    const [pn, pe] = out[short] ?? [0, 0];
    out[short] = [pn + n, pe + e];
  }
  return out;
}

// Rows of the views, read from the database as the last scan left it.
export const buildUsageRows = (config, now = new Date()) => withDb(config, (db) => dashboardData(db, config, now));

export function withDb(config, fn) {
  const db = readDb(config.database);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
