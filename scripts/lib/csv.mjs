// Minimal RFC-4180 CSV I/O that round-trips what Excel writes (BOM, CRLF, quoted multi-line cells).
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Excel BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (inQuotes) throw new Error("unterminated quoted field (file may be mid-save)");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !r.every((c) => c === "")); // drop blank lines
}

export function serializeCsv(rows) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    renameSync(tmp, file);
  } catch (e) {
    if (e.code === "EPERM" || e.code === "EBUSY") {
      unlinkSync(tmp);
      throw new Error(`${file} is locked by another program (is it open in Excel?). Close it and retry.`);
    }
    throw e;
  }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Cross-process mutual exclusion for a read-modify-write of `file`. A lock older than staleMs is broken.
export function withFileLock(file, fn, { retries = 100, waitMs = 50, staleMs = 60_000 } = {}) {
  const lock = `${file}.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      closeSync(openSync(lock, "wx"));
      break;
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
  try {
    return fn();
  } finally {
    try {
      unlinkSync(lock);
    } catch {}
  }
}
