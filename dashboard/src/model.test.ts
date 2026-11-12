import assert from "node:assert/strict";
import { test } from "node:test";
import { byDayKinds, context, costParts, rebuilds, skillUses, vsHigh, type Fact, type Model } from "./model.ts";
import { parseUrl } from "./state.ts";

const fact = (rb: number[] | null): Fact => ({ s: 0, d: "2026-11-01", h: 0, m: 0, sub: 0, e: 0, q: 1, i: 0, o: 0, cr: 0, cw: 0, th: 0, c: 0, rb, k: null });

test("rebuilds sums the facts' vectors per cause and splits the idle ones by gap", () => {
  // start, compaction, idle, other as [count, tokens, extra], then the three idle gap counts.
  const a = [1, 100, 0.5, 0, 0, 0, 2, 300, 1.5, 0, 0, 0, 1, 0, 1];
  const b = [0, 0, 0, 1, 50, 0.25, 0, 0, 0, 3, 90, 0.75, 0, 0, 0];
  assert.deepEqual(rebuilds([fact(a), fact(null), fact(b)]), {
    start: { n: 1, tokens: 100, extra: 0.5 }, compaction: { n: 1, tokens: 50, extra: 0.25 }, idle: { n: 2, tokens: 300, extra: 1.5 }, other: { n: 3, tokens: 90, extra: 0.75 }, gaps: [1, 0, 1],
  });
  assert.equal(rebuilds([]).idle.n, 0);
});

test("a sort the sessions table has no column for falls back to the start", () => {
  for (const k of ["project", "tps", "subs", "lapses"]) assert.equal(parseUrl("/sessions", `sort=${k}`).sort, "start");
  assert.equal(parseUrl("/sessions", "sort=ctx").sort, "ctx");
});

test("skillUses sums sessions per skill, listed by source and then most used", () => {
  const M = {
    skills: [{ review: [1, 2, 0, "2026-11-01"], pdf: [0, 1, 1, "2026-11-01"] }, { review: [0, 3, 0, "2026-11-03"], notes: [2, 0, 0, "2026-11-02"] }, { review: [9, 9, 0, "2026-11-04"] }],
    skillSources: { review: "project", pdf: "plugin", notes: "personal" },
  } as unknown as Model;
  assert.deepEqual(skillUses(M, [0, 1]), [
    { name: "review", source: "project", command: 1, agent: 5, errors: 0, sessions: 2, last: "2026-11-03" },
    { name: "notes", source: "personal", command: 2, agent: 0, errors: 0, sessions: 1, last: "2026-11-02" },
    { name: "pdf", source: "plugin", command: 0, agent: 1, errors: 1, sessions: 1, last: "2026-11-01" },
  ]);
});

test("context per request counts input, cache reads and cache writes", () => {
  assert.equal(context({ i: 10, cr: 900, cw: 90, q: 2 }), 500);
  assert.equal(context({ i: 0, cr: 0, cw: 0, q: 0 }), 0);
});

test("cost parts keep what the table cannot split only when it is at least 1% of the cost", () => {
  assert.deepEqual(costParts(10, [5, 2, 1, 0]), [5, 2, 1, 0, 2]);
  assert.deepEqual(costParts(10, [4, 3, 1.95, 1]), [4, 3, 1.95, 1, 0]);
});

test("cost per day splits each fact's priced parts and puts the rest of its cost apart", () => {
  const f = (d: string, c: number, k: number[] | null): Fact => ({ ...fact(null), d, c, k });
  const rows = byDayKinds([f("2026-11-01", 4, [1, 1, 1, 1]), f("2026-11-01", 3, null), f("2026-11-02", 2, [1, 0.5, 0.5, 0])], ["2026-11-01", "2026-11-02"]);
  assert.deepEqual(rows, [[1, 1, 1, 1, 3], [1, 0.5, 0.5, 0, 0]]);
});

test("effort against high compares the same sessions, as the median of their ratios", () => {
  const f = (s: number, sub: number, e: number, q: number, o: number): Fact => ({ ...fact(null), s, sub, e, q, o });
  // Sessions 0-2 ran medium (1) at half, 0.8 and 0.6 of their high (2); session 3 ran only medium, at a far higher
  // output, and session 4 has too few medium requests: neither counts. Session 0's subagents are compared apart.
  const F = [f(0, 0, 1, 10, 500), f(0, 0, 2, 10, 1000), f(1, 0, 1, 5, 400), f(1, 0, 2, 5, 500), f(2, 0, 1, 20, 1200), f(2, 0, 2, 20, 2000),
    f(3, 0, 1, 50, 50000), f(4, 0, 1, 4, 100), f(4, 0, 2, 9, 900), f(0, 1, 1, 5, 5000), f(0, 1, 2, 4, 100)];
  assert.deepEqual(vsHigh(F, 0, 1, 2), { r: 0.6, n: 3 });
  assert.deepEqual(vsHigh(F.filter((x) => x.s !== 2), 0, 1, 2), { r: null, n: 2 });
  assert.deepEqual(vsHigh(F, 1, 1, 2), { r: null, n: 0 });
});
