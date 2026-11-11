import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { assistant, cost, sid, touch, user, writeTranscript } from "./fixtures/build.mjs";
import { makeHome } from "./fixtures/home.mjs";
import { skillSource } from "../src/providers/claude.mjs";

const rows = (home, sql, ...args) => new DatabaseSync(join(home.data, "usage.db")).prepare(sql).all(...args).map((r) => ({ ...r }));

test("usage counts once per message id, and copied records belong to the earlier file", () => {
  const home = makeHome();
  // The continuation sorts first by name and starts with the same timestamp; its later write decides.
  const a = sid(11);
  const b = sid(10);
  const shared = [user("2026-11-01T01:00:00Z", "start"), assistant("2026-11-01T01:00:01Z", "m1", { output_tokens: 30 }), assistant("2026-11-01T01:00:01Z", "m1", { output_tokens: 30 })];
  touch(writeTranscript(home.transcripts, "slug", a, [...shared, cost(2, { startTime: Date.parse("2026-11-01T00:59:59Z") })]), 1000);
  // A continuation copies the earlier records, then adds its own; its cost record starts before its own records.
  writeTranscript(home.transcripts, "slug", b, [...shared, user("2026-11-02T01:00:00Z", "again"), assistant("2026-11-02T01:00:01Z", "m2", { output_tokens: 5 }), cost(3, { startTime: Date.parse("2026-11-01T00:59:59Z") })]);
  // A fork or resume in a new process starts its own cost record and pays only for itself.
  const c = sid(12);
  writeTranscript(home.transcripts, "slug", c, [...shared, user("2026-11-03T01:00:00Z", "fresh"), cost(0.5, { startTime: Date.parse("2026-11-03T01:00:00Z") })]);
  home.run("scan");
  assert.deepEqual(rows(home, "SELECT cost, carried_from FROM sessions WHERE id = ?", c), [{ cost: 0.5, carried_from: null }]);
  assert.deepEqual(rows(home, "SELECT message_id, session_id, output FROM requests ORDER BY message_id"), [
    { message_id: "m1", session_id: a, output: 30 },
    { message_id: "m2", session_id: b, output: 5 },
  ]);
  assert.deepEqual(rows(home, "SELECT text, session_id FROM owner_messages ORDER BY ts"), [
    { text: "start", session_id: a },
    { text: "again", session_id: b },
    { text: "fresh", session_id: c },
  ]);
  assert.equal(rows(home, "SELECT COUNT(*) n FROM records")[0].n, 6);
  // b's host record started with a's, so it holds all of a's cost, which is subtracted.
  const s = rows(home, "SELECT id, cost, carried_from FROM sessions WHERE id IN (?, ?) ORDER BY id", a, b);
  assert.deepEqual(s, [
    { id: b, cost: 1, carried_from: a },
    { id: a, cost: 2, carried_from: null },
  ]);
});

test("a copied record belongs to the session that wrote it, whichever file is read first", () => {
  const home = makeHome();
  const older = sid(21);
  const newer = sid(20);
  // The fork sorts first by name and by its first timestamp; the copied records still name the older session.
  const shared = [user("2026-11-01T01:00:00Z", "shared", { sessionId: older }), assistant("2026-11-01T01:00:01Z", "m-shared", {}, { rec: { sessionId: older } })];
  writeTranscript(home.transcripts, "slug", newer, [{ type: "queue-operation", timestamp: "2026-10-01T00:00:00Z", sessionId: older }, ...shared, user("2026-11-03T01:00:00Z", "own")]);
  writeTranscript(home.transcripts, "slug", older, [user("2026-10-30T01:00:00Z", "first"), ...shared]);
  home.run("scan");
  assert.equal(rows(home, "SELECT session_id FROM requests WHERE message_id = 'm-shared'")[0].session_id, older);
  assert.deepEqual(rows(home, "SELECT id, first_ts FROM sessions ORDER BY id"), [
    { id: newer, first_ts: "2026-11-03T01:00:00Z" },
    { id: older, first_ts: "2026-10-30T01:00:00Z" },
  ]);
});

test("only the owner's own words are kept as owner messages", () => {
  const home = makeHome();
  const s = sid(30);
  const t = (m) => `2026-11-01T01:${String(m).padStart(2, "0")}:00Z`;
  writeTranscript(home.transcripts, "slug", s, [
    user(t(1), "typed string"),
    user(t(2), [{ type: "text", text: "typed block" }]),
    user(t(3), [{ type: "tool_result", tool_use_id: "toolu_x", content: "output" }], { toolUseResult: "output" }),
    user(t(4), "skill body", { isMeta: true }),
    user(t(5), "side chain", { isSidechain: true }),
    user(t(6), "<system-reminder>\nnote\n</system-reminder>"),
    user(t(7), "<task-notification> done </task-notification>"),
    user(t(8), "This session is being continued from a previous conversation.", { isCompactSummary: true }),
    user(t(9), "Background (from the session that started this one)", { turnOrigin: "sdk" }),
    user(t(10), "<command-message>cda-task</command-message>\n<command-name>/cda-task</command-name>\n<command-args>fix the login</command-args>"),
    user(t(11), [{ type: "tool_result", tool_use_id: "toolu_q", content: "The user answered" }], { toolUseResult: { questions: [{ question: "Which?" }], answers: { "Which?": "the second one" } } }),
    { type: "session-owner", accountUuid: "acct", organizationUuid: "org" },
    { type: "mystery-kind", uuid: "u-mystery", timestamp: t(12) },
  ]);
  writeTranscript(home.transcripts, "slug", s, [user(t(13), "subagent prompt", { isSidechain: true })], { agent: "a1" });
  home.run("scan");
  assert.deepEqual(rows(home, "SELECT kind, text, line FROM owner_messages ORDER BY line"), [
    { kind: "typed", text: "typed string", line: 1 },
    { kind: "typed", text: "typed block", line: 2 },
    { kind: "typed", text: "/cda-task fix the login", line: 10 },
    { kind: "popup", text: "the second one", line: 11 },
  ]);
  assert.equal(rows(home, "SELECT COUNT(*) n FROM compactions")[0].n, 1);
  assert.deepEqual(rows(home, "SELECT type FROM records WHERE uuid = 'u-mystery'"), [{ type: "mystery-kind" }]);
  // No row anywhere holds the account identifiers of the session-owner record.
  const db = new DatabaseSync(join(home.data, "usage.db"));
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    for (const r of db.prepare(`SELECT * FROM "${name}"`).all()) assert.ok(!JSON.stringify(r).includes("acct"), `${name} holds an account id`);
  }
});

test("costs, titles, tool calls and subagents", () => {
  const home = makeHome();
  const noCost = sid(40);
  const partial = sid(41);
  writeTranscript(home.transcripts, "slug", noCost, [user("2026-11-01T01:00:00Z", "Fix the thing\nwith details"), assistant("2026-11-01T01:00:01Z", "m40", {})]);
  writeTranscript(home.transcripts, "slug", partial, [
    user("2026-11-01T02:00:00Z", "go"),
    assistant("2026-11-01T02:00:01Z", "m41", {}, { content: [{ type: "tool_use", id: "toolu_a", name: "Bash" }, { type: "tool_use", id: "toolu_b", name: "Read" }] }),
    user("2026-11-01T02:00:02Z", [{ type: "tool_result", tool_use_id: "toolu_a", content: "x", is_error: true }, { type: "tool_result", tool_use_id: "toolu_b", content: "y" }], { toolUseResult: "x" }),
    { type: "ai-title", aiTitle: "Old title", sessionId: partial },
    { type: "custom-title", customTitle: "Named", sessionId: partial },
    cost(1, { incomplete: true }),
    cost(4, { incomplete: true }),
  ]);
  writeTranscript(home.transcripts, "slug", partial, [assistant("2026-11-01T02:00:05Z", "m41-sub", {}, { model: "claude-haiku-5-5", rec: { isSidechain: true } })], { agent: "s1" });
  writeFileSync(join(home.transcripts, "slug", partial, "subagents", "agent-s1.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "toolu_a" }));
  writeTranscript(home.transcripts, "slug", partial, [assistant("2026-11-01T02:00:06Z", "m41-sub2", {}, { model: "<synthetic>" })], { agent: "s2" });
  home.run("scan");
  assert.deepEqual(rows(home, "SELECT id, title, cost, cost_incomplete FROM sessions ORDER BY id"), [
    { id: noCost, title: "Fix the thing", cost: null, cost_incomplete: null },
    { id: partial, title: "Named", cost: 4, cost_incomplete: 1 },
  ]);
  assert.deepEqual(rows(home, "SELECT name, is_error FROM tool_calls ORDER BY name"), [
    { name: "Bash", is_error: 1 },
    { name: "Read", is_error: 0 },
  ]);
  assert.deepEqual(rows(home, "SELECT agent_id, type, tool_use_id FROM subagents ORDER BY agent_id"), [
    { agent_id: "s1", type: "Explore", tool_use_id: "toolu_a" },
    { agent_id: "s2", type: null, tool_use_id: null },
  ]);
  assert.deepEqual(rows(home, "SELECT message_id, family, is_sub, day, hour FROM requests ORDER BY message_id"), [
    { message_id: "m40", family: "opus", is_sub: 0, day: "2026-11-01", hour: 8 },
    { message_id: "m41", family: "opus", is_sub: 0, day: "2026-11-01", hour: 9 },
    { message_id: "m41-sub", family: "haiku", is_sub: 1, day: "2026-11-01", hour: 9 },
  ]);
});

test("skills the agent called and the owner typed, with the folder each was loaded from", () => {
  const home = makeHome();
  const s = sid(50);
  const call = (ts, id, skill) => assistant(ts, `m-${id}`, {}, { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] });
  const result = (ts, id, error = false) => user(ts, [{ type: "tool_result", tool_use_id: id, content: error ? "not allowed" : `Launching skill`, is_error: error }], { toolUseResult: {} });
  const loaded = (ts, dir, link) => user(ts, [{ type: "text", text: `Base directory for this skill: ${dir}\n\nInstructions` }], { isMeta: true, ...link });
  const typed = user("2026-11-01T01:00:00Z", "<command-message>review</command-message>\n<command-name>/review</command-name>");
  const compact = user("2026-11-01T01:30:00Z", "<command-message>compact</command-message>\n<command-name>/compact</command-name>");
  writeTranscript(home.transcripts, "slug", s, [
    typed,
    loaded("2026-11-01T01:00:00Z", "/work/demo/.claude/skills/review", { parentUuid: typed.uuid }),
    call("2026-11-01T01:00:05Z", "toolu_s1", "review"),
    result("2026-11-01T01:00:06Z", "toolu_s1"),
    // Loaded earlier in the session: the host names no folder this time.
    user("2026-11-01T01:00:06Z", [{ type: "text", text: "Skill /review is already loaded above" }], { isMeta: true, sourceToolUseID: "toolu_s1" }),
    call("2026-11-01T01:10:00Z", "toolu_s2", "docs:pdf"),
    result("2026-11-01T01:10:01Z", "toolu_s2"),
    loaded("2026-11-01T01:10:01Z", "/opt/host/skills-plugin/abc/skills/pdf", { sourceToolUseID: "toolu_s2" }),
    call("2026-11-01T01:20:00Z", "toolu_s3", "simplify"),
    result("2026-11-01T01:20:01Z", "toolu_s3"),
    loaded("2026-11-01T01:20:01Z", "/tmp/host/bundled-skills/2.1.0/abc", { sourceToolUseID: "toolu_s3" }),
    call("2026-11-01T01:25:00Z", "toolu_s4", "release"),
    result("2026-11-01T01:25:01Z", "toolu_s4", true),
    compact,
  ]);
  home.run("scan");
  assert.deepEqual(rows(home, "SELECT name, via, source, is_error FROM skills ORDER BY ts"), [
    { name: "review", via: "command", source: "project", is_error: 0 },
    { name: "review", via: "agent", source: null, is_error: 0 },
    { name: "docs:pdf", via: "agent", source: "plugin", is_error: 0 },
    { name: "simplify", via: "agent", source: "builtin", is_error: 0 },
    { name: "release", via: "agent", source: null, is_error: 1 },
    { name: "compact", via: "command", source: null, is_error: 0 },
  ]);
  const usage = JSON.parse(home.run("usage", "--since", "2026-11-01", "--until", "2026-11-01", "--by", "skill", "--json").stdout);
  assert.deepEqual(usage.groups[0].rows, [
    { key: "review", source: "project", uses: 2, command: 1, agent: 1, errors: 0, sessions: 1, last: "2026-11-01" },
    { key: "docs:pdf", source: "plugin", uses: 1, command: 0, agent: 1, errors: 0, sessions: 1, last: "2026-11-01" },
    { key: "simplify", source: "builtin", uses: 1, command: 0, agent: 1, errors: 0, sessions: 1, last: "2026-11-01" },
    { key: "release", source: "other", uses: 1, command: 0, agent: 1, errors: 1, sessions: 1, last: "2026-11-01" },
  ]);
});

test("a skill's source follows the folder the host loaded it from", () => {
  const home = "/home/u";
  assert.equal(skillSource("/home/u/.claude/skills/notes", home), "personal");
  assert.equal(skillSource("/home/u/code/app/.claude/skills/deploy", home), "project");
  assert.equal(skillSource("/home/u/.claude/plugins/cache/x/skills/pdf", home), "plugin");
  assert.equal(skillSource("/var/folders/t/bundled-skills/2.1.0/abc", home), "builtin");
  assert.equal(skillSource("/home/u/code/app", home), "other");
});
