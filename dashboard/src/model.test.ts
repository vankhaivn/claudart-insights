import assert from "node:assert/strict";
import { test } from "node:test";
import { rebuilds, type Fact } from "./model.ts";
import { parseUrl } from "./state.ts";

const fact = (rb: number[] | null): Fact => ({ s: 0, d: "2026-11-01", h: 0, m: 0, sub: 0, e: 0, q: 1, i: 0, o: 0, cr: 0, cw: 0, th: 0, c: 0, rb });

test("rebuilds sums the facts' vectors per cause and splits the idle ones by gap", () => {
  // start, compaction, idle, other as [count, tokens, extra], then the three idle gap counts.
  const a = [1, 100, 0.5, 0, 0, 0, 2, 300, 1.5, 0, 0, 0, 1, 0, 1];
  const b = [0, 0, 0, 1, 50, 0.25, 0, 0, 0, 3, 90, 0.75, 0, 0, 0];
  assert.deepEqual(rebuilds([fact(a), fact(null), fact(b)]), {
    start: { n: 1, tokens: 100, extra: 0.5 }, compaction: { n: 1, tokens: 50, extra: 0.25 }, idle: { n: 2, tokens: 300, extra: 1.5 }, other: { n: 3, tokens: 90, extra: 0.75 }, gaps: [1, 0, 1],
  });
  assert.equal(rebuilds([]).idle.n, 0);
});

test("the cache lapses column is a sort key of the address bar", () => {
  assert.equal(parseUrl("/sessions", "sort=lapses").sort, "lapses");
});
