import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { buildUsageRows } from "../src/dashboard.mjs";
import { assistant, cost, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

// Two projects, two days, three model families, a subagent, tool calls and a session without a cost record.
function usageHome() {
  const home = makeHome();
  const docs = join(home.dir, "work");
  for (const p of ["alpha", "beta"]) mkdirSync(join(docs, p, ".git"), { recursive: true });
  const at = (p) => ({ cwd: join(docs, p) });
  const a = sid(60);
  const b = sid(61);
  const c = sid(62);
  writeTranscript(home.transcripts, "alpha", a, [
    user("2026-11-01T01:00:00Z", "first task", at("alpha")),
    assistant("2026-11-01T01:00:05Z", "a1", { output_tokens: 100, input_tokens: 10 }, { content: [{ type: "tool_use", id: "t1", name: "Bash" }], rec: at("alpha") }),
    user("2026-11-01T01:00:06Z", [{ type: "tool_result", tool_use_id: "t1", content: "x", is_error: true }], { ...at("alpha"), toolUseResult: "x" }),
    assistant("2026-11-01T02:30:00Z", "a2", { output_tokens: 300 }, { content: [{ type: "tool_use", id: "t2", name: "Agent" }], rec: at("alpha") }),
    { type: "custom-title", customTitle: "Alpha work" },
    // Haiku has no request in the transcript: its cost lands on the session's first hour.
    cost(5, { modelUsage: { "claude-opus-5-5": { costUSD: 4 }, "claude-haiku-5-5": { costUSD: 1 } } }),
  ]);
  writeTranscript(home.transcripts, "alpha", a, [assistant("2026-11-01T02:31:00Z", "a-sub", { output_tokens: 50 }, { model: "claude-sonnet-5-5", rec: { isSidechain: true, ...at("alpha") } })], { agent: "s1" });
  writeFileSync(join(home.transcripts, "alpha", a, "subagents", "agent-s1.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "t2" }));
  writeTranscript(home.transcripts, "beta", b, [
    user("2026-11-02T16:59:00Z", "second", at("beta")),
    assistant("2026-11-02T17:00:00Z", "b1", { output_tokens: 1000 }, { model: "claude-fable-5-2", rec: at("beta") }),
    cost(2, { modelUsage: { "claude-fable-5-2": { costUSD: 2 } } }),
  ]);
  writeTranscript(home.transcripts, "beta", c, [user("2026-11-02T03:00:00Z", "no cost here", at("beta")), assistant("2026-11-02T03:00:01Z", "c1", { output_tokens: 7 }, { rec: at("beta") })]);
  home.run("scan");
  return { home, a, b, c };
}

const usage = (home, ...args) => {
  const r = home.run("usage", "--since", "2026-11-01", "--until", "2026-11-03", "--json", ...args);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("every grouping of one window reports the same totals", () => {
  const { home } = usageHome();
  const base = usage(home).total;
  assert.equal(base.o, 100 + 300 + 50 + 1000 + 7);
  assert.equal(base.q, 5);
  assert.equal(Math.round(base.c * 100) / 100, 7);
  // Speed leaves out the session without a cost record, which gives no API time: two minutes for the other two.
  assert.equal(base.tps, (100 + 300 + 50 + 1000) / 120);
  for (const by of ["day", "model", "project", "session", "hour"]) {
    const g = usage(home, "--by", by);
    assert.deepEqual(g.total, base, by);
    const rows = g.groups[0].rows;
    for (const k of ["q", "i", "o", "th", "cr", "cw"]) assert.equal(rows.reduce((n, r) => n + r[k], 0), base[k], `${by} ${k}`);
    assert.ok(Math.abs(rows.reduce((n, r) => n + r.c, 0) - base.c) < 1e-9, `${by} cost`);
  }
});

test("days and hours are local, costs follow their model, and filters narrow", () => {
  const { home, a, c } = usageHome();
  const days = Object.fromEntries(usage(home, "--by", "day").groups[0].rows.map((r) => [r.key, r.o]));
  // 2026-11-02T17:00Z is the 3rd at midnight in UTC+7.
  assert.deepEqual(days, { "2026-11-01": 450, "2026-11-02": 7, "2026-11-03": 1000 });
  const models = Object.fromEntries(usage(home, "--by", "model").groups[0].rows.map((r) => [r.key, Math.round(r.c * 100) / 100]));
  assert.deepEqual(models, { Opus: 4, Fable: 2, Sonnet: 0, Haiku: 1 });
  const hours = Object.fromEntries(usage(home, "--by", "hour").groups[0].rows.map((r) => [r.key, r.o]));
  assert.deepEqual(hours, { 0: 1000, 8: 100, 9: 350, 10: 7 });
  assert.equal(usage(home, "--project", "beta").total.o, 1007);
  assert.equal(usage(home, "--model", "opus").total.o, 407);
  assert.equal(usage(home, "--project", "alpha", "--model", "sonnet").total.o, 50);
  const gaps = usage(home).total.costGaps;
  assert.deepEqual(gaps, [{ id: c, costState: "unknown" }]);
  const session = usage(home, "--by", "session").groups[0].rows.find((r) => r.key === a);
  assert.equal(session.title, "Alpha work");
  assert.equal(session.duration, 90);
  assert.equal(session.owner, 1);
  assert.equal(session.added, 5);
  assert.match(home.run("usage", "--since", "2026-11-01", "--until", "2026-11-03").stdout, /no cost record and no price for a model {2}no cost here/);
  assert.match(home.run("usage", "--project", "nope").stderr, /no project named nope/);
});

test("tool calls and subagents of the sessions in the window", () => {
  const { home } = usageHome();
  assert.deepEqual(usage(home, "--by", "tool").groups[0].rows, [
    { key: "Agent", calls: 1, errors: 0 },
    { key: "Bash", calls: 1, errors: 1 },
  ]);
  assert.deepEqual(usage(home, "--by", "subagent").groups[0].rows, [{ key: "Explore", count: 1, o: 50, models: { Sonnet: 1 } }]);
  assert.deepEqual(usage(home, "--since", "2026-11-03", "--until", "2026-11-03", "--by", "tool").groups[0].rows, []);
});

test("the dashboard rows give the usage totals", () => {
  const { home } = usageHome();
  const data = buildUsageRows(loadConfig(home.config));
  const all = usage(home).total;
  const inWindow = data.facts.filter((f) => f[1] >= "2026-11-01" && f[1] <= "2026-11-03");
  assert.equal(inWindow.reduce((n, f) => n + f[8], 0), all.o);
  assert.ok(Math.abs(inWindow.reduce((n, f) => n + f[12], 0) - all.c) < 1e-9);
});

test("a cost with no request is split by the host's tokens, and web search is what a model cost beyond its tokens", () => {
  const home = makeHome();
  writeFileSync(join(home.dir, "prices.md"), ["| model | from | input | output | cache read | cache write 5m | cache write 1h |", "| --- | --- | --- | --- | --- | --- | --- |",
    "| claude-opus-5-5 | 2026-10-01 | 4 | 20 | 0.20 | 5 | 8 |", "| claude-haiku-5-5 | 2026-10-01 | 0.10 | 0.50 | 0.01 | 0.125 | 0.20 |"].join("\n") + "\n");
  const dir = join(home.dir, "work", "gamma");
  mkdirSync(join(dir, ".git"), { recursive: true });
  const s = sid(70);
  // Opus searched twice and has its request in the transcript; Haiku searched three times in the background, with no request.
  writeTranscript(home.transcripts, "gamma", s, [
    user("2026-11-05T01:00:00Z", "look it up", { cwd: dir }),
    assistant("2026-11-05T01:00:05Z", "g1", { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, { rec: { cwd: dir } }),
    cost(0.114, { modelUsage: {
      "claude-opus-5-5": { costUSD: 0.044, inputTokens: 1000, outputTokens: 1000, webSearchRequests: 2 },
      "claude-haiku-5-5": { costUSD: 0.07, inputTokens: 100000, outputTokens: 20000, cacheReadInputTokens: 1000000, cacheCreationInputTokens: 50000, cacheCreationEphemeral5mInputTokens: 0, cacheCreationEphemeral1hInputTokens: 50000, webSearchRequests: 3 },
    } }),
  ]);
  home.run("scan");
  const data = buildUsageRows(loadConfig(home.config));
  const k = (m) => data.facts.find((f) => f[3] === data.models.indexOf(m))[14].map((x) => Math.round(x * 1e4) / 1e4);
  assert.deepEqual(k("Opus"), [0.004, 0, 0.02, 0.02]);
  assert.deepEqual(k("Haiku"), [0.02, 0.01, 0.01, 0.03]);
  assert.ok(Math.abs(data.facts.reduce((n, f) => n + f[12], 0) - 0.114) < 1e-9);
});
