import assert from "node:assert/strict";
import { test } from "node:test";
import { rebuilds, skillUses, type Fact, type Model } from "./model.ts";
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
