// Everything that knows the Claude Code transcript format: where transcripts sit in the projects folder,
// the shapes of their records, and the subagent meta files. Tool output is never stored.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { zoner } from "../zone.mjs";

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const list = (p) => (isDir(p) ? readdirSync(p, { withFileTypes: true }) : []);

// Describe a transcript by its path relative to the projects folder:
// <slug>/<session>.jsonl (main) or <slug>/<session>/subagents/agent-<id>.jsonl (sub).
export function describe(rel) {
  const parts = rel.split(sep);
  if (parts.length === 2 && parts[1].endsWith(".jsonl")) return { rel, kind: "main", slug: parts[0], sessionId: parts[1].slice(0, -6), agentId: null };
  if (parts.length === 4 && parts[2] === "subagents" && /^agent-.+\.jsonl$/.test(parts[3]))
    return { rel, kind: "sub", slug: parts[0], sessionId: parts[1], agentId: parts[3].slice(6, -6) };
  return null;
}

// Transcripts and other session-folder files under a projects folder.
export function listHost(root) {
  const transcripts = [];
  const others = [];
  for (const slug of list(root)) {
    if (!slug.isDirectory()) continue;
    const slugDir = join(root, slug.name);
    for (const entry of list(slugDir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) transcripts.push(describe(join(slug.name, entry.name)));
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
      const walk = (dir) => {
        for (const e of list(dir)) {
          const abs = join(dir, e.name);
          if (e.isDirectory()) walk(abs);
          else if (e.isFile()) {
            const d = describe(relative(root, abs));
            if (d) transcripts.push(d);
            else others.push(relative(root, abs));
          }
        }
      };
      walk(join(slugDir, entry.name));
    }
  }
  return { transcripts, others };
}

const FAMILIES = ["opus", "sonnet", "haiku", "fable"];
export const familyOf = (model) => FAMILIES.find((f) => model.includes(f)) ?? model;

// Text blocks that are not the owner's words even when they sit in a user record.
const NOT_OWNER = ["<system-reminder>", "<task-notification>", "<local-command", "<bash-", "Caveat:", "This session is being continued", "[Request interrupted"];

// The owner's typed text in a user record, or null. A slash command keeps its name and arguments.
export function ownerText(rec) {
  if (rec.type !== "user" || rec.isMeta || rec.isSidechain || rec.isCompactSummary || rec.toolUseResult) return null;
  // Turns started by another session, an SDK call or a task notification are not typed by the owner.
  if (rec.turnOrigin && rec.turnOrigin !== "human") return null;
  if (rec.origin?.kind && rec.origin.kind !== "human") return null;
  const content = rec.message?.content;
  const blocks = typeof content === "string" ? [content] : Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text ?? "") : [];
  if (Array.isArray(content) && content.some((b) => b.type === "tool_result")) return null;
  const kept = [];
  for (const raw of blocks) {
    const text = raw.trim();
    if (!text) continue;
    const command = text.match(/<command-name>([^<]*)<\/command-name>/);
    if (command) {
      const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1].trim();
      kept.push(args ? `${command[1]} ${args}` : command[1]);
      continue;
    }
    if (text.startsWith("<command-message>") || NOT_OWNER.some((p) => text.startsWith(p))) continue;
    kept.push(text);
  }
  return kept.length ? kept.join("\n\n") : null;
}

// hasFile(sessionId): whether a main transcript of that session is known; its records are left to it.
export function createIngester(db, timeZone, hasFile = () => false) {
  const zone = zoner(timeZone);
  const q = {
    record: db.prepare("INSERT OR IGNORE INTO records(uuid, file_id, line, type, ts) VALUES (?, ?, ?, ?, ?)"),
    repeat: db.prepare("INSERT OR IGNORE INTO repeats(file_id, message_id) VALUES (?, ?)"),
    request: db.prepare(`INSERT OR IGNORE INTO requests(message_id, file_id, line, session_id, agent_id, ts, day, hour, model, family,
      effort, is_sub, input, output, thinking, cache_read, cache_write, cache_write_1h) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    owner: db.prepare("INSERT OR IGNORE INTO owner_messages(uuid, file_id, line, session_id, ts, kind, text) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    call: db.prepare("INSERT OR IGNORE INTO tool_calls(id, file_id, line, session_id, agent_id, ts, name, model, is_error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)"),
    result: db.prepare("UPDATE tool_calls SET is_error = ? WHERE id = ?"),
    compaction: db.prepare("INSERT OR IGNORE INTO compactions(uuid, file_id, session_id, ts) VALUES (?, ?, ?, ?)"),
    cost: db.prepare(`INSERT OR REPLACE INTO cost_states(file_id, line, session_id, start_ms, cost, incomplete, api_ms, tool_ms,
      lines_added, lines_removed, model_usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    title: db.prepare("INSERT OR REPLACE INTO titles(file_id, line, session_id, kind, title) VALUES (?, ?, ?, ?, ?)"),
  };

  // file: { id, kind, session_id, agent_id }. Returns how many records were added, and the line's cwd and timestamp.
  return function ingestLine(file, line, text) {
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      return { added: 0 };
    }
    if (!rec || typeof rec !== "object" || rec.type === "session-owner") return { added: 0 };
    const session = file.session_id;
    const agent = file.agent_id;
    // A line copied into a continuation or fork keeps the id of the session that wrote it.
    const foreign = Boolean(rec.sessionId) && rec.sessionId !== session;
    const seen = { cwd: rec.cwd, ts: rec.timestamp, own: rec.sessionId === session };

    if (rec.type === "cost-state") {
      // Per model: the host's cost and the tokens it priced; `split` tells whether 5m and 1h cache writes are told apart.
      const models = Object.fromEntries(Object.entries(rec.modelUsage ?? {}).map(([m, u]) => [m, {
        cost: u?.costUSD ?? null, input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, read: u?.cacheReadInputTokens ?? 0,
        write: u?.cacheCreationInputTokens ?? 0, w5: u?.cacheCreationEphemeral5mInputTokens ?? 0, w1: u?.cacheCreationEphemeral1hInputTokens ?? 0,
        split: u?.cacheCreationEphemeral5mInputTokens !== undefined || u?.cacheCreationEphemeral1hInputTokens !== undefined, web: u?.webSearchRequests ?? 0,
      }]));
      q.cost.run(file.id, line, session, rec.startTime ?? null, rec.totalCostUSD ?? null, rec.hasUnknownModelCost ? 1 : 0,
        rec.totalAPIDuration ?? null, rec.totalToolDuration ?? null, rec.totalLinesAdded ?? null, rec.totalLinesRemoved ?? null, JSON.stringify(models));
      return { added: 1, ...seen };
    }
    if (rec.type === "custom-title" && rec.customTitle) {
      q.title.run(file.id, line, session, "custom", rec.customTitle);
      return { added: 1, ...seen };
    }
    if (rec.type === "ai-title" && rec.aiTitle) {
      q.title.run(file.id, line, session, "ai", rec.aiTitle);
      return { added: 1, ...seen };
    }
    if (!rec.uuid) return { added: 0, ...seen };

    // A copied record belongs to the file of the session that wrote it, whichever file is read first;
    // here only note which requests it repeats. A copy whose original file is gone is kept here.
    if ((foreign && hasFile(rec.sessionId)) || q.record.run(rec.uuid, file.id, line, rec.type, rec.timestamp ?? null).changes === 0) {
      if (rec.type === "assistant" && rec.message?.id) q.repeat.run(file.id, rec.message.id);
      return { added: 0, ...seen, own: false };
    }

    if (rec.type === "assistant") {
      const msg = rec.message ?? {};
      const u = msg.usage;
      if (msg.id && u && msg.model !== "<synthetic>" && rec.timestamp) {
        const { day, hour } = zone(rec.timestamp);
        q.request.run(msg.id, file.id, line, session, agent, rec.timestamp, day, hour, msg.model ?? "unknown", familyOf(msg.model ?? "unknown"),
          rec.effort ?? null, file.kind === "sub" ? 1 : 0, u.input_tokens ?? 0, u.output_tokens ?? 0,
          u.output_tokens_details?.thinking_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0,
          u.cache_creation?.ephemeral_1h_input_tokens ?? null);
      }
      for (const b of Array.isArray(msg.content) ? msg.content : []) {
        if (b?.type === "tool_use" && b.id) q.call.run(b.id, file.id, line, session, agent, rec.timestamp ?? null, b.name ?? "unknown", msg.model ?? null);
      }
    } else if (rec.type === "user") {
      const content = rec.message?.content;
      for (const b of Array.isArray(content) ? content : []) {
        if (b?.type === "tool_result" && b.tool_use_id) q.result.run(b.is_error ? 1 : 0, b.tool_use_id);
      }
      if (rec.isCompactSummary) q.compaction.run(rec.uuid, file.id, session, rec.timestamp ?? null);
      if (file.kind === "main") {
        const typed = ownerText(rec);
        if (typed) q.owner.run(rec.uuid, file.id, line, session, rec.timestamp ?? null, "typed", typed);
        const answers = rec.toolUseResult?.answers;
        if (answers && typeof answers === "object" && !rec.isSidechain) {
          Object.values(answers).forEach((a, i) => {
            if (typeof a === "string" && a.trim()) q.owner.run(`${rec.uuid}#${i}`, file.id, line, session, rec.timestamp ?? null, "popup", a.trim());
          });
        }
      }
    }
    return { added: 1, ...seen };
  };
}

// The type and parent tool call of a subagent, from the meta file archived beside its transcript.
export function subagentMeta(archiveDir, d) {
  try {
    const m = JSON.parse(readFileSync(join(archiveDir, d.rel.replace(/\.jsonl$/, ".meta.json")), "utf8"));
    return { type: m.agentType ?? null, toolUseId: m.toolUseId ?? null };
  } catch {
    // No readable meta file: the subagent has no recorded type.
    return { type: null, toolUseId: null };
  }
}

export const claude = { name: "claude", describe, listHost, createIngester, subagentMeta };
