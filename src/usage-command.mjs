import { readDb } from "./db.mjs";
import { int, minutes, pct, table, usd } from "./format.mjs";
import { effortOrder, groupBy, loadRows, slice, subagentRows, toolRows, totals, window } from "./usage.mjs";

const TOKENS = [
  ["requests", (r) => int(r.q), "r"],
  ["input", (r) => int(r.i), "r"],
  ["output", (r) => int(r.o), "r"],
  ["thinking", (r) => int(r.th), "r"],
  ["cache read", (r) => int(r.cr), "r"],
  ["cache write", (r) => int(r.cw), "r"],
  ["from cache", (r) => pct(r.hit), "r"],
  ["cost", (r) => `${usd(r.c)}${r.costGaps.length ? "*" : ""}`, "r"],
];

// Resolve --project and --model to the indexes the rows use; an unknown name is an error, not an empty result.
function filters(rows, options) {
  const project = options.project === undefined ? -1 : rows.projects.indexOf(options.project);
  if (project < 0 && options.project !== undefined) throw new Error(`no project named ${options.project}; known: ${rows.projects.join(", ")}`);
  const wanted = options.model?.toLowerCase();
  const model = wanted === undefined ? -1 : rows.models.findIndex((m) => m.toLowerCase() === wanted);
  if (model < 0 && wanted !== undefined) throw new Error(`no model family named ${options.model}; known: ${rows.models.join(", ")}`);
  const effort = options.effort === undefined ? null : options.effort.toLowerCase();
  if (effort !== null && !rows.facts.some((f) => f.e === effort)) throw new Error(`no request at effort ${options.effort}; seen: ${[...new Set(rows.facts.map((f) => f.e).filter(Boolean))].sort(effortOrder).join(", ")}`);
  return { project, model, effort };
}

const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const WHEN = { idle: "after idle", compaction: "at compaction", other: "other", start: "at session start" };

// "cache rebuilt: 59 after idle (12.6M tokens, ~$86 extra), ..."; the cost of a start is not avoidable, so it shows none.
export function rebuildLine({ rebuild }) {
  const parts = ["idle", "compaction", "other", "start"].filter((c) => rebuild[c].n).map((c) => {
    const { n, tokens: t, extra } = rebuild[c];
    return `${int(n)} ${WHEN[c]} (${tokens(t)} tokens${c === "start" ? "" : `, ~$${extra.toFixed(extra < 10 ? 2 : 0)} extra`})`;
  });
  return parts.length ? `cache rebuilt: ${parts.join(", ")}` : null;
}

export async function usageCommand({ config, options, out }) {
  const db = readDb(config.database);
  const rows = loadRows(db, config);
  db.close();
  const range = window(rows, options);
  const filter = { ...range, ...filters(rows, options) };
  const F = slice(rows, filter);
  const total = totals(rows, F);
  const by = options.by ? [options.by] : ["day", "model"];

  const sections = by.map((b) => {
    if (b === "tool") return { by: b, rows: toolRows(rows, F) };
    if (b === "subagent") return { by: b, rows: subagentRows(rows, F) };
    const grouped = groupBy(rows, F, b);
    if (b === "session") {
      for (const g of grouped) {
        const s = rows.sessions[g.key];
        Object.assign(g, { key: s.id, title: s.title, project: rows.projects[s.p], start: `${s.day} ${String(s.hour).padStart(2, "0")}:${String(s.min).padStart(2, "0")}`,
          duration: s.dur, owner: s.owner, compactions: s.compact, added: s.la, removed: s.lr, costState: s.costState });
      }
      grouped.sort((a, b2) => (a.start < b2.start ? -1 : 1));
    } else if (b === "effort") grouped.sort((a, b2) => effortOrder(a.key === "unknown" ? "" : a.key, b2.key === "unknown" ? "" : b2.key));
    else grouped.sort((a, b2) => (b === "day" || b === "hour" ? (a.key < b2.key ? -1 : 1) : b2.o - a.o));
    return { by: b, rows: grouped };
  });

  if (options.json) {
    const clean = (r) => ({ ...r, costGaps: r.costGaps?.map((s) => ({ id: s.id, costState: s.costState })) });
    out.write(`${JSON.stringify({ from: range.from, to: range.to, project: options.project ?? null, model: options.model ?? null, effort: filter.effort, unpriced: total.unpriced, total: clean(total), groups: sections.map((s) => ({ by: s.by, rows: s.rows.map(clean) })) }, null, 1)}\n`);
    return 0;
  }

  const lines = [`Usage ${range.from} to ${range.to}${options.project ? `, project ${options.project}` : ""}${options.model ? `, model ${options.model}` : ""}${filter.effort ? `, effort ${filter.effort}` : ""}: ${int(total.sessions)} sessions`, ""];
  for (const s of sections) {
    let columns;
    if (s.by === "tool") columns = [["tool", (r) => r.key], ["calls", (r) => int(r.calls), "r"], ["errors", (r) => int(r.errors), "r"]];
    else if (s.by === "subagent") columns = [["subagent type", (r) => r.key], ["count", (r) => int(r.count), "r"], ["output", (r) => int(r.o), "r"], ["models", (r) => Object.entries(r.models).map(([m, n]) => `${m} ${n}`).join(", ")]];
    else if (s.by === "session")
      columns = [["session", (r) => r.key.slice(0, 8)], ["start", (r) => r.start], ["project", (r) => r.project], ["title", (r) => (r.title.length > 40 ? `${r.title.slice(0, 39)}…` : r.title)],
        ["duration", (r) => minutes(r.duration), "r"], ["owner", (r) => int(r.owner), "r"], ["compact", (r) => int(r.compactions), "r"], ["+lines", (r) => int(r.added), "r"],
        ["-lines", (r) => int(r.removed), "r"], ["output", (r) => int(r.o), "r"], ["tok/s", (r) => (r.tps === null ? "—" : r.tps.toFixed(0)), "r"], ["cost", (r) => (r.costState === "unknown" ? "unknown" : `${usd(r.c)}${r.costState === "ok" ? "" : "*"}`), "r"]];
    else {
      const label = { day: "day", hour: "hour", model: "model", effort: "effort", project: "project" }[s.by];
      const rowsWithTotal = [...s.rows, { key: "total", ...total }];
      lines.push(table(rowsWithTotal, [[label, (r) => (s.by === "hour" && r.key !== "total" ? `${String(r.key).padStart(2, "0")}:00` : r.key)], ...TOKENS]), "");
      continue;
    }
    lines.push(table(s.rows, columns), "");
  }
  if (!by.some((b) => b === "tool" || b === "subagent")) {
    lines.push(`output tokens per second of API time: ${total.tps === null ? "—" : total.tps.toFixed(1)}`);
    const rebuilt = rebuildLine(total);
    if (rebuilt) lines.push(rebuilt);
  }
  if (total.costGaps.length) {
    lines.push(`* cost unknown, incomplete or estimated for ${total.costGaps.length} sessions; their known or estimated part is counted:`);
    const why = { unknown: "no cost record and no price for a model", incomplete: "host marked cost incomplete", estimated: "no cost record; estimated from prices.md" };
    for (const g of total.costGaps) lines.push(`  ${g.id.slice(0, 8)} ${why[g.costState]}  ${g.title}`);
  }
  if (total.unpriced.length) lines.push(`no price row for ${total.unpriced.join(", ")} in prices.md: their cost is spread by output tokens`);
  out.write(`${lines.join("\n").trimEnd()}\n`);
  return 0;
}
