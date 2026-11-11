import { readDb } from "./db.mjs";
import { int, table } from "./format.mjs";
import { pricesView } from "./prices.mjs";

// The `prices` command: the table, the check per model and the fitted prices.
export function pricesCommand({ config, options, out }) {
  const db = readDb(config.database);
  const v = pricesView(db, config);
  db.close();
  if (options.json) out.write(`${JSON.stringify(v, null, 1)}\n`);
  else {
    const n = (x) => (x === null ? "—" : Number(x.toPrecision(4)).toString());
    const kinds = ["input", "output", "read", "write 5m", "write 1h"];
    const lines = ["price rows (USD per million tokens)", table(v.rows, [["model", (r) => r.model], ["from", (r) => r.from], ...kinds.map((h, i) => [h, (r) => n(r.p[i]), "r"])]), ""];
    lines.push("check against the host's cost records");
    lines.push(table(v.report, [["model", (m) => m.model], ["checked", (m) => int(m.checked), "r"], ["over 1%", (m) => int(m.misses.length), "r"], ["first miss", (m) => m.since ?? "—"], ["not checked", (m) => Object.entries(m.skipped).map(([k, c]) => `${c} ${k}`).join(", ") || "—"]]));
    for (const m of v.report) for (const x of m.misses) lines.push(`  ${m.model} ${x.id.slice(0, 8)} ${x.day} host $${x.host.toFixed(2)} priced $${x.lo.toFixed(2)}${x.hi > x.lo + 0.005 ? `-${x.hi.toFixed(2)}` : ""} (${(x.miss * 100).toFixed(1)}%)  ${x.title ?? ""}`);
    if (v.unpriced.length) lines.push("", `no price row: ${v.unpriced.map((r) => `${r.model} (${int(r.n)} requests, ${r.first} to ${r.last})`).join(", ")}; their cost is spread by output tokens`);
    lines.push("", "prices that fit the host's records");
    lines.push(table(v.fits, [["model", (f) => f.model], ["sessions", (f) => int(f.sessions), "r"], ...kinds.map((h, i) => [h, (f) => (f.fit ? n(f.fit.p[i]) : ""), "r"]), ["worst miss", (f) => (f.fit ? `${(f.fit.worst * 100).toFixed(2)}%` : "too few sessions")]]));
    out.write(`${lines.join("\n")}\n`);
  }
  for (const e of v.errors) process.stderr.write(`${e}\n`);
  return v.errors.length ? 1 : 0;
}
