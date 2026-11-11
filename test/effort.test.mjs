import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { buildUsageRows } from "../src/dashboard.mjs";
import { effortRuns, mainLevel } from "../src/effort.mjs";
import { assistant, cost, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

// One session that changes effort twice (high → xhigh → high) with a subagent at medium, and one session at low.
function effortHome() {
  const home = makeHome();
  const cwd = join(home.dir, "work", "alpha");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  const rec = { cwd };
  const at = (ts, id, out, effort, extra = {}) => ({ ...assistant(ts, id, { output_tokens: out }, { rec: { ...rec, ...extra } }), effort });
  const a = sid(80), b = sid(81);
  writeTranscript(home.transcripts, "alpha", a, [
    user("2026-11-01T01:00:00Z", "go", rec),
    at("2026-11-01T01:00:01Z", "a1", 100, "high"), at("2026-11-01T01:10:00Z", "a2", 100, "high"),
    at("2026-11-01T02:00:00Z", "a3", 400, "xhigh"),
    at("2026-11-02T01:00:00Z", "a4", 100, "high"),
    cost(3),
  ]);
  writeTranscript(home.transcripts, "alpha", a, [at("2026-11-01T02:05:00Z", "a-sub", 50, "medium", { isSidechain: true })], { agent: "s1" });
  writeTranscript(home.transcripts, "alpha", b, [user("2026-11-02T03:00:00Z", "small", rec), at("2026-11-02T03:00:01Z", "b1", 20, "low"), cost(0.5)]);
  assert.equal(home.run("scan").code, 0);
  return { home, a, b };
}

const run = (home, ...args) => {
  const r = home.run(...args);
  assert.equal(r.code, 0, r.stderr);
  return r.stdout;
};
const usage = (home, ...args) => JSON.parse(run(home, "usage", "--since", "2026-11-01", "--until", "2026-11-02", "--json", ...args));

test("usage groups by effort from low to max and --effort narrows every grouping", () => {
  const { home } = effortHome();
  const g = usage(home, "--by", "effort");
  assert.deepEqual(g.groups[0].rows.map((r) => [r.key, r.q, r.o]), [["low", 1, 20], ["medium", 1, 50], ["high", 3, 300], ["xhigh", 1, 400]]);
  for (const filter of [[], ["--effort", "high"], ["--effort", "medium"]]) {
    const base = usage(home, ...filter).total;
    for (const by of ["day", "model", "effort", "project", "session", "hour"]) {
      const s = usage(home, ...filter, "--by", by);
      assert.deepEqual(s.total, base, `${filter} ${by}`);
      for (const k of ["q", "o"]) assert.equal(s.groups[0].rows.reduce((n, r) => n + r[k], 0), base[k], `${filter} ${by} ${k}`);
      assert.ok(Math.abs(s.groups[0].rows.reduce((n, r) => n + r.c, 0) - base.c) < 1e-9, `${filter} ${by} cost`);
    }
  }
  assert.equal(usage(home, "--effort", "high").total.o, 300);
  assert.equal(usage(home, "--effort", "xhigh", "--by", "day").groups[0].rows.length, 1);
  assert.match(home.run("usage", "--effort", "max").stderr, /no request at effort max; seen: low, medium, high, xhigh/);
});

test("effortRuns gives the main level and its runs in time order; the dashboard embeds them", () => {
  const { home, a } = effortHome();
  const db = new DatabaseSync(join(home.data, "usage.db"));
  const runs = effortRuns(db).get(a);
  db.close();
  assert.equal(mainLevel(runs), "high");
  assert.deepEqual(runs, [{ level: "high", requests: 2 }, { level: "xhigh", requests: 1 }, { level: "high", requests: 1 }]);
  const data = buildUsageRows(loadConfig(home.config));
  assert.deepEqual(data.efforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepEqual(data.sessions.find((x) => x.id === a.slice(0, 8)).runs, [[2, 2], [3, 1], [2, 1]]);
  // The embedded facts give the same totals per level as `usage --by effort`.
  const byLevel = {};
  for (const f of data.facts) byLevel[data.efforts[f[5]]] = (byLevel[data.efforts[f[5]]] ?? 0) + f[12];
  for (const r of usage(home, "--by", "effort").groups[0].rows) assert.ok(Math.abs(byLevel[r.key] - r.c) < 1e-9, r.key);
});
