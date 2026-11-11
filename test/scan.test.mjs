import assert from "node:assert/strict";
import { chmodSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { assistant, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

const counts = (home) => {
  const db = new DatabaseSync(join(home.data, "usage.db"));
  return Object.fromEntries(["files", "records", "requests", "owner_messages", "tool_calls", "sessions"].map((t) => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
};

test("scan creates the archive and database, and a second scan adds nothing", () => {
  const home = makeHome();
  writeTranscript(home.transcripts, "slug", sid(50), [user("2026-11-01T01:00:00Z", "hi"), assistant("2026-11-01T01:00:01Z", "m50", {})]);
  writeTranscript(home.transcripts, "slug", sid(51), [user("2026-11-01T02:00:00Z", "ho")]);
  const first = home.run("scan");
  assert.equal(first.code, 0);
  assert.match(first.stdout, /^added 2 transcript files, \d+ bytes, 2 sessions, 3 records/);
  const before = counts(home);
  assert.equal(home.run("scan").stdout, "nothing new\n");
  assert.deepEqual(counts(home), before);
});

test("a deleted transcript still resolves with show and keeps its session", () => {
  const home = makeHome();
  const s = sid(52);
  writeTranscript(home.transcripts, "slug", s, [user("2026-11-01T01:00:00Z", "keep me"), assistant("2026-11-01T01:00:01Z", "m52", {})]);
  home.run("scan");
  rmSync(join(home.transcripts, "slug"), { recursive: true });
  assert.equal(home.run("scan").code, 0);
  assert.equal(JSON.parse(home.run("show", `${s.slice(0, 8)}:1`).stdout).message.content, "keep me");
  assert.equal(counts(home).sessions, 1);
  // A rebuilt database recovers the deleted session from the archive alone.
  rmSync(join(home.data, "usage.db"));
  home.run("scan");
  assert.equal(counts(home).sessions, 1);
  assert.equal(counts(home).requests, 1);
});

test("scan reads the host folder without writing to it", () => {
  const home = makeHome();
  writeTranscript(home.transcripts, "slug", sid(53), [user("2026-11-01T01:00:00Z", "ro")]);
  const tree = (dir) => readdirSync(dir, { recursive: true }).map((p) => `${p}:${statSync(join(dir, p)).mtimeMs}`).sort();
  const host = join(home.dir, "home");
  const before = tree(host);
  const walk = (dir, mode) => {
    for (const p of readdirSync(dir, { recursive: true })) chmodSync(join(dir, p), statSync(join(dir, p)).isDirectory() ? mode | 0o111 : mode);
    chmodSync(dir, mode | 0o111);
  };
  walk(host, 0o444);
  try {
    const r = home.run("scan");
    assert.equal(r.code, 0, r.stderr);
  } finally {
    walk(host, 0o644);
  }
  assert.deepEqual(tree(host), before);
});

test("show reports a bad reference", () => {
  const home = makeHome();
  writeTranscript(home.transcripts, "slug", sid(54), [user("2026-11-01T01:00:00Z", "x")]);
  home.run("scan");
  assert.match(home.run("show", "00000054:9").stderr, /has no line 9/);
  assert.match(home.run("show", "ffff:1").stderr, /no archived transcript/);
  assert.notEqual(home.run("show", "nonsense").code, 0);
});
