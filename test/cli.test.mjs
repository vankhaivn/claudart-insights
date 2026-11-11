import assert from "node:assert/strict";
import { test } from "node:test";
import { makeHome } from "./fixtures/home.mjs";

test("no command or an unknown one prints usage and exits non-zero", () => {
  const home = makeHome();
  for (const args of [[], ["nope"]]) {
    const r = home.run(...args);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /usage: node bin\/insights\.mjs/);
  }
  assert.match(home.run("nope").stderr, /unknown command: nope/);
});
