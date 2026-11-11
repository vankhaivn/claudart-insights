import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { buildUsageRows } from "../src/dashboard.mjs";
import { classify, extraCost } from "../src/rebuilds.mjs";
import { assistant, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

// Opus: reads 0.5, 5m writes 6.25 and 1h writes 10 per million tokens.
const TABLE = `| model | from | input | output | cache read | cache write 5m | cache write 1h |
| --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | 2026-10-01 | 5 | 25 | 0.5 | 6.25 | 10 |
`;
const BIG = 100000;
const day = "2026-11-01";
const at = (hms) => `${day}T${hms}Z`;

// One request writing `write` tokens to the cache, `hour` of them as 1h writes.
const req = (ts, id, write, { hour = 0, model, agent } = {}) =>
  assistant(ts, id, { cache_creation_input_tokens: write, cache_creation: { ephemeral_1h_input_tokens: hour } }, { model, rec: agent ? { isSidechain: true } : undefined });

function rebuildHome() {
  const home = makeHome();
  writeFileSync(join(home.dir, "prices.md"), TABLE);
  const put = (k, records, opts) => writeTranscript(home.transcripts, "slug", sid(k), records, opts);
  // 5m cache: the start, then 7 minutes idle, then a quick one nothing explains.
  put(1, [user(at("01:00:00"), "go"), req(at("01:00:00"), "a1", BIG), req(at("01:01:00"), "a2", 20), req(at("01:08:00"), "a3", BIG), req(at("01:10:00"), "a4", BIG)]);
  // 1h cache: 30 minutes is not idle, 61 minutes is.
  put(2, [user(at("02:00:00"), "go"), req(at("02:00:00"), "b1", BIG, { hour: BIG }), req(at("02:30:00"), "b2", BIG, { hour: BIG }), req(at("03:31:00"), "b3", BIG, { hour: BIG })]);
  // A compaction between two requests; writes under the threshold, or mostly reads, are not rebuilds.
  put(3, [user(at("04:00:00"), "go"), req(at("04:00:00"), "c1", BIG), req(at("04:01:00"), "c2", 20), user(at("04:02:00"), "summary", { isCompactSummary: true }), req(at("04:03:00"), "c3", BIG),
    req(at("04:04:00"), "c4", 19999), assistant(at("04:05:00"), "c5", { cache_creation_input_tokens: 30000, cache_read_input_tokens: 100000 })]);
  // A subagent thread is its own thread: its first request is a start, its second is not.
  put(4, [user(at("05:00:00"), "go"), req(at("05:00:00"), "d1", BIG)]);
  put(4, [req(at("05:00:10"), "d2", BIG, { agent: true }), req(at("05:00:20"), "d3", BIG, { agent: true })], { agent: "s1" });
  // A model without a price row.
  put(5, [user(at("06:00:00"), "go"), req(at("06:00:00"), "e1", BIG, { model: "claude-fable-5-2" })]);
  assert.equal(home.run("scan").code, 0);
  return home;
}

const requests = (home) => {
  const db = new DatabaseSync(join(home.data, "usage.db"));
  const rows = Object.fromEntries(db.prepare("SELECT message_id id, rebuild, rebuild_gap gap, rebuild_extra extra FROM requests").all().map((r) => [r.id, { ...r }]));
  db.close();
  return rows;
};
const cause = (rows) => Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, r.rebuild]));

test("each request is classified by its thread: start, idle by the cache's lifetime, compaction, other", () => {
  const r = requests(rebuildHome());
  assert.deepEqual(cause(r), {
    a1: "start", a2: null, a3: "idle", a4: "other",
    b1: "start", b2: "other", b3: "idle",
    c1: "start", c2: null, c3: "compaction", c4: null, c5: null,
    d1: "start", d2: "start", d3: "other",
    e1: "start",
  });
  assert.deepEqual([r.a1.gap, r.a3.gap, r.a4.gap, r.b3.gap, r.c3.gap], [null, 420, 120, 3660, 120]);
});

test("the extra cost is the rewrite priced as writes minus as reads, and unknown without a price row", () => {
  const r = requests(rebuildHome());
  // 100,000 tokens: as 5m writes 0.625 less 0.05 as reads; as 1h writes 1.0 less 0.05.
  assert.ok(Math.abs(r.a3.extra - 0.575) < 1e-9);
  assert.ok(Math.abs(r.b3.extra - 0.95) < 1e-9);
  assert.equal(r.e1.extra, null);
  assert.equal(extraCost([5, 25, 0.5, 6.25, 10], { cache_write: 1e6, cache_write_1h: 5e5 }), 0.5 * 6.25 + 0.5 * 10 - 0.5);
});

test("classify reads nothing from the database: a synthetic request and the threshold edge", () => {
  const base = { session_id: "s", agent_id: null, model: "claude-opus-5-5", day, input: 0, cache_read: 0, cache_write_1h: 0 };
  const run = (writes, extra = {}) => [...classify(writes.map((w, i) => ({ ...base, ...extra, line: i, ts: at(`01:0${i}:00`), cache_write: w })), new Map(), []).values()].map((c) => c.rebuild);
  assert.deepEqual(run([20000]), ["start"]);
  assert.deepEqual(run([19999]), []);
  assert.deepEqual(run([40000], { cache_read: 40000 }), []);
  assert.deepEqual(run([40001], { cache_read: 40000 }), ["start"]);
  assert.deepEqual(run([100, 50000]).length, 1);
  assert.deepEqual([...classify([{ ...base, line: 1, ts: at("01:00:00"), cache_write: 30000, model: "<synthetic>" }], new Map(), []).values()], []);
});

const json = (home, ...args) => {
  const r = home.run("usage", "--since", day, "--until", day, "--json", ...args);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("usage reports the same rebuild figures under every grouping, and the dashboard rows agree", () => {
  const home = rebuildHome();
  const base = json(home).total.rebuild;
  assert.deepEqual(base.start, { n: 6, tokens: 6 * BIG, extra: base.start.extra });
  assert.deepEqual([base.idle.n, base.idle.tokens, base.idle.gaps], [2, 2 * BIG, [1, 0, 1]]);
  assert.deepEqual([base.compaction.n, base.other.n], [1, 3]);
  assert.ok(Math.abs(base.idle.extra - (0.575 + 0.95)) < 1e-9);
  for (const by of ["day", "model", "effort", "project", "session", "hour"]) {
    const g = json(home, "--by", by);
    assert.deepEqual(g.total.rebuild, base, by);
    for (const c of ["start", "compaction", "idle", "other"]) assert.equal(g.groups[0].rows.reduce((n, r) => n + r.rebuild[c].n, 0), base[c].n, `${by} ${c}`);
  }
  assert.equal(json(home, "--model", "fable").total.rebuild.start.n, 1);
  const facts = buildUsageRows(loadConfig(home.config)).facts;
  const sum = (i) => facts.reduce((n, f) => n + (f[13]?.[i] ?? 0), 0);
  assert.deepEqual([sum(0), sum(3), sum(6), sum(9)], [base.start.n, base.compaction.n, base.idle.n, base.other.n]);
  assert.deepEqual([sum(12), sum(13), sum(14)], base.idle.gaps);
});

test("usage prints one line of rebuilds after the totals, except when grouped by tool or subagent", () => {
  const home = rebuildHome();
  const text = home.run("usage", "--since", day, "--until", day).stdout;
  assert.match(text, /\ncache rebuilt: 2 after idle \(200K tokens, ~\$1\.52 extra\), 1 at compaction \(100K tokens, ~\$0\.57 extra\), 3 other \(300K tokens, ~\$[\d.]+ extra\), 6 at session start \(600K tokens\)\n/);
  assert.doesNotMatch(home.run("usage", "--since", day, "--until", day, "--by", "tool").stdout, /cache rebuilt/);
  assert.doesNotMatch(home.run("usage", "--since", "2026-12-01", "--until", "2026-12-01").stdout, /cache rebuilt/);
});

test("a schema change rebuilds the database from the archive with the same rebuild columns", () => {
  const home = rebuildHome();
  const before = requests(home);
  const db = new DatabaseSync(join(home.data, "usage.db"));
  db.exec("UPDATE meta SET value = '0' WHERE key = 'schema'");
  db.close();
  assert.equal(home.run("scan").code, 0);
  assert.deepEqual(requests(home), before);
});
