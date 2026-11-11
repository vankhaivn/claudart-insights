import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { appendChunk, archiveLines, archivePath, hashHead, HEAD_BYTES, listArchived, listHost, liveHead, newChunks, rotate, sizeOf, copyOther } from "./archive.mjs";
import { FILE_TABLES, openDb, transaction } from "./db.mjs";
import { derive } from "./derive.mjs";
import { priceReport, readPrices } from "./prices.mjs";
import { createIngester } from "./ingest.mjs";

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

export async function scan(config, { sources = [config.transcripts] } = {}) {
  const db = openDb(config.database);
  const mains = new Set(db.prepare("SELECT session_id FROM files WHERE kind = 'main'").all().map((r) => r.session_id));
  const ingest = createIngester(db, config.timeZone, (id) => mains.has(id));
  const totals = { files: 0, bytes: 0, sessions: 0, records: 0, generations: 0, copied: 0 };
  const sessionsBefore = db.prepare("SELECT COUNT(DISTINCT session_id) n FROM files WHERE kind = 'main' AND lines > 0").get().n;

  const getFile = db.prepare("SELECT * FROM files WHERE path = ?");
  const addFile = db.prepare("INSERT INTO files(path, kind, session_id, agent_id) VALUES (?, ?, ?, ?)");
  const saveCursor = db.prepare("UPDATE files SET offset = ?, lines = ?, head_hash = ?, archive_size = ?, first_ts = coalesce(first_ts, ?), cwd = coalesce(cwd, ?), live = ?, own_first = ?, own_last = ? WHERE id = ?");
  const resetFile = db.prepare("UPDATE files SET generation = generation + 1, offset = 0, lines = 0, head_hash = NULL, archive_size = 0, first_ts = NULL, own_first = NULL, own_last = NULL, cwd = NULL WHERE id = ?");
  const clear = FILE_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE file_id = ?`));

  const fileRow = (d) => getFile.get(d.rel) ?? (addFile.run(d.rel, d.kind, d.sessionId, d.agentId), getFile.get(d.rel));

  // Every transcript the host still has or the archive holds, oldest first.
  const work = new Map();
  for (const root of sources) {
    for (const d of listHost(root).transcripts) if (!work.has(d.rel)) work.set(d.rel, { ...d, src: join(root, d.rel) });
  }
  for (const d of listArchived(config.archive)) if (!work.has(d.rel)) work.set(d.rel, { ...d, src: null });
  for (const d of work.values()) if (d.kind === "main") mains.add(d.sessionId);
  // A continuation starts with the same records as the file it continues, so ties go to the file last written first.
  const jobs = [...work.values()].map((d) => {
    const row = getFile.get(d.rel);
    const src = d.src ?? archivePath(config.archive, d.rel);
    return { d, ts: row?.first_ts ?? (d.src ? peekFirstTs(d.src) : null) ?? "~", mtime: statSync(src).mtimeMs };
  });
  jobs.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.mtime - b.mtime));

  for (const { d } of jobs) {
    let file = fileRow(d);
    const gz = archivePath(config.archive, d.rel);
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
      file = getFile.get(d.rel);
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
      file = getFile.get(d.rel);
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
    }
    if (offset > file.offset) totals.files++;
  }

  // Other session-folder files; the subagent meta files among them give each subagent its type.
  const copied = new Set();
  for (const root of sources) {
    for (const rel of listHost(root).others) {
      if (copied.has(rel)) continue;
      copied.add(rel);
      if (copyOther(join(root, rel), join(config.archive, rel))) totals.copied++;
    }
  }
  const putSub = db.prepare("INSERT OR REPLACE INTO subagents(agent_id, session_id, type, tool_use_id) VALUES (?, ?, ?, ?)");
  for (const { d } of jobs) {
    if (d.kind !== "sub") continue;
    const meta = join(config.archive, d.rel.replace(/\.jsonl$/, ".meta.json"));
    let parsed = {};
    try {
      parsed = JSON.parse(readFileSync(meta, "utf8"));
    } catch {
      // No readable meta file: the subagent has no recorded type.
    }
    putSub.run(d.agentId, d.sessionId, parsed.agentType ?? null, parsed.toolUseId ?? null);
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
