// Usage rows shared by the `usage` command and the dashboard, so their totals cannot differ.
import { familyOf } from "./providers/claude.mjs";
import { zoner } from "./zone.mjs";
import { costKinds, priceAt, priceReport, readPrices, requestCost } from "./prices.mjs";
import { CAUSES } from "./rebuilds.mjs";

const FAMILY_NAMES = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" };
export const modelName = (family) => FAMILY_NAMES[family] ?? family;

// Effort levels from least to most; an unknown value sorts after them as written, a missing one last.
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const effortOrder = (a, b) => {
  const r = (e) => (EFFORTS.includes(e) ? EFFORTS.indexOf(e) : e ? EFFORTS.length : EFFORTS.length + 1);
  return r(a) - r(b) || a.localeCompare(b);
};

// The rebuild figures of one request as a vector: [count, rewritten tokens, extra cost] per cause in CAUSES order,
// then the idle gaps from 5 to 15 minutes, from 15 to 60 minutes and over an hour. Facts sum these vectors.
const RB_GAPS = CAUSES.length * 3;
const gapBucket = (seconds) => (seconds < 900 ? 0 : seconds <= 3600 ? 1 : 2);
function rebuildVector(r) {
  if (!r.rebuild) return null;
  const v = new Array(RB_GAPS + 3).fill(0);
  const at = CAUSES.indexOf(r.rebuild) * 3;
  v[at] = 1;
  v[at + 1] = r.cache_write;
  v[at + 2] = r.rebuild_extra ?? 0;
  if (r.rebuild === "idle") v[RB_GAPS + gapBucket(r.rebuild_gap)] = 1;
  return v;
}

// Per cause what the facts hold: { n, tokens, extra }, and for idle the three gap counts.
export function rebuildTotals(F) {
  const v = new Array(RB_GAPS + 3).fill(0);
  for (const f of F) if (f.rb) f.rb.forEach((x, i) => { v[i] += x; });
  const out = Object.fromEntries(CAUSES.map((c, i) => [c, { n: v[i * 3], tokens: v[i * 3 + 1], extra: v[i * 3 + 2] }]));
  out.idle.gaps = v.slice(RB_GAPS);
  return out;
}

const dayAdd = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const mostOf = (map) => [...map].sort((a, b) => b[1] - a[1])[0]?.[0];

// A host cost key names a model id, sometimes with a suffix such as "[1m]"; match it to the session's requests.
function spreadTargets(key, reqs) {
  const exact = reqs.filter((r) => r.model === key);
  if (exact.length) return exact;
  const bare = key.replace(/\[.*\]$/, "");
  const stripped = reqs.filter((r) => r.model === bare);
  if (stripped.length) return stripped;
  const family = familyOf(key);
  return reqs.filter((r) => r.family === family);
}

// Rows in the shapes the dashboard's views read: sessions, facts, subagents, tools, skills.
export function loadRows(db, config, now = new Date()) {
  const zone = zoner(config.timeZone);
  const minute = new Intl.DateTimeFormat("en-GB", { timeZone: config.timeZone, minute: "2-digit" });
  const sessionRows = db.prepare(`SELECT s.*, (SELECT MIN(ts) FROM requests r WHERE r.session_id = s.id) first_req
    FROM sessions s ORDER BY coalesce(s.first_ts, first_req)`).all().filter((s) => s.first_ts || s.first_req);
  const requests = db.prepare("SELECT session_id, agent_id, ts, day, hour, model, family, effort, is_sub, input, output, thinking, cache_read, cache_write, cache_write_1h, rebuild, rebuild_gap, rebuild_extra FROM requests").all();
  const prices = readPrices(config).rows;
  // Models whose host cost misses the price table, per session.
  const off = new Map();
  for (const m of priceReport(db)) for (const x of m.misses) off.set(x.id, [...(off.get(x.id) ?? []), m.model]);
  const owners = new Map(db.prepare("SELECT session_id, COUNT(*) n FROM owner_messages GROUP BY session_id").all().map((r) => [r.session_id, r.n]));
  const compactions = new Map(db.prepare("SELECT session_id, COUNT(*) n FROM compactions GROUP BY session_id").all().map((r) => [r.session_id, r.n]));
  const calls = db.prepare("SELECT session_id, name, COUNT(*) n, SUM(coalesce(is_error, 0)) e FROM tool_calls GROUP BY session_id, name").all();
  const skillUses = db.prepare("SELECT session_id, name, via, source, is_error, ts FROM skills").all();
  const subs = db.prepare(`SELECT f.agent_id, f.session_id, a.type, a.tool_use_id, (SELECT model FROM tool_calls t WHERE t.id = a.tool_use_id) parent_model
    FROM files f LEFT JOIN subagents a ON a.agent_id = f.agent_id WHERE f.kind = 'sub'`).all();

  const bySession = new Map();
  for (const r of requests) (bySession.get(r.session_id) ?? bySession.set(r.session_id, []).get(r.session_id)).push(r);

  // Families ordered by output over all data, so a family keeps its color under every filter.
  const familyOut = new Map();
  for (const r of requests) familyOut.set(r.family, (familyOut.get(r.family) ?? 0) + r.output);
  const families = [...familyOut.keys()].sort((a, b) => familyOut.get(b) - familyOut.get(a));
  const modelIdx = (family) => {
    if (!families.includes(family)) families.push(family);
    return families.indexOf(family);
  };

  const projectOut = new Map();
  for (const s of sessionRows) projectOut.set(s.project ?? "(no project)", (projectOut.get(s.project ?? "(no project)") ?? 0) + (bySession.get(s.id) ?? []).reduce((n, r) => n + r.output, 0));
  const projects = [...projectOut.keys()].sort((a, b) => projectOut.get(b) - projectOut.get(a) || a.localeCompare(b));

  const sessions = [];
  const facts = new Map();
  const index = new Map();
  for (const s of sessionRows) {
    const reqs = bySession.get(s.id) ?? [];
    const start = s.first_ts ?? s.first_req;
    const { day, hour } = zone(start);
    const mainOut = new Map();
    const efforts = new Map();
    for (const r of reqs) {
      if (r.is_sub) continue;
      mainOut.set(r.family, (mainOut.get(r.family) ?? 0) + r.output);
      if (r.effort) efforts.set(r.effort, (efforts.get(r.effort) ?? 0) + 1);
    }
    const out = reqs.reduce((n, r) => n + r.output, 0);
    const i = sessions.length;
    index.set(s.id, i);
    const costState = s.cost === null ? "unknown" : s.cost_incomplete ? "incomplete" : s.cost_estimated ? "estimated" : "ok";
    sessions.push({
      id: s.id, p: projects.indexOf(s.project ?? "(no project)"), title: s.title ?? "", day, hour, min: Number(minute.format(new Date(start))),
      dur: s.last_ts && s.first_ts ? (Date.parse(s.last_ts) - Date.parse(s.first_ts)) / 60000 : 0,
      api: (s.api_ms ?? 0) / 1000, tool: (s.tool_ms ?? 0) / 1000, owner: owners.get(s.id) ?? 0, compact: compactions.get(s.id) ?? 0,
      la: s.lines_added ?? 0, lr: s.lines_removed ?? 0, parent: mainOut.size ? modelIdx(mostOf(mainOut)) : -1, effort: mostOf(efforts) ?? "",
      subs: [], cost: s.cost, costState, out, unpriced: [], priceOff: off.get(s.id) ?? [],
    });

    // Spread each model's host cost over that model's requests by their tokens priced on their day,
    // so a later price never moves cost between earlier days; a model without a price row is spread by output tokens.
    const costOf = new Map();
    const kindsOf = new Map();
    const unplaced = [];
    for (const [key, value] of Object.entries(s.model_cost ? JSON.parse(s.model_cost) : {})) {
      if (!value) continue;
      const targets = spreadTargets(key, reqs);
      if (!targets.length) unplaced.push([key, value]);
      const rows = targets.map((r) => priceAt(prices, r.model, r.day));
      const priced = rows.every(Boolean);
      if (!priced) for (const r of targets) if (!sessions[i].unpriced.includes(r.model)) sessions[i].unpriced.push(r.model);
      const weight = targets.map((r, k) => (priced ? requestCost(rows[k].p, r) : r.output));
      const total = weight.reduce((a, b) => a + b, 0);
      targets.forEach((r, k) => {
        const share = value * (total ? weight[k] / total : 1 / targets.length);
        costOf.set(r, (costOf.get(r) ?? 0) + share);
        // The share split as the price table splits the request: reading the context, writing the cache, output.
        if (priced && weight[k]) {
          const kinds = costKinds(rows[k].p, r), had = kindsOf.get(r) ?? [0, 0, 0];
          kindsOf.set(r, had.map((x, j) => x + (share * kinds[j]) / weight[k]));
        }
      });
    }
    const put = (d, h, family, sub, effort, add, rb = null, kinds = null) => {
      const key = `${i}|${d}|${h}|${family}|${sub}|${effort}`;
      const f = facts.get(key) ?? facts.set(key, { s: i, d, h, m: modelIdx(family), sub, e: effort, q: 0, i: 0, o: 0, cr: 0, cw: 0, th: 0, c: 0, rb: null, k: null }).get(key);
      for (const [k, v] of Object.entries(add)) f[k] += v;
      if (kinds) {
        f.k ??= [0, 0, 0];
        kinds.forEach((x, j) => { f.k[j] += x; });
      }
      if (rb) {
        f.rb ??= new Array(rb.length).fill(0);
        rb.forEach((x, k) => { f.rb[k] += x; });
      }
    };
    for (const r of reqs) put(r.day, r.hour, r.family, r.is_sub, r.effort ?? "", { q: 1, i: r.input, o: r.output, cr: r.cache_read, cw: r.cache_write, th: r.thinking, c: costOf.get(r) ?? 0 }, rebuildVector(r), kindsOf.get(r));
    // A model the host charged with no request in the transcript lands on the session's first hour.
    for (const [key, value] of unplaced) put(day, hour, key === "unknown" ? mostOf(mainOut) ?? "unknown" : familyOf(key), 0, sessions[i].effort, { c: value });
  }

  const subagents = [];
  for (const a of subs) {
    const i = index.get(a.session_id);
    if (i === undefined) continue;
    const own = new Map();
    for (const r of bySession.get(a.session_id) ?? []) if (r.agent_id === a.agent_id) own.set(r.family, (own.get(r.family) ?? 0) + r.output);
    sessions[i].subs.push(subagents.length);
    subagents.push({ s: i, type: a.type ?? "unknown", m: own.size ? modelIdx(mostOf(own)) : -1, parent: a.parent_model ? modelIdx(familyOf(a.parent_model)) : -1, o: [...own.values()].reduce((n, v) => n + v, 0) });
  }
  const tools = sessions.map(() => ({}));
  for (const c of calls) {
    const i = index.get(c.session_id);
    if (i !== undefined) tools[i][c.name] = [c.n, c.e];
  }

  const { skills, skillSources } = skillsBySession(skillUses, sessions.length, index, zone);

  const factList = [...facts.values()];
  const today = zone(now.toISOString()).day;
  return {
    models: families.map(modelName), projects, sessions, facts: factList, subagents, tools, skills, skillSources, today,
    first: factList.reduce((a, f) => (f.d < a ? f.d : a), today), scanned: now.toISOString(),
  };
}

// Where skills come from, in the order they are listed.
export const SKILL_SOURCES = ["project", "personal", "plugin", "builtin", "other"];

// Per session, each skill's [typed as a command, called by the agent, failed calls, last day used]; and each skill's source.
// A call the host loaded no folder for takes the source the same skill shows elsewhere. A typed command counts only
// when it is a skill: the host loaded one for it, or the agent called a skill of that name.
function skillsBySession(uses, count, index, zone) {
  const seen = new Map();
  for (const u of uses) {
    const m = seen.get(u.name) ?? seen.set(u.name, new Map()).get(u.name);
    if (u.source) m.set(u.source, (m.get(u.source) ?? 0) + 1);
  }
  const isSkill = new Set(uses.filter((u) => u.source || u.via === "agent").map((u) => u.name));
  const skillSources = {};
  for (const name of isSkill) skillSources[name] = mostOf(seen.get(name)) ?? "other";
  const skills = Array.from({ length: count }, () => ({}));
  for (const u of uses) {
    const i = index.get(u.session_id);
    if (i === undefined || !isSkill.has(u.name)) continue;
    const r = skills[i][u.name] ?? (skills[i][u.name] = [0, 0, 0, ""]);
    r[u.via === "command" ? 0 : 1]++;
    r[2] += u.is_error ? 1 : 0;
    const day = u.ts ? zone(u.ts).day : "";
    if (day > r[3]) r[3] = day;
  }
  return { skills, skillSources };
}

// The window and filters of a `usage` call, resolved against the rows.
export function window(rows, { days, since, until }) {
  if (since || until) return { from: since ?? rows.first, to: until ?? rows.today };
  const n = Number(days ?? 14);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--days needs a positive whole number, got ${days}`);
  return { from: dayAdd(rows.today, -(n - 1)), to: rows.today };
}

export function slice(rows, { from, to, project = -1, model = -1, effort = null }) {
  return rows.facts.filter((f) => f.d >= from && f.d <= to && (project < 0 || rows.sessions[f.s].p === project) && (model < 0 || f.m === model) && (effort === null || f.e === effort));
}

export function totals(rows, F) {
  const a = { q: 0, i: 0, o: 0, th: 0, cr: 0, cw: 0, c: 0 };
  const sess = new Set();
  for (const f of F) {
    for (const k of Object.keys(a)) a[k] += f[k];
    sess.add(f.s);
  }
  const ss = [...sess].map((s) => rows.sessions[s]);
  // Speed counts only sessions whose host record gives API time; a running session has none yet.
  const timed = ss.filter((s) => s.api > 0), api = timed.reduce((n, s) => n + s.api, 0);
  return { ...a, rebuild: rebuildTotals(F), sessions: sess.size, hit: a.cr / (a.cr + a.cw + a.i || 1), tps: api ? timed.reduce((n, s) => n + s.out, 0) / api : null, costGaps: ss.filter((s) => s.costState !== "ok"),
    unpriced: [...new Set(ss.flatMap((s) => s.unpriced))].sort() };
}

// Rows of one grouping. Each row carries the token totals of its facts plus its label.
export function groupBy(rows, F, by) {
  const keyOf = {
    day: (f) => f.d,
    hour: (f) => f.h,
    model: (f) => rows.models[f.m],
    effort: (f) => f.e || "unknown",
    project: (f) => rows.projects[rows.sessions[f.s].p],
    session: (f) => f.s,
  }[by];
  if (!keyOf) throw new Error(`--by takes day, model, effort, project, session, hour, tool, skill or subagent, got ${by}`);
  const groups = new Map();
  for (const f of F) {
    const k = keyOf(f);
    (groups.get(k) ?? groups.set(k, []).get(k)).push(f);
  }
  return [...groups].map(([key, list]) => ({ key, ...totals(rows, list) }));
}

// Tool calls and subagents of the sessions that have requests in the window.
export function toolRows(rows, F) {
  const out = new Map();
  for (const s of new Set(F.map((f) => f.s))) {
    for (const [name, [n, e]] of Object.entries(rows.tools[s])) {
      const r = out.get(name) ?? out.set(name, { key: name, calls: 0, errors: 0 }).get(name);
      r.calls += n;
      r.errors += e;
    }
  }
  return [...out.values()].sort((a, b) => b.calls - a.calls);
}

// Skills used in the sessions that have requests in the window, by source and then most used first.
export function skillRows(rows, F) {
  const out = new Map();
  for (const s of new Set(F.map((f) => f.s))) {
    for (const [name, [command, agent, errors, last]] of Object.entries(rows.skills[s])) {
      const r = out.get(name) ?? out.set(name, { key: name, source: rows.skillSources[name], uses: 0, command: 0, agent: 0, errors: 0, sessions: 0, last: "" }).get(name);
      r.uses += command + agent;
      r.command += command;
      r.agent += agent;
      r.errors += errors;
      r.sessions++;
      if (last > r.last) r.last = last;
    }
  }
  return [...out.values()].sort((a, b) => SKILL_SOURCES.indexOf(a.source) - SKILL_SOURCES.indexOf(b.source) || b.uses - a.uses || a.key.localeCompare(b.key));
}

export function subagentRows(rows, F) {
  const out = new Map();
  const inWindow = new Set(F.map((f) => f.s));
  for (const a of rows.subagents) {
    if (!inWindow.has(a.s)) continue;
    const r = out.get(a.type) ?? out.set(a.type, { key: a.type, count: 0, o: 0, models: {} }).get(a.type);
    r.count++;
    r.o += a.o;
    const m = a.m < 0 ? "unknown" : rows.models[a.m];
    r.models[m] = (r.models[m] ?? 0) + 1;
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}
