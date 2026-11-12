import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, parseUrl, toUrl, type UrlState } from "./state.ts";

const round = (s: UrlState) => { const u = new URL(toUrl(s), "http://x"); return parseUrl(u.pathname, u.search); };

test("the address bar holds the view and every filter, and reads back the same", () => {
  const cases: [Partial<UrlState>, string][] = [
    [{}, "/"],
    [{ view: "sessions", range: "7" }, "/sessions?range=7"],
    [{ view: "subagents", range: "", from: "2026-11-01", to: "2026-11-03", project: "alpha", model: "Opus", effort: "xhigh", metric: "cost" }, "/subagents?from=2026-11-01&to=2026-11-03&project=alpha&model=Opus&effort=xhigh&metric=cost"],
    [{ view: "sessions", sort: "turns", dir: 1, q: "cda fix" }, "/sessions?q=cda+fix&sort=turns&dir=asc"],
    [{ view: "activity", range: "all" }, "/activity?range=all"],
    [{ metric: "cost", split: "kind", heat: "out" }, "/?metric=cost&split=kind&heat=out"],
    [{ split: "project", chart: "share" }, "/?split=project&chart=share"],
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

test("a view a host package adds is routed like a built-in one, and only when it is declared", () => {
  assert.equal(parseUrl("/notes", "", ["notes"]).view, "notes");
  assert.equal(parseUrl("/notes", "").view, "overview");
  assert.equal(toUrl({ ...DEFAULTS, view: "notes", range: "7" }), "/notes?range=7");
  const u = new URL(toUrl({ ...DEFAULTS, view: "notes", project: "alpha" }), "http://x");
  assert.deepEqual([parseUrl(u.pathname, u.search, ["notes"]).view, parseUrl(u.pathname, u.search, ["notes"]).project], ["notes", "alpha"]);
});

test("the chart form is kept in the address, columns by default", () => {
  assert.equal(parseUrl("/", "").chart, "bar");
  assert.equal(parseUrl("/", "chart=area").chart, "area");
  assert.equal(parseUrl("/", "chart=share").chart, "share");
  assert.equal(parseUrl("/", "chart=pie").chart, "bar");
  assert.equal(toUrl({ ...DEFAULTS, chart: "area" }), "/?chart=area");
  assert.equal(toUrl(DEFAULTS), "/");
});
