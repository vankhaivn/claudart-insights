// Synthetic transcript records in the host's shapes. Every id is made up.
import { appendFileSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
export const sid = (k) => `${String(k).padStart(8, "0")}-1111-4000-8000-000000000000`;

export const user = (ts, content, extra = {}) => ({ type: "user", uuid: uid(), timestamp: ts, cwd: extra.cwd ?? "/work/demo", message: { role: "user", content }, ...extra });
export const assistant = (ts, id, usage, extra = {}) => ({
  type: "assistant", uuid: uid(), timestamp: ts, cwd: "/work/demo", effort: "high",
  message: { id, model: extra.model ?? "claude-opus-5-5", content: extra.content ?? [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens_details: { thinking_tokens: 4 }, ...usage } },
  ...extra.rec,
});
export const cost = (total, extra = {}) => ({ type: "cost-state", totalCostUSD: total, totalAPIDuration: 60000, totalToolDuration: 1000, totalLinesAdded: 5, totalLinesRemoved: 2, startTime: extra.startTime ?? 0, modelUsage: extra.modelUsage ?? { "claude-opus-5-5": { costUSD: total } }, hasUnknownModelCost: extra.incomplete ?? false });

export const jsonl = (records) => records.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n") + "\n";

export function writeTranscript(projects, slug, session, records, { agent, append = false, raw } = {}) {
  const path = agent ? join(projects, slug, session, "subagents", `agent-${agent}.jsonl`) : join(projects, slug, `${session}.jsonl`);
  mkdirSync(dirname(path), { recursive: true });
  // Records carry the session that first wrote them; a record reused in a later file keeps that id, as the host does.
  for (const r of records ?? []) if (typeof r === "object" && !r.sessionId) r.sessionId = session;
  (append ? appendFileSync : writeFileSync)(path, raw ?? jsonl(records));
  return path;
}

// Set a file's modification time, in seconds since the epoch.
export const touch = (path, seconds) => utimesSync(path, seconds, seconds);
