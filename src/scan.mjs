import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { appendChunk, archiveLines, archivePath, hashHead, HEAD_BYTES, listArchived, liveHead, newChunks, rotate, sizeOf, copyOther } from "./archive.mjs";
import { FILE_TABLES, openDb, transaction } from "./db.mjs";
import { derive } from "./derive.mjs";
import { priceReport, readPrices } from "./prices.mjs";
import { PROVIDERS } from "./providers/index.mjs";

// First timestamp in the opening bytes of a transcript; orders new files so the earlier file owns copied records.
function peekFirstTs(path) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").match(/"timestamp":"([^"]+)"/)?.[1] ?? null;
  } finally {
    closeSync(fd);
  }
}

function lineCount(chunk) {
  let n = 0;
  for (let i = chunk.indexOf(10); i >= 0; i = chunk.indexOf(10, i + 1)) n++;
  return n;
}

// Lets the server answer other requests, such as the progress, between steps of a long scan.
const yieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

// onProgress({ reason, step, done, total, bytes, totalBytes }) follows the scan: step "find" opens each transcript to order
// them, "read" ingests them (bytes ingested of totalBytes), "finish" builds the figures. reason is "first" for a new
// database, "rebuild" when a schema change emptied it, "update" otherwise.
export async function scan(config, { onProgress = () => {} } = {}) {
  const providers = Object.entries(config.providers).map(([name, p]) => ({ ...PROVIDERS[name], root: p.transcripts, archive: join(config.archive, name) }));
  const had = existsSync(config.database);
  const db = openDb(config.database);
  const reason = db.prepare("SELECT COUNT(*) n FROM files").get().n ? "update" : had ? "rebuild" : "first";
  const mains = new Set(db.prepare("SELECT session_id FROM files WHERE kind = 'main'").all().map((r) => r.session_id));
  const ingesters = new Map(providers.map((p) => [p.name, p.createIngester(db, config.timeZone, (id) => mains.has(id))]));
  const totals = { files: 0, bytes: 0, sessions: 0, records: 0, generations: 0, copied: 0 };
  const sessionsBefore = db.prepare("SELECT COUNT(DISTINCT session_id) n FROM files WHERE kind = 'main' AND lines > 0").get().n;

  const getFile = db.prepare("SELECT * FROM files WHERE provider = ? AND path = ?");
  const addFile = db.prepare("INSERT INTO files(provider, path, kind, session_id, agent_id) VALUES (?, ?, ?, ?, ?)");
  const saveCursor = db.prepare("UPDATE files SET offset = ?, lines = ?, head_hash = ?, archive_size = ?, first_ts = coalesce(first_ts, ?), cwd = coalesce(cwd, ?), live = ?, own_first = ?, own_last = ? WHERE id = ?");
  const resetFile = db.prepare("UPDATE files SET generation = generation + 1, offset = 0, lines = 0, head_hash = NULL, archive_size = 0, first_ts = NULL, own_first = NULL, own_last = NULL, cwd = NULL WHERE id = ?");
  const clear = FILE_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE file_id = ?`));

  const fileRow = (d) => getFile.get(d.provider, d.rel) ?? (addFile.run(d.provider, d.rel, d.kind, d.sessionId, d.agentId), getFile.get(d.provider, d.rel));

  // Every transcript a provider's host still has or its archive holds, oldest first.
  const work = new Map();
  for (const p of providers) {
    const base = { provider: p.name, dir: p.archive };
    for (const d of p.listHost(p.root).transcripts) if (!work.has(`${p.name}/${d.rel}`)) work.set(`${p.name}/${d.rel}`, { ...d, ...base, src: join(p.root, d.rel) });
    for (const d of listArchived(p.archive, p.describe)) if (!work.has(`${p.name}/${d.rel}`)) work.set(`${p.name}/${d.rel}`, { ...d, ...base, src: null });
  }
  for (const d of work.values()) if (d.kind === "main") mains.add(d.sessionId);
  // Each job weighs the bytes it still has to ingest: the archive when it is ahead of the cursor, then the host's new bytes.
  const jobs = [];
  for (const d of work.values()) {
    if (jobs.length % 100 === 0) {
      onProgress({ reason, step: "find", done: jobs.length, total: work.size, bytes: 0, totalBytes: 0 });
      await yieldToLoop();
    }
    const row = getFile.get(d.provider, d.rel);
    const src = d.src ?? archivePath(d.dir, d.rel);
    const stat = statSync(src);
    const gzSize = sizeOf(archivePath(d.dir, d.rel)) ?? 0;
    const weight = (gzSize !== (row?.archive_size ?? 0) ? gzSize : 0) + (d.src ? Math.max(0, stat.size - (row?.offset ?? 0)) : 0);
    jobs.push({ d, ts: row?.first_ts ?? (d.src ? peekFirstTs(d.src) : null) ?? "~", mtime: stat.mtimeMs, weight });
  }
  // A continuation starts with the same records as the file it continues, so ties go to the file last written first.
  jobs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.mtime - b.mtime));
  const totalBytes = jobs.reduce((n, j) => n + j.weight, 0);
  let bytes = 0, next = 0;
  const report = (done, extra = 0) => onProgress({ reason, step: "read", done, total: jobs.length, bytes: bytes + extra, totalBytes });

  for (const [done, { d, weight }] of jobs.entries()) {
    bytes = next;
    next += weight;
    report(done);
    await yieldToLoop();
    let file = fileRow(d);
    const gz = archivePath(d.dir, d.rel);
    const ingest = ingesters.get(d.provider);
    let firstTs = null;
    let cwd = null;
    let ownFirst = file.own_first;
    let ownLast = file.own_last;
    const take = (line, text) => {
      const r = ingest(file, line, text);
      totals.records += r.added;
      firstTs ??= r.ts ?? null;
      cwd ??= r.cwd ?? null;
      if (r.own && r.ts) {
        if (!ownFirst || r.ts < ownFirst) ownFirst = r.ts;
        if (!ownLast || r.ts > ownLast) ownLast = r.ts;
      }
    };

    // The archive is ahead of the cursor when a scan died between the append and the commit,
    // or when the database was rebuilt: ingest what the archive holds beyond the cursor, in batches.
    const gzSize = sizeOf(gz) ?? 0;
    if (gzSize !== file.archive_size) {
      if (gzSize < file.archive_size) throw new Error(`archive ${gz} is shorter than recorded; refusing to continue`);
      let { offset, lines } = file;
      const head = [];
      let headBytes = 0;
      let batch = 0;
      db.exec("BEGIN");
      try {
        for await (const l of archiveLines(gz)) {
          if (headBytes < HEAD_BYTES) {
            head.push(Buffer.from(`${l.text}\n`));
            headBytes += l.bytes;
          }
          if (l.line <= lines) continue;
          take(l.line, l.text);
          offset += l.bytes;
          lines = l.line;
          if (++batch % 5000 === 0) {
            saveCursor.run(offset, lines, hashHead(Buffer.concat(head)), file.archive_size, firstTs, cwd, file.live, ownFirst, ownLast, file.id);
            db.exec("COMMIT");
            db.exec("BEGIN");
          }
        }
        saveCursor.run(offset, lines, hashHead(Buffer.concat(head)), gzSize, firstTs, cwd, d.src ? 1 : 0, ownFirst, ownLast, file.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      file = getFile.get(d.provider, d.rel);
    }

    if (!d.src) {
      if (file.live) db.prepare("UPDATE files SET live = 0 WHERE id = ?").run(file.id);
      continue;
    }
    const size = sizeOf(d.src);
    if (size === null) continue;

    // A file that shrank or whose consumed head changed was rewritten: keep the old copy as a generation.
    if (file.offset > 0 && (size < file.offset || liveHead(d.src, file.offset) !== file.head_hash)) {
      if (existsSync(gz)) rotate(gz);
      transaction(db, () => {
        for (const c of clear) c.run(file.id);
        resetFile.run(file.id);
      });
      totals.generations++;
      file = getFile.get(d.provider, d.rel);
      firstTs = cwd = ownFirst = ownLast = null;
    }

    let { offset, lines } = file;
    for (const chunk of newChunks(d.src, offset, size)) {
      const archived = appendChunk(gz, chunk);
      const count = lineCount(chunk);
      const text = chunk.toString("utf8");
      transaction(db, () => {
        let start = 0;
        for (let i = 0; i < count; i++) {
          const end = text.indexOf("\n", start);
          take(lines + i + 1, text.slice(start, end));
          start = end + 1;
        }
        offset += chunk.length;
        lines += count;
        saveCursor.run(offset, lines, liveHead(d.src, offset), archived, firstTs, cwd, 1, ownFirst, ownLast, file.id);
      });
      totals.bytes += chunk.length;
      report(done, Math.max(0, weight - (size - offset)));
      await yieldToLoop();
    }
    if (offset > file.offset) totals.files++;
  }
  onProgress({ reason, step: "finish", done: jobs.length, total: jobs.length, bytes: totalBytes, totalBytes });
  await yieldToLoop();

  // Other session-folder files; the subagent meta files among them give each subagent its type.
  const copied = new Set();
  for (const p of providers) {
    for (const rel of p.listHost(p.root).others) {
      if (copied.has(`${p.name}/${rel}`)) continue;
      copied.add(`${p.name}/${rel}`);
      if (copyOther(join(p.root, rel), join(p.archive, rel))) totals.copied++;
    }
  }
  const putSub = db.prepare("INSERT OR REPLACE INTO subagents(agent_id, session_id, type, tool_use_id) VALUES (?, ?, ?, ?)");
  for (const { d } of jobs) {
    if (d.kind !== "sub") continue;
    const meta = PROVIDERS[d.provider].subagentMeta(d.dir, d);
    putSub.run(d.agentId, d.sessionId, meta.type, meta.toolUseId);
  }

  derive(db, config);
  const sessionsAfter = db.prepare("SELECT COUNT(DISTINCT session_id) n FROM files WHERE kind = 'main' AND lines > 0").get().n;
  totals.sessions = sessionsAfter - sessionsBefore;
  totals.prices = { report: priceReport(db), errors: readPrices(config).errors };
  db.close();
  return totals;
}

// What a scan added and the price check's misses, one line each; errors are reported apart.
export function scanReport(t) {
  const fresh = t.files + t.records + t.copied + t.generations === 0;
  const lines = [fresh ? "nothing new" : `added ${t.files} transcript files, ${t.bytes} bytes, ${t.sessions} sessions, ${t.records} records; copied ${t.copied} other files${t.generations ? `; ${t.generations} rewritten files kept as generations` : ""}`];
  for (const m of t.prices.report.filter((x) => x.misses.length)) lines.push(`price check: ${m.model} misses the price table by more than 1% in ${m.misses.length} of ${m.checked} sessions, first on ${m.since}; see \`prices\``);
  return { lines, errors: t.prices.errors };
}
