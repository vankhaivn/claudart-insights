import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, parseUrl, toUrl, type UrlState } from "./state.ts";

const round = (s: UrlState) => { const u = new URL(toUrl(s), "http://x"); return parseUrl(u.pathname, u.search); };

test("the address bar holds the view and every filter, and reads back the same", () => {
  const cases: [Partial<UrlState>, string][] = [
    [{}, "/"],
    [{ view: "sessions", range: "7" }, "/sessions?range=7"],
    [{ view: "effort", range: "", from: "2026-11-01", to: "2026-11-03", project: "alpha", model: "Opus", effort: "xhigh", metric: "cost" }, "/effort?from=2026-11-01&to=2026-11-03&project=alpha&model=Opus&effort=xhigh&metric=cost"],
    [{ view: "sessions", sort: "project", dir: 1, q: "cda fix" }, "/sessions?q=cda+fix&sort=project&dir=asc"],
    [{ view: "activity", range: "all" }, "/activity?range=all"],
  ];
  for (const [patch, url] of cases) {
    const s = { ...DEFAULTS, ...patch };
    assert.equal(toUrl(s), url);
    assert.deepEqual(round(s), s, url);
  }
});

test("an unknown or broken address falls back to the defaults it cannot read", () => {
  assert.deepEqual(parseUrl("/nope", "?range=9&metric=x&sort=y&dir=up"), DEFAULTS);
  // A custom window needs two valid days in order; otherwise the default range applies.
  assert.deepEqual(parseUrl("/", "?from=2026-11-05&to=2026-11-01"), DEFAULTS);
  assert.deepEqual(parseUrl("/", "?from=2026-11-05"), DEFAULTS);
  assert.equal(parseUrl("/sessions/", "").view, "sessions");
});
