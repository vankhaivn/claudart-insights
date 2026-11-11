// The archive mirrors a provider's transcripts folder: each transcript as zstd frames appended in
// order, so line numbers never change, and every other session-folder file copied as is.
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, statSync, utimesSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { constants, createZstdDecompress, zstdCompressSync } from "node:zlib";

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

// Current-generation transcripts present in a provider's archive folder, including ones the host has deleted;
// `describe` is the provider's reading of a relative path.
export function listArchived(archiveRoot, describe) {
  const out = [];
  const walk = (dir) => {
    for (const e of list(dir)) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".jsonl.zst") && !/\.g\d+\.jsonl\.zst$/.test(e.name)) {
        const d = describe(relative(archiveRoot, abs).slice(0, -".zst".length));
        if (d) out.push(d);
      }
    }
  };
  walk(archiveRoot);
  return out;
}

export const archivePath = (archiveRoot, rel) => join(archiveRoot, `${rel}.zst`);

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

// Level 3: about half of gzip's size on transcripts heavy with base64 images, and over ten times faster to write.
export function appendChunk(path, chunk) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, zstdCompressSync(chunk, { params: { [constants.ZSTD_c_compressionLevel]: 3 } }));
  return statSync(path).size;
}

// Move the current archive copy aside as the next free generation; returns its number.
export function rotate(path) {
  const stem = path.slice(0, -".jsonl.zst".length);
  let n = 1;
  while (existsSync(`${stem}.g${n}.jsonl.zst`)) n++;
  renameSync(path, `${stem}.g${n}.jsonl.zst`);
  return n;
}

// Lines of an archive file, numbered from 1, as { line, text, bytes } where bytes counts the newline.
// Node's decoder stops at the end of a frame, so each frame is read from where the one before it ended.
export async function* archiveLines(path, from = 1) {
  const size = statSync(path).size;
  let n = 0;
  for (let start = 0; start < size; ) {
    const input = createReadStream(path, { start });
    const unzip = createZstdDecompress();
    input.on("error", (err) => unzip.destroy(err));
    input.pipe(unzip);
    try {
      for await (const text of createInterface({ input: unzip, crlfDelay: Infinity })) {
        n++;
        if (n >= from) yield { line: n, text, bytes: Buffer.byteLength(text) + 1 };
      }
    } finally {
      input.destroy();
      unzip.destroy();
    }
    if (!unzip.bytesWritten) throw new Error(`archive ${path} has bytes that are not a zstd frame at ${start}`);
    start += unzip.bytesWritten;
  }
}

export async function readLine(path, wanted) {
  for await (const { line, text } of archiveLines(path, wanted)) if (line === wanted) return text;
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

