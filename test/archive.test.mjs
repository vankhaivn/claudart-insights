import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { zstdDecompressSync } from "node:zlib";
import { appendChunk, archiveLines, readLine } from "../src/archive.mjs";
import { assistant, jsonl, sid, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";

// An archive file decoded frame by frame, as standard zstd.
function archived(home, rel) {
  let buf = readFileSync(join(home.data, "archive", "claude", `${rel}.zst`)), out = "";
  while (buf.length) {
    const { buffer, engine } = zstdDecompressSync(buf, { info: true });
    out += buffer.toString("utf8");
    buf = buf.subarray(engine.bytesWritten);
  }
  return out;
}

test("an archive file of many large frames reads back every line in order", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "insights-arc-")), "t.jsonl.zst");
  const lines = Array.from({ length: 30 }, (_, i) => `{"n":${i},"pad":"${String(i).repeat(40000)}"}`);
  for (let i = 0; i < lines.length; i += 10) appendChunk(path, Buffer.from(lines.slice(i, i + 10).join("\n") + "\n"));
  const read = [];
  for await (const l of archiveLines(path)) read.push(l);
  assert.deepEqual(read.map((l) => l.text), lines);
  assert.deepEqual(read.map((l) => l.line), lines.map((_, i) => i + 1));
  assert.equal(await readLine(path, 25), lines[24]);
  assert.equal(await readLine(path, 31), null);
});

test("archive appends only complete new lines and keeps line numbers", () => {
  const home = makeHome();
  const s = sid(1);
  const first = [user("2026-11-01T01:00:00Z", "hello"), assistant("2026-11-01T01:00:01Z", "m1", {})];
  const path = writeTranscript(home.transcripts, "slug", s, first);
  assert.equal(home.run("scan").code, 0);
  assert.equal(archived(home, `slug/${s}.jsonl`), jsonl(first));

  // Growth ending in an unfinished line: only the complete line is taken.
  const next = user("2026-11-01T01:05:00Z", "more");
  const tail = JSON.stringify(user("2026-11-01T01:06:00Z", "tail"));
  writeTranscript(home.transcripts, "slug", s, null, { append: true, raw: `${JSON.stringify(next)}\n${tail.slice(0, 20)}` });
  home.run("scan");
  assert.equal(archived(home, `slug/${s}.jsonl`), jsonl([...first, next]));

  // The line completes on a later scan; earlier line numbers are unchanged.
  writeTranscript(home.transcripts, "slug", s, null, { append: true, raw: `${tail.slice(20)}\n` });
  home.run("scan");
  const lines = archived(home, `slug/${s}.jsonl`).split("\n");
  assert.equal(lines.length, 5);
  assert.equal(lines[2], JSON.stringify(next));
  assert.equal(lines[3], tail);
  assert.equal(readFileSync(path, "utf8"), lines.join("\n"));
  assert.equal(JSON.parse(home.run("show", `${s.slice(0, 8)}:4`).stdout).message.content, "tail");

  // Unchanged file: nothing new.
  assert.equal(home.run("scan").stdout, "nothing new\n");
});

test("a rewritten head keeps the old copy as a generation and ingests again without double counting", () => {
  const home = makeHome();
  const s = sid(2);
  const old = [user("2026-11-01T01:00:00Z", "first"), assistant("2026-11-01T01:00:01Z", "m-old", { output_tokens: 7 })];
  writeTranscript(home.transcripts, "slug", s, old);
  home.run("scan");
  const fresh = [user("2026-11-02T01:00:00Z", "rewritten"), assistant("2026-11-02T01:00:01Z", "m-new", { output_tokens: 9 }), user("2026-11-02T01:00:02Z", "x")];
  writeTranscript(home.transcripts, "slug", s, fresh);
  const r = home.run("scan");
  assert.match(r.stdout, /1 rewritten files kept as generations/);
  assert.equal(archived(home, `slug/${s}.g1.jsonl`), jsonl(old));
  assert.equal(archived(home, `slug/${s}.jsonl`), jsonl(fresh));
  const db = new DatabaseSync(join(home.data, "usage.db"));
  assert.deepEqual(db.prepare("SELECT message_id, output FROM requests").all().map((x) => ({ ...x })), [{ message_id: "m-new", output: 9 }]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM records").get().n, 3);
});

test("a shorter file is a rewrite too", () => {
  const home = makeHome();
  const s = sid(3);
  writeTranscript(home.transcripts, "slug", s, [user("2026-11-01T01:00:00Z", "a"), user("2026-11-01T01:00:01Z", "b")]);
  home.run("scan");
  const short = [user("2026-11-01T02:00:00Z", "c")];
  writeTranscript(home.transcripts, "slug", s, short);
  home.run("scan");
  assert.ok(existsSync(join(home.data, "archive", "claude", "slug", `${s}.g1.jsonl.zst`)));
  assert.equal(archived(home, `slug/${s}.jsonl`), jsonl(short));
});

test("other session-folder files are copied when they change", () => {
  const home = makeHome();
  const s = sid(4);
  writeTranscript(home.transcripts, "slug", s, [user("2026-11-01T01:00:00Z", "a")]);
  writeTranscript(home.transcripts, "slug", s, null, { agent: "abc", raw: jsonl([assistant("2026-11-01T01:00:02Z", "m-sub", {}, { rec: { isSidechain: true } })]) });
  writeFileSync(join(home.transcripts, "slug", s, "subagents", "agent-abc.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "toolu_1" }));
  assert.match(home.run("scan").stdout, /copied 1 other files/);
  assert.ok(existsSync(join(home.data, "archive", "claude", "slug", s, "subagents", "agent-abc.meta.json")));
  assert.equal(home.run("scan").stdout, "nothing new\n");
});
