import { join } from "node:path";
import { archivePath, readLine } from "./archive.mjs";
import { readDb } from "./db.mjs";

// <session>[/<agent-id>]:<line>, where <session> is an id or an unambiguous prefix.
export async function show(config, ref) {
  const m = ref?.match(/^([0-9a-f-]+)(?:\/([\w-]+))?:(\d+)$/);
  if (!m) throw new Error(`expected <session>:<line> or <session>/<agent-id>:<line>, got ${ref ?? "nothing"}`);
  const [, prefix, agent, line] = m;
  const db = readDb(config.database);
  const rows = agent
    ? db.prepare("SELECT provider, path FROM files WHERE kind = 'sub' AND session_id LIKE ? AND agent_id = ?").all(`${prefix}%`, agent)
    : db.prepare("SELECT provider, path FROM files WHERE kind = 'main' AND session_id LIKE ?").all(`${prefix}%`);
  db.close();
  if (rows.length === 0) throw new Error(`no archived transcript matches ${prefix}${agent ? `/${agent}` : ""}`);
  if (rows.length > 1) throw new Error(`${prefix} matches ${rows.length} sessions; give more of the id`);
  const text = await readLine(archivePath(join(config.archive, rows[0].provider), rows[0].path), Number(line));
  if (text === null) throw new Error(`${ref}: the archive has no line ${line}`);
  return text;
}
