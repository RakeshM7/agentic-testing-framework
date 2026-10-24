// File helpers every script shares: atomic writes, write-if-changed, JSON read/write and a cross-process lock for a
// read-modify-write. One definition each, so every state file is written the same way (no torn file after a crash, no
// two writers clobbering one temp file).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const jsonText = (data) => JSON.stringify(data, null, 2) + "\n";
const lf = (s) => s.replace(/\r\n?/g, "\n");

// Write `text` to a temp file beside `file`, then rename it over `file`: a reader sees the old or the new content, never
// half of it. The temp name is unique per call, so two processes writing the same file never share one temp file.
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}-${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, text, "utf8");
  // On Windows a rename fails while another process (a virus scanner, an indexer) briefly holds the file: retry a few
  // times before reporting it as locked (Excel holds it for good).
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (e) {
      if (e.code !== "EPERM" && e.code !== "EBUSY") {
        try {
          unlinkSync(tmp);
        } catch {}
        throw e;
      }
      if (attempt < 10) {
        sleep(25 * (attempt + 1));
        continue;
      }
      unlinkSync(tmp);
      throw new Error(`${file} is locked by another program (is it open in Excel?). Close it and retry.`);
    }
  }
}

// Write only when the content differs, so an unchanged file keeps its mtime. `eol: "any"` treats a CRLF copy of the same
// text as unchanged. -> true when written
export function writeIfChanged(file, text, { eol = "exact" } = {}) {
  if (existsSync(file)) {
    const old = readFileSync(file, "utf8");
    if (eol === "any" ? lf(old) === lf(text) : old === text) return false;
  }
  writeAtomic(file, text);
  return true;
}

export const writeJson = (file, data) => writeAtomic(file, jsonText(data));
export const writeJsonIfChanged = (file, data) => writeIfChanged(file, jsonText(data));

// A missing file is `fallback`; a file that is not valid JSON throws, so corruption is never mistaken for absence.
export const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback);

// A missing or unreadable file is `fallback`: for optional inputs whose absence and damage mean the same thing.
export function tryReadJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function acquire(lock, { retries, waitMs, staleMs }) {
  mkdirSync(dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      closeSync(openSync(lock, "wx"));
      return;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > staleMs) {
        try {
          unlinkSync(lock);
        } catch {}
        continue;
      }
      if (i >= retries) throw new Error(`timed out waiting for ${lock}`);
      sleep(waitMs);
    }
  }
}
const release = (lock) => {
  try {
    unlinkSync(lock);
  } catch {}
};
const LOCK_DEFAULTS = { retries: 100, waitMs: 50, staleMs: 60_000 };

// Cross-process mutual exclusion for a read-modify-write of `file`. A lock older than staleMs is broken.
export function withFileLock(file, fn, opts = {}) {
  const lock = `${file}.lock`;
  acquire(lock, { ...LOCK_DEFAULTS, ...opts });
  try {
    return fn();
  } finally {
    release(lock);
  }
}

// The same for an async read-modify-write: the lock is held until `fn`'s promise settles.
export async function withFileLockAsync(file, fn, opts = {}) {
  const lock = `${file}.lock`;
  acquire(lock, { ...LOCK_DEFAULTS, ...opts });
  try {
    return await fn();
  } finally {
    release(lock);
  }
}
