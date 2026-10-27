// A minimal zip writer and reader for the framework-issue bundles (`atf issues export` / `import`, docs/packaging.md
// §3.9, user 2026-10-26: a .zip written with node:zlib and no new dependency). Only the subset the bundle needs, so it
// works on Node 20 and later on every OS:
//   - entries stored (method 0) or deflated (method 8, raw deflate); the writer stores an entry whose deflate would not be
//     smaller, an empty file included;
//   - the CRC-32 of every entry computed here (zlib.crc32 only exists from Node 22.2);
//   - UTF-8 names (general-purpose flag bit 11), always with `/`, never absolute, never `..`, never a directory entry;
//   - no zip64 (at most 65535 entries and 4 GiB), no encryption, no data descriptors, no archive comment.
// The reader trusts nothing it reads (a bundle comes from another organization): it finds the end record, walks the
// central directory, checks each local header against it, inflates, and verifies every size and CRC. Any mismatch is
// an error naming the entry; it never writes anything, so the caller decides what an entry name may become on disk.
import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_FLAG = 0x0800;
const VERSION = 20; // 2.0: deflate, the oldest version every unzip reads
const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

// CRC-32 (IEEE 802.3, the zip one) of a Buffer. -> unsigned 32-bit integer
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, local fields as zip tools show them; zip can't hold a date before 1980.
function dosTime(date) {
  const d = date.getFullYear() < 1980 ? new Date(1980, 0, 1) : date;
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

// The entry names this format allows: relative, `/`-separated, no empty, `.` or `..` segment, no backslash, colon or
// control character (Windows would read those as a drive, a stream or a separator), at most 255 bytes.
export function nameProblem(name) {
  if (typeof name !== "string" || !name) return "an entry name is empty";
  if (Buffer.byteLength(name) > 255) return `entry name '${name.slice(0, 40)}…' is longer than 255 bytes`;
  if (/[\\:\u0000-\u001f\u007f]/.test(name) || name.startsWith("/")) return `entry name '${name}' must be a relative path with '/' and no '\\', ':' or control character`;
  if (name.split("/").some((s) => s === "" || s === "." || s === "..")) return `entry name '${name}' has an empty, '.' or '..' segment`;
  return null;
}

// entries: [{ name, data: Buffer | string }] in the order they are written. -> Buffer (the whole archive). Throws on a
// bad or duplicate name, or past the format's limits.
export function writeZip(entries, { date = new Date() } = {}) {
  if (entries.length > MAX_ENTRIES) throw new Error(`a bundle holds at most ${MAX_ENTRIES} entries`);
  const { time, date: day } = dosTime(date);
  const seen = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const problem = nameProblem(e.name);
    if (problem) throw new Error(problem);
    if (seen.has(e.name)) throw new Error(`entry '${e.name}' appears twice`);
    seen.add(e.name);
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf8");
    if (data.length > MAX_SIZE) throw new Error(`entry '${e.name}' is larger than 4 GiB`);
    const deflated = data.length ? deflateRawSync(data) : data;
    const method = deflated.length < data.length ? 8 : 0;
    const body = method ? deflated : data;
    const crc = crc32(data);
    const name = Buffer.from(e.name, "utf8");
    const fields = (h, at) => {
      h.writeUInt16LE(UTF8_FLAG, at);
      h.writeUInt16LE(method, at + 2);
      h.writeUInt16LE(time, at + 4);
      h.writeUInt16LE(day, at + 6);
      h.writeUInt32LE(crc, at + 8);
      h.writeUInt32LE(body.length, at + 12);
      h.writeUInt32LE(data.length, at + 16);
      h.writeUInt16LE(name.length, at + 20);
      h.writeUInt16LE(0, at + 22); // extra field length
    };
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(VERSION, 4);
    fields(local, 6);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(VERSION, 4); // made by: MS-DOS / FAT, so no Unix mode is implied
    central.writeUInt16LE(VERSION, 6);
    fields(central, 8);
    // comment length, disk number, internal and external attributes: all 0
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
    if (offset > MAX_SIZE) throw new Error("the bundle would be larger than 4 GiB");
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// buf: a whole archive. -> { entries: [{ name, data: Buffer }] } in central-directory order | { error }. Every entry is
// inflated and checked; the first problem is the error.
export function readZip(buf) {
  try {
    return { entries: readEntries(buf) };
  } catch (e) {
    return { error: e.message };
  }
}

function readEntries(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("not a zip file (too short)");
  // the end record: the last signature whose comment runs exactly to the end of the file
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === END && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  if (buf.readUInt16LE(end + 4) !== 0 || buf.readUInt16LE(end + 6) !== 0) throw new Error("multi-disk zip files are not supported");
  const count = buf.readUInt16LE(end + 10);
  const size = buf.readUInt32LE(end + 12);
  let at = buf.readUInt32LE(end + 16);
  if (count !== buf.readUInt16LE(end + 8) || at + size > end) throw new Error("the central directory is out of bounds");
  const out = [];
  const seen = new Set();
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || buf.readUInt32LE(at) !== CENTRAL) throw new Error(`central directory entry ${n + 1} is damaged`);
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    if (at + 46 + nameLen > end) throw new Error(`central directory entry ${n + 1} is damaged`);
    const nameBuf = buf.subarray(at + 46, at + 46 + nameLen);
    const name = nameBuf.toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x0001) throw new Error(`entry '${name}' is encrypted`);
    if (method !== 0 && method !== 8) throw new Error(`entry '${name}' uses compression method ${method} (only stored and deflate are read)`);
    if (name.endsWith("/")) continue; // a directory entry another tool added: nothing to read
    const problem = nameProblem(name);
    if (problem) throw new Error(problem);
    if (seen.has(name)) throw new Error(`entry '${name}' appears twice`);
    seen.add(name);
    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== LOCAL) throw new Error(`entry '${name}': its local header is missing`);
    const lNameLen = buf.readUInt16LE(localAt + 26);
    const lExtraLen = buf.readUInt16LE(localAt + 28);
    if (!buf.subarray(localAt + 30, localAt + 30 + lNameLen).equals(nameBuf)) throw new Error(`entry '${name}': its local header names another file`);
    const start = localAt + 30 + lNameLen + lExtraLen;
    if (start + csize > buf.length) throw new Error(`entry '${name}' runs past the end of the file`);
    const body = buf.subarray(start, start + csize);
    let data;
    try {
      data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    } catch (e) {
      throw new Error(`entry '${name}' can't be inflated (${e.message})`);
    }
    if (data.length !== usize) throw new Error(`entry '${name}' has ${data.length} bytes, its header says ${usize}`);
    if (crc32(data) !== crc) throw new Error(`entry '${name}' fails its CRC-32 check: the bundle is damaged`);
    out.push({ name, data });
  }
  return out;
}
