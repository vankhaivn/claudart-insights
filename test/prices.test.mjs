import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { buildUsageRows } from "../src/dashboard.mjs";
import { assistant, cost, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

// Opus output costs 10 per million tokens until 2026-11-01 and 30 from 2026-11-02; every other token is free.
const TABLE = `| model | from | input | output | cache read | cache write 5m | cache write 1h |
| --- | --- | --- | --- | --- | --- | --- |
| claude-opus-5-5 | 2026-10-01 | 0 | 10 | 0 | 0 | 0 |
| claude-opus-5-5 | 2026-11-02 | 0 | 30 | 0 | 0 | 0 |
`;

function pricedHome() {
  const home = makeHome();
  const cwd = join(home.dir, "work", "alpha");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  writeFileSync(join(home.dir, "prices.md"), TABLE);
  const rec = { cwd };
  const at = (ts, id, out, model = "claude-opus-5-5") => assistant(ts, id, { output_tokens: out }, { model, rec });
  const ids = { split: sid(70), unpriced: sid(71), estimated: sid(72), unknown: sid(73), miss: sid(74), fits: sid(75) };
  const write = (id, records) => writeTranscript(home.transcripts, "alpha", id, [user(records[0].timestamp, "go", rec), ...records]);
  // One session across the price change, on a [1m] id: the same output weighs three times as much on the second day.
  write(ids.split, [at("2026-11-01T01:00:00Z", "s1", 100, "claude-opus-5-5[1m]"), at("2026-11-02T01:00:00Z", "s2", 100, "claude-opus-5-5[1m]"),
    cost(4, { modelUsage: { "claude-opus-5-5[1m]": { costUSD: 4 } } })]);
  // No row for Fable: its cost is spread by output tokens.
  write(ids.unpriced, [at("2026-11-03T01:00:00Z", "u1", 100, "claude-fable-5-2"), at("2026-11-03T02:00:00Z", "u2", 300, "claude-fable-5-2"),
    cost(4, { modelUsage: { "claude-fable-5-2": { costUSD: 4 } } })]);
  // No cost record: priced from the table when every model has a row, otherwise unknown.
  write(ids.estimated, [at("2026-11-03T03:00:00Z", "e1", 1000)]);
  write(ids.unknown, [at("2026-11-03T04:00:00Z", "k1", 1000, "claude-fable-5-2")]);
  // Host records with the split: 50,000 output tokens price at $1.50 on the 3rd.
  const tokens = { outputTokens: 50000, cacheCreationEphemeral5mInputTokens: 0, cacheCreationEphemeral1hInputTokens: 0 };
  write(ids.miss, [at("2026-11-03T05:00:00Z", "m1", 50000), cost(1, { modelUsage: { "claude-opus-5-5": { costUSD: 1, ...tokens } } })]);
  write(ids.fits, [at("2026-11-03T06:00:00Z", "f1", 50000), cost(1.5, { modelUsage: { "claude-opus-5-5": { costUSD: 1.5, ...tokens } } })]);
  return { home, ids, scan: home.run("scan") };
}

const json = (r) => {
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("costs are spread by the price in force on each request's day; a model without a row is spread by output", () => {
  const { home, ids } = pricedHome();
  const u = (...a) => json(home.run("usage", "--since", "2026-11-01", "--until", "2026-11-03", "--json", ...a));
  const days = Object.fromEntries(u("--project", "alpha", "--by", "day").groups[0].rows.map((r) => [r.key, Math.round(r.c * 1e4) / 1e4]));
  // 4 split 1:3 by price, then 4 by output 1:3 plus the estimate 1000 x $30 per million.
  assert.deepEqual(days, { "2026-11-01": 1, "2026-11-02": 3, "2026-11-03": 1 + 3 + 0.03 + 1 + 1.5 });
  const all = u();
  assert.deepEqual(all.unpriced, ["claude-fable-5-2"]);
  // Notes belong to the window: the first two days have no Fable request; sessions off the table carry their model.
  assert.deepEqual(json(home.run("usage", "--since", "2026-11-01", "--until", "2026-11-02", "--json")).unpriced, []);
  // The cost split as the table prices it: only output has a price here, so all of a priced cost is output;
  // Fable has no row, so its cost stays unsplit.
  const data = buildUsageRows(loadConfig(home.config)), fable = data.models.indexOf("Fable");
  for (const f of data.facts) {
    if (f[3] === fable) assert.equal(f[14], null);
    else if (f[12]) assert.deepEqual(f[14].map((x) => Math.round(x * 1e6) / 1e6), [0, 0, Math.round(f[12] * 1e6) / 1e6, 0]);
  }
  const rows = data.sessions;
  assert.deepEqual(rows.filter((s) => s.priceOff.length).map((s) => [s.id, s.priceOff]), [[ids.split.slice(0, 8), ["claude-opus-5-5[1m]"]], [ids.miss.slice(0, 8), ["claude-opus-5-5"]]]);
  assert.deepEqual(all.total.costGaps.map((g) => [g.id, g.costState]).sort(), [[ids.estimated, "estimated"], [ids.unknown, "unknown"]].sort());
  assert.match(home.run("usage", "--since", "2026-11-03", "--until", "2026-11-03").stdout, /no cost record; estimated from prices\.md/);
});

test("the check flags a host figure off the table and stays quiet for one on it; a bad row fails scan and prices", () => {
  const { home, ids, scan } = pricedHome();
  assert.equal(scan.code, 0, scan.stderr);
  const v = json(home.run("prices", "--json"));
  const opus = v.report.find((m) => m.model === "claude-opus-5-5");
  assert.deepEqual(opus.misses.map((m) => [m.id, Math.round(m.miss * 100)]), [[ids.miss, 50]]);
  assert.equal(opus.checked, 2);
  assert.deepEqual(v.report.find((m) => m.model === "claude-fable-5-2").skipped, { "no price": 1 });
  assert.deepEqual(v.unpriced.map((r) => r.model), ["claude-fable-5-2"]);
  assert.match(scan.stdout, /price check: claude-opus-5-5 misses the price table by more than 1% in 1 of 2 sessions, first on 2026-11-03/);
  appendFileSync(join(home.dir, "prices.md"), "| claude-opus-5-5 | 2026-13 | 1 | 2 |\n");
  for (const cmd of ["scan", "prices"]) {
    const r = home.run(cmd);
    assert.equal(r.code, 1, cmd);
    assert.match(r.stderr, /prices\.md:5: expected a model id, a YYYY-MM-DD date and five prices/, cmd);
  }
});
