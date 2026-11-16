import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { buildUsageRows } from "../src/dashboard.mjs";
import { assistant, compaction, cost, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

// Opus: input 5, output 25, reads 0.5, 5m writes 6.25 and 1h writes 10 per million tokens.
const TABLE = `| model | from | input | output | cache read | cache write 5m | cache write 1h |
| --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | 2026-10-01 | 5 | 25 | 0.5 | 6.25 | 10 |
`;
const P = [5, 25, 0.5, 6.25, 10];
const at = (m) => `2026-11-01T01:${String(m).padStart(2, "0")}:00Z`;
const rows = (home, sql) => new DatabaseSync(join(home.data, "usage.db"), { readOnly: true }).prepare(sql).all().map((r) => ({ ...r }));

// A request carrying ctx tokens of context, write of them written to the 1h cache and the rest read from it.
const req = (ts, id, ctx, write, extra = {}) => assistant(ts, id, { input_tokens: 0, output_tokens: 100, cache_read_input_tokens: ctx - write, cache_creation_input_tokens: write, cache_creation: { ephemeral_1h_input_tokens: write } }, extra);

// One session whose main thread grows 50K a request and compacts at 400K twice, and a subagent that compacts once by
// hand; its host record holds tokens the transcript does not (800K read, 8K input, 18K written, 16K output), which the
// three summary requests share.
function contextHome() {
  const home = makeHome();
  writeFileSync(join(home.dir, "prices.md"), TABLE);
  const main = [user(at(0), "go")];
  let m = 1;
  const climb = () => { for (let ctx = 150000; ctx <= 400000; ctx += 50000) main.push(req(at(m++), `r${m}`, ctx, 50000)); };
  main.push(req(at(m++), "r1", 100000, 100000));
  climb();
  main.push(...compaction(at(m++)), user(at(m++), "next"), req(at(m++), "after1", 100000, 48000));
  climb();
  main.push(...compaction(at(m++)), req(at(m++), "after2", 100000, 48000), req(at(m++), "last", 120000, 20000));
  const sub = [req(at(5), "s1", 150000, 150000, { rec: { isSidechain: true } }), ...compaction(at(6), { trigger: "manual", pre: 150000, sidechain: true }),
    req(at(7), "s2", 60000, 30000, { rec: { isSidechain: true } })];
  const requests = [...main, ...sub].filter((r) => r.type === "assistant").map((r) => r.message.usage);
  const sum = (k) => requests.reduce((n, u) => n + u[k], 0);
  const tokens = { input: sum("input_tokens") + 8000, output: sum("output_tokens") + 16000, read: sum("cache_read_input_tokens") + 800000, w1: sum("cache_creation_input_tokens") + 18000 };
  const priced = (tokens.input * P[0] + tokens.output * P[1] + tokens.read * P[2] + tokens.w1 * P[4]) / 1e6;
  main.push(cost(priced, { modelUsage: { "claude-opus-5-5": { costUSD: priced, inputTokens: tokens.input, outputTokens: tokens.output, cacheReadInputTokens: tokens.read,
    cacheCreationInputTokens: tokens.w1, cacheCreationEphemeral5mInputTokens: 0, cacheCreationEphemeral1hInputTokens: tokens.w1 } } }));
  writeTranscript(home.transcripts, "slug", sid(1), main);
  writeTranscript(home.transcripts, "slug", sid(1), sub, { agent: "a1" });
  // An older host wrote the summary without a boundary.
  writeTranscript(home.transcripts, "slug", sid(2), [user(at(0), "go"), req(at(1), "o1", 50000, 50000), user(at(2), "Summary", { isCompactSummary: true }), req(at(3), "o2", 30000, 25000)]);
  assert.equal(home.run("scan").code, 0);
  return home;
}

test("a compaction is one row with the boundary's figures, on its own thread; a summary alone still counts", () => {
  const home = contextHome();
  assert.deepEqual(rows(home, "SELECT session_id s, agent_id a, trigger, pre_tokens pre, post_tokens post, duration_ms ms FROM compactions ORDER BY session_id, agent_id, ts"), [
    { s: sid(1), a: null, trigger: "auto", pre: 400000, post: 20000, ms: 60000 },
    { s: sid(1), a: null, trigger: "auto", pre: 400000, post: 20000, ms: 60000 },
    { s: sid(1), a: "a1", trigger: "manual", pre: 150000, post: 20000, ms: 60000 },
    { s: sid(2), a: null, trigger: null, pre: null, post: null, ms: null },
  ]);
  // The first request after each compaction rewrites under half of its context and still counts, on its own thread only.
  const cause = Object.fromEntries(rows(home, "SELECT message_id id, rebuild FROM requests").map((r) => [r.id, r.rebuild]));
  assert.deepEqual([cause.after1, cause.after2, cause.last, cause.s2, cause.o2], ["compaction", "compaction", null, "compaction", "compaction"]);
});

test("each compaction carries what came after it and what its summary request cost", () => {
  const home = contextHome();
  const D = buildUsageRows(loadConfig(home.config));
  const s = D.sessions.findIndex((x) => x.id === sid(1).slice(0, 8));
  const mine = D.compactions.filter((x) => x[0] === s).sort((a, b) => a[4] - b[4] || a[10] - b[10]);
  // [sub, auto, pre, kept, nth, next, turns, tail]
  assert.deepEqual(mine.map((x) => [x[4], x[5], x[6], x[9], x[10], x[11], x[12], x[13]]), [
    [0, 1, 400000, 100000, 1, 7, 1, null],
    [0, 1, 400000, 100000, 2, null, null, 2],
    [1, 0, 150000, 60000, 1, null, null, 1],
  ]);
  // Each of the three takes a third of the hidden tokens, priced as its share of the host's cost.
  const each = ((8000 * P[0] + 16000 * P[1] + 800000 * P[2] + 18000 * P[4]) / 1e6) / 3;
  for (const x of mine) assert.ok(Math.abs(x[14] - each) < 1e-4, `summary ${x[14]} against ${each}`);
  // The rewrite after a compaction is its writes priced as writes less as reads.
  assert.ok(Math.abs(mine[0][15] - (48000 * (P[4] - P[2])) / 1e6) < 1e-6);
  assert.equal(D.fires[D.models.indexOf("Opus")], 400000);
});

test("the cost of reading the context by size adds up to the overview's, and the replay at the current point compacts as recorded", () => {
  const home = contextHome();
  const D = buildUsageRows(loadConfig(home.config));
  const read = D.facts.reduce((n, f) => n + (f[14]?.[0] ?? 0), 0), q = D.facts.reduce((n, f) => n + f[6], 0);
  assert.ok(Math.abs(D.context.reduce((n, x) => n + x[4].reduce((a, b) => a + b, 0), 0) - read) < 1e-4);
  assert.equal(D.context.reduce((n, x) => n + x[5].reduce((a, b) => a + b, 0), 0), q);
  // A bucket holds its lower edge: the two requests at 400K sit in 400–600K.
  assert.deepEqual(D.context.reduce((v, x) => v.map((n, j) => n + x[5][j]), [0, 0, 0, 0, 0, 0, 0]), [1, 2, 7, 4, 4, 2, 0]);
  const point = (j) => D.context.reduce((n, x) => n + (x[6]?.[j * 4] ?? 0), 0);
  assert.equal(point(D.points.length), 2, "now");
  assert.equal(point(D.points.indexOf(967000)), 0);
  assert.ok(point(D.points.indexOf(200000)) > 2);
});
