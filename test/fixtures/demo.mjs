// `make demo`: ten weeks of made-up Claude Code use in a temp folder, scanned and served, for screenshots and trying
// the dashboard without real transcripts. The same seed gives the same data, dated back from today.
import { spawnSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { priceAt, readPrices, requestCost } from "../../src/prices.mjs";
import { assistant, cost, sid, user, writeTranscript } from "./build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.argv[2] ?? 4311);
const DAYS = 70;

// mulberry32: a small seeded generator with a long period.
let seed = 7;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (weighted) => { let r = rnd() * weighted.reduce((n, [, w]) => n + w, 0); for (const [v, w] of weighted) if ((r -= w) < 0) return v; return weighted[0][0]; };

const PROJECTS = [["atlas-web", 30], ["billing-api", 20], ["mobile-app", 15], ["data-pipeline", 10], ["design-system", 8], ["infra", 6], ["docs-site", 4], ["cli-tools", 3], ["sandbox", 2], ["playground", 2]];
const VERBS = ["Fix", "Add", "Refactor", "Speed up", "Test", "Document", "Migrate", "Debug", "Review", "Clean up", "Redesign", "Harden"];
const THINGS = ["the checkout flow", "invoice export", "auth middleware", "the search index", "dark mode", "the router", "API rate limits", "feature flags", "webhook retries",
  "the audit log", "build tooling", "offline drafts", "the billing cron", "usage alerts", "onboarding", "a memory leak", "release notes", "the settings page", "push notifications", "CSV import"];
const TOOLS = [["Bash", 30], ["Read", 22], ["Edit", 16], ["Grep", 9], ["Write", 5], ["Glob", 5], ["TodoWrite", 4], ["WebFetch", 3], ["WebSearch", 2]];
const SUBS = [["Explore", 45], ["general-purpose", 30], ["code-reviewer", 15], ["Plan", 10]];
const MODELS = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" };

const home = mkdtempSync(join(tmpdir(), "insights-demo-"));
const transcripts = join(home, "projects");
const configPath = join(home, "insights.config.json");
writeFileSync(configPath, JSON.stringify({ providers: { claude: { transcripts } }, data: join(home, "data"), port: PORT }));
const prices = readPrices({ prices: join(ROOT, "prices.md") }).rows;

let k = 0, ids = 0;
const msgId = () => `msg_demo_${++ids}`;
const toolId = () => `toolu_demo_${++ids}`;

// One thread of requests: the context grows, the cache is rewritten at the start, after a compaction, after an idle gap
// longer than the cache lives, and now and then for no visible reason.
function thread({ t, model, effort, longCache, turns, cwd, owner, onTask }) {
  const recs = [], usage = {};
  let ctx = 0, last = null;
  const add = (m, u) => { const day = new Date(t).toISOString().slice(0, 10), p = priceAt(prices, m, day)?.p; const x = (usage[m] ??= { costUSD: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreationEphemeral5mInputTokens: 0, cacheCreationEphemeral1hInputTokens: 0 });
    const w1 = u.cache_creation.ephemeral_1h_input_tokens;
    x.inputTokens += u.input_tokens; x.outputTokens += u.output_tokens; x.cacheReadInputTokens += u.cache_read_input_tokens; x.cacheCreationInputTokens += u.cache_creation_input_tokens;
    x.cacheCreationEphemeral1hInputTokens += w1; x.cacheCreationEphemeral5mInputTokens += u.cache_creation_input_tokens - w1;
    if (p) x.costUSD += requestCost(p, { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write: u.cache_creation_input_tokens, cache_write_1h: w1 }); };
  const life = longCache ? 3600e3 : 300e3;
  let api = 0, tool = 0, edits = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn) t += (owner ? pick([[int(20, 240), 88], [int(400, 840), 6], [int(1200, 3000), 1], [int(4200, 10800), 5]]) : int(5, 30)) * 1000;
    if (owner) recs.push(user(new Date(t).toISOString(), owner(turn), { cwd }));
    if (ctx > 150000) { recs.push(user(new Date(t).toISOString(), "Summary of the conversation so far", { cwd, isCompactSummary: true })); ctx = int(18000, 30000); last = null; }
    const steps = int(2, 9);
    for (let s = 0; s < steps; s++) {
      const grow = int(800, 3500), rebuild = last === null || t - last > life || rnd() < 0.004;
      const write = rebuild ? ctx + grow + (ctx ? 0 : int(12000, 20000)) : grow;
      ctx = rebuild ? write : ctx + grow;
      const out = int(150, 2600), u = { input_tokens: int(1, 40), output_tokens: out, cache_read_input_tokens: rebuild ? 0 : ctx - grow, cache_creation_input_tokens: write,
        cache_creation: { ephemeral_5m_input_tokens: longCache ? 0 : write, ephemeral_1h_input_tokens: longCache ? write : 0 }, output_tokens_details: { thinking_tokens: Math.round(out * (0.15 + rnd() * 0.4)) } };
      const name = s < steps - 1 ? (onTask && rnd() < 0.03 ? "Task" : pick(TOOLS)) : null, id = name && toolId();
      recs.push(assistant(new Date(t).toISOString(), msgId(), u, { model, content: name ? [{ type: "tool_use", id, name, input: {} }] : [{ type: "text", text: "Done." }], rec: { cwd, effort: effort(turn), isSidechain: !owner } }));
      add(model, u); api += out / 80; last = t;
      if (name) {
        const took = name === "Task" ? onTask(t, id) : int(1, 25);
        if (name === "Edit" || name === "Write") edits++;
        t += took * 1000; tool += took;
        recs.push(user(new Date(t).toISOString(), [{ type: "tool_result", tool_use_id: id, is_error: rnd() < 0.03 }], { cwd, toolUseResult: {}, isSidechain: !owner }));
      }
      t += int(4, 40) * 1000;
    }
  }
  return { recs, t, usage, api, tool, edits };
}

for (let d = DAYS - 1; d >= 0; d--) {
  const date = new Date(); date.setDate(date.getDate() - d);
  const weekend = date.getDay() === 0 || date.getDay() === 6, ramp = 0.35 + 0.65 * (1 - d / DAYS);
  const sessions = Math.round((weekend ? int(0, 2) : int(2, 6)) * ramp + (rnd() < ramp ? 1 : 0));
  for (let n = 0; n < sessions; n++) {
    const project = pick(PROJECTS), cwd = `/work/${project}`, session = sid(++k), slug = `-work-${project}`;
    const start = new Date(date); start.setHours(pick([[9, 2], [10, 4], [11, 4], [13, 2], [14, 4], [15, 4], [16, 3], [17, 2], [20, 1], [21, 2], [22, 1]]), int(0, 59), int(0, 59), 0);
    const main = MODELS[pick([["opus", 76], ["sonnet", 20], ["haiku", 4]])], levels = [pick([["high", 60], ["xhigh", 25], ["medium", 15]]), pick([["xhigh", 50], ["high", 30], ["low", 20]])];
    const switchAt = rnd() < 0.2 ? int(2, 8) : Infinity;
    let subTool = 0;
    const onTask = (t, toolUseId) => {
      const agent = `demo${++ids}`, type = pick(SUBS);
      const r = thread({ t, model: MODELS[type === "Explore" ? pick([["haiku", 50], ["sonnet", 50]]) : pick([["sonnet", 70], ["opus", 30]])], effort: () => "medium", longCache: false, turns: int(1, 3), cwd });
      writeTranscript(transcripts, slug, session, r.recs, { agent });
      writeFileSync(join(transcripts, slug, session, "subagents", `agent-${agent}.meta.json`), JSON.stringify({ agentType: type, toolUseId }));
      for (const [m, u] of Object.entries(r.usage)) Object.assign(usageAll[m] ??= { costUSD: 0 }, Object.fromEntries(Object.entries(u).map(([key, v]) => [key, (usageAll[m]?.[key] ?? 0) + v])));
      subTool += r.api;
      return Math.round((r.t - t) / 1000);
    };
    const usageAll = {};
    const r = thread({ t: start.getTime(), model: main, effort: (turn) => (turn >= switchAt ? levels[1] : levels[0]), longCache: rnd() < 0.3, turns: int(3, 26), cwd,
      owner: (turn) => (turn ? "Continue with the next step" : "Let's work on this"), onTask });
    for (const [m, u] of Object.entries(r.usage)) Object.assign(usageAll[m] ??= { costUSD: 0 }, Object.fromEntries(Object.entries(u).map(([key, v]) => [key, (usageAll[m]?.[key] ?? 0) + v])));
    const title = `${VERBS[int(0, VERBS.length - 1)]} ${THINGS[int(0, THINGS.length - 1)]}`, total = Object.values(usageAll).reduce((n, u) => n + u.costUSD, 0);
    const end = { ...cost(total, { startTime: start.getTime(), modelUsage: usageAll }), totalAPIDuration: Math.round((r.api + subTool) * 1000), totalToolDuration: Math.round(r.tool * 1000),
      totalLinesAdded: r.edits * int(15, 70), totalLinesRemoved: r.edits * int(2, 14), sessionId: session };
    writeTranscript(transcripts, slug, session, [...r.recs, { type: "ai-title", aiTitle: title, sessionId: session }, end]);
  }
}

const env = { ...process.env, INSIGHTS_CONFIG: configPath };
spawnSync(process.execPath, [join(ROOT, "bin", "insights.mjs"), "scan"], { env, stdio: "inherit" });
spawn(process.execPath, [join(ROOT, "bin", "insights.mjs"), "serve"], { env, stdio: "inherit" });
