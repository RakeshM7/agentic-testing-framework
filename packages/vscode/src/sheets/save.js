// Loading and saving a sheet: an atomic write that refuses when the file changed on disk since it was loaded. Node fs
// only (no vscode), so it is tested with node:test.
//
// - The snapshot is the SHA-256 of the file's bytes when the editor loaded it. A save re-reads the bytes and writes
//   only when they still hash the same; otherwise it returns the disk's text, and the editor offers a diff or a reload.
//   Content, not mtime: a script that rewrote the same bytes is no conflict, and a same-second edit is still caught.
// - The check and the write happen under the framework's own lock for a read-modify-write of that file
//   (`<file>.lock`, created exclusively, broken after 60 s: scripts/lib/files.mjs withFileLock), so an agent's
//   clarifications.mjs append/record can't land between the check and the rename, and it waits for ours.
// - The write is a temp file beside the sheet, then a rename over it (a reader sees the old or the new bytes, never
//   half), retried while Windows briefly holds the file (a scanner, an indexer) and reported as "open in another
//   program" when it stays held (Excel).
import { createHash, randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { decodeSheet, encodeSheet } from "./csv.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const LOCK = { retries: 100, waitMs: 50, staleMs: 60_000 }; // the core's defaults: ~5 s of waiting

// -> { text, hash } | { text: null, hash: null } when the file does not exist. Throws on a file that is not UTF-8.
export async function loadSheet(file, { fs = fsp } = {}) {
  let bytes;
  try {
    bytes = await fs.readFile(file);
  } catch (e) {
    if (e.code === "ENOENT") return { text: null, hash: null };
    throw e;
  }
  return { text: decodeSheet(bytes), hash: hashBytes(bytes) };
}

async function acquire(lock, fs, { retries, waitMs, staleMs }) {
  for (let i = 0; ; i++) {
    try {
      await (await fs.open(lock, "wx")).close();
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        if (Date.now() - (await fs.stat(lock)).mtimeMs > staleMs) {
          await fs.unlink(lock).catch(() => {});
          continue;
        }
      } catch {} // the lock went away between open and stat: try again
      if (i >= retries) throw new Error(`${path.basename(lock.slice(0, -5))} is being written by a script (${lock} is held); try again in a moment`);
      await sleep(waitMs);
    }
  }
}

export async function withLock(file, fn, { fs = fsp, lock = LOCK } = {}) {
  const lockFile = `${file}.lock`;
  await acquire(lockFile, fs, lock);
  try {
    return await fn();
  } finally {
    await fs.unlink(lockFile).catch(() => {});
  }
}

async function writeAtomic(file, bytes, fs) {
  const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, bytes, { flag: "wx" });
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      if ((e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES") && attempt < 10) {
        await sleep(25 * (attempt + 1));
        continue;
      }
      await fs.unlink(tmp).catch(() => {});
      if (e.code === "EPERM" || e.code === "EBUSY" || e.code === "EACCES") throw new Error(`${path.basename(file)} is open in another program (Excel?). Close it there and save again.`);
      throw e;
    }
  }
}

// Save `text` over `file` if the file is still what the editor loaded (baseHash).
// -> { saved: true, hash } | { saved: false, conflict: true, diskText, diskHash } (nothing written)
//    | { saved: false, unchanged: true, hash } (text equals the disk: nothing to write)
export async function saveSheet(file, baseHash, text, opts = {}) {
  const fs = opts.fs ?? fsp;
  if (typeof baseHash !== "string" || !baseHash) throw new Error("saveSheet: the loaded snapshot's hash is required");
  return withLock(
    file,
    async () => {
      let disk;
      try {
        disk = await fs.readFile(file);
      } catch (e) {
        if (e.code === "ENOENT") return { saved: false, conflict: true, diskText: null, diskHash: null };
        throw e;
      }
      const diskHash = hashBytes(disk);
      if (diskHash !== baseHash) {
        let diskText = null;
        try {
          diskText = decodeSheet(disk);
        } catch {}
        return { saved: false, conflict: true, diskText, diskHash };
      }
      const bytes = encodeSheet(text);
      const hash = hashBytes(bytes);
      if (hash === diskHash) return { saved: false, unchanged: true, hash };
      await writeAtomic(file, bytes, fs);
      return { saved: true, hash };
    },
    opts
  );
}
