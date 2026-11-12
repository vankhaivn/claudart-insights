// Per-session values computed after every scan from the ingested rows. Cheap: one pass over sessions.
import { existsSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { markRebuilds } from "./rebuilds.mjs";
import { zoner } from "./zone.mjs";
import { missOf, priceAt, readPrices, requestCost, usageCost } from "./prices.mjs";

// The nearest directory at or above cwd that holds .git; without one, cwd's own name. onDisk tells whether cwd
// still exists, so a session whose folder is gone keeps the project it had.
export function projectOf(cwd) {
  if (!cwd) return null;
  const onDisk = existsSync(cwd);
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return { name: basename(dir), onDisk };
    if (dirname(dir) === dir) break;
  }
  return { name: basename(cwd) || "(no project)", onDisk };
}

const firstLine = (text) => text.split("\n").find((l) => l.trim())?.trim().slice(0, 80) ?? null;

export function derive(db, config) {
  const files = db.prepare("SELECT id, provider, session_id, path, cwd, own_first first_ts, own_last last_ts FROM files WHERE kind = 'main'").all();
  const existing = new Map(db.prepare("SELECT id, project FROM sessions").all().map((s) => [s.id, s.project]));
  const titles = db.prepare("SELECT kind, title FROM titles WHERE file_id = ? ORDER BY line DESC");
  const firstOwner = db.prepare("SELECT text FROM owner_messages WHERE session_id = ? AND kind = 'typed' ORDER BY ts, line LIMIT 1");
  const lastCost = db.prepare("SELECT * FROM cost_states WHERE file_id = ? ORDER BY line DESC LIMIT 1");
  // The session this file continues or forks: of the sessions owning the requests it repeats, the latest to start.
  // CROSS JOIN keeps the order from the file's few repeats; left to the planner it scanned every file and request per file.
  const predecessor = db.prepare(`SELECT f.session_id id FROM repeats p CROSS JOIN requests q ON q.message_id = p.message_id
    CROSS JOIN files f ON f.kind = 'main' AND f.session_id = q.session_id
    WHERE p.file_id = ? AND q.session_id <> ? GROUP BY f.id ORDER BY f.own_first DESC LIMIT 1`);
  const requestsOf = db.prepare("SELECT model, day, input, output, cache_read, cache_write, cache_write_1h FROM requests WHERE session_id = ?");
  const prices = readPrices(config).rows;
  const zone = zoner(config.timeZone);
  const upsert = db.prepare(`INSERT INTO sessions(id, provider, slug, cwd, project, title, first_ts, last_ts, cost, cost_incomplete, cost_estimated, price_check,
      api_ms, tool_ms, lines_added, lines_removed, carried_from, model_cost, model_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, slug = excluded.slug, cwd = excluded.cwd, project = excluded.project, title = excluded.title,
      first_ts = excluded.first_ts, last_ts = excluded.last_ts, cost = excluded.cost, cost_incomplete = excluded.cost_incomplete,
      cost_estimated = excluded.cost_estimated, price_check = excluded.price_check,
      api_ms = excluded.api_ms, tool_ms = excluded.tool_ms, lines_added = excluded.lines_added, lines_removed = excluded.lines_removed,
      carried_from = excluded.carried_from, model_cost = excluded.model_cost, model_tokens = excluded.model_tokens`);

  const raw = new Map();
  for (const f of files) {
    const c = lastCost.get(f.id);
    raw.set(f.session_id, c ? { ...c, models: JSON.parse(c.model_usage) } : null);
  }

  db.exec("BEGIN");
  try {
    for (const f of files) {
      const p = projectOf(f.cwd);
      const project = p && !p.onDisk && existing.get(f.session_id) ? existing.get(f.session_id) : (p?.name ?? null);
      const t = titles.all(f.id);
      const title = t.find((x) => x.kind === "custom")?.title ?? t.find((x) => x.kind === "ai")?.title ?? (firstOwner.get(f.session_id)?.text ? firstLine(firstOwner.get(f.session_id).text) : null);

      const c = raw.get(f.session_id);
      let cost = null;
      let models = null;
      let tokens = null;
      let estimated = null;
      let check = null;
      let api = c?.api_ms ?? null;
      let tool = c?.tool_ms ?? null;
      let added = c?.lines_added ?? null;
      let removed = c?.lines_removed ?? null;
      let carriedFrom = null;
      let prev = null;
      if (c) {
        models = { ...c.models };
        // A host record that started with the earlier session's record is cumulative and holds all of it;
        // a fork or a resume in a new process starts its own record shortly before its first own line.
        const earlier = predecessor.get(f.id, f.session_id);
        prev = earlier ? raw.get(earlier.id) : null;
        if (prev && c.start_ms !== null && prev.start_ms !== null && c.start_ms <= prev.start_ms + 1000) {
          carriedFrom = earlier.id;
          const less = (v, w) => (v === null ? null : Math.max(0, v - (w ?? 0)));
          for (const [m, u] of Object.entries(models)) {
            const was = prev.models[m] ?? {};
            models[m] = { ...u, ...Object.fromEntries(["cost", "input", "output", "read", "write", "w5", "w1", "web"].map((k) => [k, less(u[k], was[k])])) };
          }
          api = less(api, prev.api_ms);
          tool = less(tool, prev.tool_ms);
          added = less(added, prev.lines_added);
          removed = less(removed, prev.lines_removed);
        }
        // Each model's figure against the price table, for a record the host marked complete.
        const day = f.first_ts ? zone(f.first_ts).day : null;
        if (!c.incomplete && day) {
          check = {};
          for (const [m, u] of Object.entries(models)) {
            if (!u.cost) continue;
            const row = priceAt(prices, m, day);
            if (u.web) check[m] = { day, skipped: "web search" };
            else if (!row) check[m] = { day, skipped: "no price" };
            else check[m] = { day, host: u.cost, ...usageCost(row.p, u), miss: missOf(u.cost, usageCost(row.p, u)) };
          }
        }
        const known = Object.values(models).map((u) => u.cost).filter((v) => v !== null);
        if (known.length) cost = known.reduce((a, b) => a + b, 0);
        // The tokens the host priced per model, to split a cost the transcript holds no request for.
        tokens = Object.fromEntries(Object.entries(models).map(([m, u]) => [m, { input: u.input, output: u.output, read: u.read, write: u.write, w5: u.w5, w1: u.w1, split: u.split, web: u.web }]));
        models = Object.fromEntries(Object.entries(models).map(([m, u]) => [m, u.cost]));
        if (!known.length && c.cost !== null) {
          cost = carriedFrom ? Math.max(0, c.cost - (prev.cost ?? 0)) : c.cost;
          models = { unknown: cost };
        }
      } else {
        // No host record: the requests priced on their day, marked as estimated; unknown if a model has no price.
        const reqs = requestsOf.all(f.session_id);
        const rows = reqs.map((r) => [r, priceAt(prices, r.model, r.day)]);
        if (reqs.length && rows.every(([, row]) => row)) {
          models = {};
          for (const [r, row] of rows) models[r.model] = (models[r.model] ?? 0) + requestCost(row.p, r);
          cost = Object.values(models).reduce((a, b) => a + b, 0);
          estimated = 1;
        }
      }
      upsert.run(f.session_id, f.provider, f.path.split(sep)[0], f.cwd, project, title, f.first_ts, f.last_ts, cost,
        c ? (c.incomplete ? 1 : 0) : null, estimated, check ? JSON.stringify(check) : null, api, tool, added, removed, carriedFrom, models ? JSON.stringify(models) : null, tokens ? JSON.stringify(tokens) : null);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  markRebuilds(db, prices);
}
