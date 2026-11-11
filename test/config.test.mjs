import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, ROOT } from "../src/config.mjs";
import { projectOf } from "../src/derive.mjs";

test("a missing config file means defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-test-"));
  const c = loadConfig(join(dir, "none.json"));
  assert.equal(c.transcripts, join(homedir(), ".claude", "projects"));
  assert.equal(c.data, join(dir, "data"));
  assert.equal(c.database, join(dir, "data", "usage.db"));
  assert.equal(c.prices, join(ROOT, "prices.md"));
  assert.equal(c.port, 4310);
  assert.equal(c.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("known keys are read and unknown keys are returned untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-test-"));
  const file = join(dir, "c.json");
  writeFileSync(file, JSON.stringify({ port: 5000, timeZone: "UTC", extra: { a: 1 } }));
  const c = loadConfig(file);
  assert.deepEqual([c.port, c.timeZone, c.extra], [5000, "UTC", { a: 1 }]);
  writeFileSync(file, "{");
  assert.throws(() => loadConfig(file), /cannot read config/);
});

test("the project is the nearest folder with .git at or above the cwd, else the cwd's own name", () => {
  const dir = mkdtempSync(join(tmpdir(), "insights-test-"));
  mkdirSync(join(dir, "alpha", ".git"), { recursive: true });
  mkdirSync(join(dir, "alpha", "pkg", "deep"), { recursive: true });
  mkdirSync(join(dir, "plain"), { recursive: true });
  assert.deepEqual(projectOf(join(dir, "alpha", "pkg", "deep")), { name: "alpha", onDisk: true });
  assert.deepEqual(projectOf(join(dir, "plain")), { name: "plain", onDisk: true });
  assert.deepEqual(projectOf(join(dir, "gone", "x")), { name: "x", onDisk: false });
  assert.equal(projectOf(null), null);
});
