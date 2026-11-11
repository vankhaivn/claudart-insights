// The rows from GET /api/data (built by src/dashboard.mjs) and the queries the views run.
//   sessions  one row per session (project, title, start, durations and cost from the host's cost record,
//             owner messages, compactions, lines changed) and its main-thread effort runs [effort, requests]
//   facts     tokens and cost per session, day, hour, model, effort and main/subagent (from per-request usage)
//   subagents one row per subagent (type, model, parent model, output tokens)
//   tools     tool calls and errors per session
//   skills    per session, each skill's [typed as a command, called by the agent, failed calls, last day used];
//             skillSources says where each skill was loaded from

export type Run = [effort: number, requests: number];
export type Session = {
  id: string; p: number; title: string; day: string; hour: number; min: number; dur: number; api: number; tool: number;
  owner: number; compact: number; la: number; lr: number; parent: number; subs: unknown[]; cost: number;
  costState: "ok" | "unknown" | "incomplete" | "estimated"; out: number; runs: Run[];
  // Models without a price row, and models whose host cost misses the price table, in this session.
  unpriced: string[]; priceOff: string[];
};
// rb is null unless a request of the fact rebuilt the cache; else [count, rewritten tokens, extra cost] per cause in
// CAUSES order, then the idle gaps from 5 to 15 minutes, from 15 to 60 minutes and over an hour (summed over the fact's requests).
export type Fact = { s: number; d: string; h: number; m: number; sub: number; e: number; q: number; i: number; o: number; cr: number; cw: number; th: number; c: number; rb: number[] | null };
export type Subagent = { s: number; type: number; m: number; parent: number; o: number };
type RawFact = [number, string, number, number, number, number, number, number, number, number, number, number, number, number[] | null];
export type Payload = {
  today: string; scanned: string; models: string[]; projects: string[]; types: string[]; efforts: string[]; transcripts: number;
  sessions: Session[]; facts: RawFact[]; subagents: Subagent[]; tools: Record<string, [number, number]>[];
  skills: Record<string, SkillUse>[]; skillSources: Record<string, SkillSource>;
};
export type SkillUse = [command: number, agent: number, errors: number, last: string];
export const SKILL_SOURCES = ["project", "personal", "plugin", "builtin", "other"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

export type Model = ReturnType<typeof buildModel>;

export const dayAdd = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const days = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = dayAdd(d, 1)) out.push(d); return out; };

export function buildModel(data: Payload) {
  const facts: Fact[] = data.facts.map(([s, d, h, m, sub, e, q, i, o, cr, cw, th, c, rb]) => ({ s, d, h, m, sub, e, q, i, o, cr, cw, th, c, rb }));
  const sumOut = (p: number) => facts.reduce((n, f) => n + (data.sessions[f.s].p === p ? f.o : 0), 0);
  const projectRank = data.projects.map((_, i) => i).sort((a, b) => sumOut(b) - sumOut(a));
  return {
    today: data.today, scanned: data.scanned,
    models: data.models, projects: data.projects, types: data.types,
    // Levels low → max, then any other value seen as written; facts and runs hold an index into it.
    efforts: data.efforts,
    levels: data.efforts.map((_, e) => e).filter((e) => facts.some((f) => f.e === e)), // levels seen, low → max
    first: facts.reduce((a, f) => (f.d < a ? f.d : a), data.today),
    sessions: data.sessions, subagents: data.subagents, tools: data.tools, skills: data.skills, skillSources: data.skillSources, facts, projectRank,
    pColor: (p: number) => { const r = projectRank.indexOf(p); return r < 5 ? "c" + (r + 1) : "c0"; },
  };
}

export type Filter = { from: string; to: string; project: number; model: number; effort: number };
export type Metric = "out" | "cost" | "sess";

export function slice(M: Model, f: Filter, from = f.from, to = f.to) {
  return M.facts.filter((x) => x.d >= from && x.d <= to && (f.project < 0 || M.sessions[x.s].p === f.project) && (f.model < 0 || x.m === f.model) && (f.effort < 0 || x.e === f.effort));
}

export const CAUSES = ["start", "compaction", "idle", "other"] as const;
const RB_IDLE = CAUSES.indexOf("idle") * 3, RB_GAPS = CAUSES.length * 3;
export type Rebuilds = Record<(typeof CAUSES)[number], { n: number; tokens: number; extra: number }> & { gaps: number[] };
// What the facts hold per rebuild cause, and the idle ones split by the time since the previous request.
export function rebuilds(F: Fact[]): Rebuilds {
  const v = new Array(RB_GAPS + 3).fill(0);
  for (const f of F) if (f.rb) f.rb.forEach((x, i) => { v[i] += x; });
  const at = (c: (typeof CAUSES)[number]) => { const i = CAUSES.indexOf(c) * 3; return { n: v[i], tokens: v[i + 1], extra: v[i + 2] }; };
  return { start: at("start"), compaction: at("compaction"), idle: at("idle"), other: at("other"), gaps: v.slice(RB_GAPS) };
}

export type Totals = ReturnType<typeof totals>;
export function totals(M: Model, F: Fact[]) {
  const a = { o: 0, c: 0, i: 0, cr: 0, cw: 0, q: 0, th: 0, n: 0, hit: 0, tps: 0, sess: new Set<number>() };
  for (const f of F) { a.o += f.o; a.c += f.c; a.i += f.i; a.cr += f.cr; a.cw += f.cw; a.q += f.q; a.th += f.th; a.sess.add(f.s); }
  const ss = [...a.sess].map((s) => M.sessions[s]);
  a.n = a.sess.size; a.hit = a.cr / (a.cr + a.cw + a.i || 1);
  // Speed counts only sessions whose host record gives API time; a running session has none yet.
  const timed = ss.filter((s) => s.api > 0);
  a.tps = timed.reduce((n, s) => n + s.out, 0) / (timed.reduce((n, s) => n + s.api, 0) || 1);
  return a;
}

const val = (metric: Metric, f: Fact) => (metric === "cost" ? f.c : f.o);
export const HOURLY = Array.from({ length: 24 }, (_, h) => h);
// A one-day window draws per-day charts by hour.
export const slotsOf = (list: string[]): (string | number)[] => (list.length === 1 ? HOURLY : list);

export function byDay(F: Fact[], list: (string | number)[], key: (f: Fact) => number, groups: unknown[], metric: Metric) {
  const slot = typeof list[0] === "number" ? (f: Fact) => f.h : (f: Fact) => f.d;
  const idx = new Map<string | number, number>(list.map((d, i) => [d, i]));
  const rows = list.map(() => groups.map(() => 0)), seen = list.map(() => groups.map(() => new Set<number>()));
  for (const f of F) { const i = idx.get(slot(f)), g = key(f); if (i === undefined || g < 0) continue; if (metric === "sess") seen[i][g].add(f.s); else rows[i][g] += val(metric, f); }
  return metric === "sess" ? seen.map((r) => r.map((s) => s.size)) : rows;
}

export function group(F: Fact[], key: (f: Fact) => number, metric: Metric) {
  const m = new Map<number, number | Set<number>>();
  for (const f of F) {
    const k = key(f);
    if (metric === "sess") { if (!m.has(k)) m.set(k, new Set()); (m.get(k) as Set<number>).add(f.s); } else m.set(k, ((m.get(k) as number) || 0) + val(metric, f));
  }
  return new Map([...m].map(([k, v]) => [k, v instanceof Set ? v.size : v]));
}

export type SessionRow = { s: number; o: number; c: number; cr: number; cw: number; i: number; mix: number[]; subMix: number[]; lapses: number; x: Session; hit: number };
export function sessionRows(M: Model, F: Fact[]): SessionRow[] {
  const m = new Map<number, Omit<SessionRow, "x" | "hit">>();
  for (const f of F) {
    let r = m.get(f.s);
    if (!r) m.set(f.s, (r = { s: f.s, o: 0, c: 0, cr: 0, cw: 0, i: 0, mix: M.models.map(() => 0), subMix: M.models.map(() => 0), lapses: 0 }));
    r.o += f.o; r.c += f.c; r.cr += f.cr; r.cw += f.cw; r.i += f.i; r.mix[f.m] += f.o; if (f.sub) r.subMix[f.m] += f.o;
    if (f.rb) r.lapses += f.rb[RB_IDLE];
  }
  return [...m.values()].map((r) => ({ ...r, x: M.sessions[r.s], hit: r.cr / (r.cr + r.cw + r.i || 1) }));
}

// Tool calls and errors summed over sessions, most called first.
export function toolCalls(M: Model, sessions: number[]) {
  const by = new Map<string, [number, number]>();
  sessions.forEach((s) => Object.entries(M.tools[s]).forEach(([n, [c, e]]) => { const r = by.get(n) ?? [0, 0]; r[0] += c; r[1] += e; by.set(n, r); }));
  return [...by].sort((a, b) => b[1][0] - a[1][0]);
}

export type SkillRow = { name: string; source: SkillSource; command: number; agent: number; errors: number; sessions: number; last: string };
// Skills summed over sessions, by source and then most used first; the same rows as `usage --by skill`.
export function skillUses(M: Model, sessions: number[]): SkillRow[] {
  const by = new Map<string, SkillRow>();
  sessions.forEach((s) => Object.entries(M.skills[s]).forEach(([name, [c, a, e, last]]) => {
    const r = by.get(name) ?? { name, source: M.skillSources[name], command: 0, agent: 0, errors: 0, sessions: 0, last: "" };
    r.command += c; r.agent += a; r.errors += e; r.sessions++; if (last > r.last) r.last = last;
    by.set(name, r);
  }));
  const uses = (r: SkillRow) => r.command + r.agent;
  return [...by.values()].sort((a, b) => SKILL_SOURCES.indexOf(a.source) - SKILL_SOURCES.indexOf(b.source) || uses(b) - uses(a) || a.name.localeCompare(b.name));
}

export const mainLevel = (runs: Run[]) => { const by = new Map<number, number>(); runs.forEach(([e, q]) => by.set(e, (by.get(e) || 0) + q)); return [...by].sort((a, b) => b[1] - a[1])[0][0]; };
