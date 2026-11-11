// The archive mirrors the host's projects folder: each transcript as gzip members appended in
// order, so line numbers never change, and every other session-folder file copied as is.
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, utimesSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip, gzipSync } from "node:zlib";

export const HEAD_BYTES = 4096;
const BLOCK = 64 * 1024 * 1024;

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

// Current-generation transcripts present in the archive, including ones the host has deleted.
export function listArchived(archiveRoot) {
  const out = [];
  const walk = (dir) => {
    for (const e of list(dir)) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".jsonl.gz") && !/\.g\d+\.jsonl\.gz$/.test(e.name)) {
        const d = describe(relative(archiveRoot, abs).slice(0, -3));
        if (d) out.push(d);
      }
    }
  };
  walk(archiveRoot);
  return out;
}

export const archivePath = (archiveRoot, rel) => join(archiveRoot, `${rel}.gz`);

export function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function readBytes(path, position, length) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = readSync(fd, buf, done, length - done, position + done);
      if (n === 0) break;
      done += n;
    }
    return buf.subarray(0, done);
  } finally {
    closeSync(fd);
  }
}

export const hashHead = (buf) => createHash("sha256").update(buf.subarray(0, HEAD_BYTES)).digest("hex");
export const liveHead = (path, consumed) => hashHead(readBytes(path, 0, Math.min(HEAD_BYTES, consumed)));

// Complete lines after `offset`, in blocks that each end at a newline. An unfinished last line is left.
export function* newChunks(path, offset, size) {
  let pos = offset;
  let block = BLOCK;
  while (pos < size) {
    const buf = readBytes(path, pos, Math.min(block, size - pos));
    const cut = buf.lastIndexOf(10);
    if (cut < 0) {
      if (pos + buf.length >= size) return;
      block *= 2;
      continue;
    }
    const chunk = buf.subarray(0, cut + 1);
    yield chunk;
    pos += chunk.length;
    block = BLOCK;
  }
}

export function appendChunk(gzPath, chunk) {
  mkdirSync(dirname(gzPath), { recursive: true });
  appendFileSync(gzPath, gzipSync(chunk));
  return statSync(gzPath).size;
}

// Move the current archive copy aside as the next free generation; returns its number.
export function rotate(gzPath) {
  const stem = gzPath.slice(0, -".jsonl.gz".length);
  let n = 1;
  while (existsSync(`${stem}.g${n}.jsonl.gz`)) n++;
  renameSync(gzPath, `${stem}.g${n}.jsonl.gz`);
  return n;
}

// Lines of an archive file, numbered from 1, as { line, text, bytes } where bytes counts the newline.
export async function* archiveLines(gzPath, from = 1) {
  const rl = createInterface({ input: createReadStream(gzPath).pipe(createGunzip()), crlfDelay: Infinity });
  let n = 0;
  for await (const text of rl) {
    n++;
    if (n >= from) yield { line: n, text, bytes: Buffer.byteLength(text) + 1 };
  }
}

export async function readLine(gzPath, wanted) {
  for await (const { line, text } of archiveLines(gzPath, wanted)) if (line === wanted) return text;
  return null;
}

// Copy a non-transcript session file when its size or modification time changed.
export function copyOther(src, dest) {
  const s = statSync(src);
  const d = existsSync(dest) ? statSync(dest) : null;
  if (d && d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1) return false;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  utimesSync(dest, s.atimeMs / 1000, s.mtimeMs / 1000);
  return true;
}

