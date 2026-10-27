import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { crc32, nameProblem, readZip, writeZip } from "./lib/zip.mjs";
import { tempRoot } from "./test-helpers.mjs";

const big = Buffer.from("framework issue evidence line\n".repeat(400));
const binary = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37) % 256));
const ENTRIES = [
  { name: "manifest.json", data: '{ "format": "atf-issues" }\n' },
  { name: "issues/run-1/FI-0123abcd.json", data: big },
  { name: "evidence/run-1/e1.png", data: binary },
  { name: "evidence/run-1/empty.txt", data: "" },
  { name: "évidence/ラン/données-ü.txt", data: "Unicode name and text: ✓ ü ラン\n" },
];

test("zip: a round trip keeps every name and byte; deflate where it is smaller, stored otherwise, an empty file included", () => {
  const zip = writeZip(ENTRIES, { date: new Date(2026, 9, 26, 12, 30, 10) });
  const r = readZip(zip);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.entries.map((e) => e.name), ENTRIES.map((e) => e.name));
  for (const [i, e] of r.entries.entries()) assert.ok(e.data.equals(Buffer.isBuffer(ENTRIES[i].data) ? ENTRIES[i].data : Buffer.from(ENTRIES[i].data)), e.name);
  // method per local header: the repeated text deflates, the empty file is stored
  const method = (name) => {
    const at = zip.indexOf(Buffer.from(name)) - 30;
    return zip.readUInt16LE(at + 8);
  };
  assert.equal(method("issues/run-1/FI-0123abcd.json"), 8);
  assert.equal(method("evidence/run-1/empty.txt"), 0);
  assert.ok(zip.length < big.length, "the big entry is compressed");
  // UTF-8 names are flagged (bit 11), so every unzip reads them as UTF-8
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800);
  assert.deepEqual(readZip(writeZip([])).entries, [], "an empty archive");
});

test("zip: CRC-32 is the standard one, and the reader verifies it and every size", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
  const zip = writeZip([{ name: "a.txt", data: "stored text" }]); // too short to deflate: stored, so the bytes are plain
  const flipped = Buffer.from(zip);
  flipped[flipped.indexOf(Buffer.from("stored text"))] ^= 0x01;
  assert.match(readZip(flipped).error, /entry 'a\.txt' fails its CRC-32 check/);
  const cut = zip.subarray(0, zip.length - 30);
  assert.match(readZip(cut).error, /not a zip file/);
  assert.match(readZip(Buffer.from("PK nothing")).error, /not a zip file/);
  // a deflated body damaged in place
  const deflated = writeZip([{ name: "b.txt", data: big }]);
  const bad = Buffer.from(deflated);
  bad[40] ^= 0xff;
  assert.ok(readZip(bad).error);
});

test("zip: names must be relative with '/', unique, without '..', '\\\\' or ':'; the reader refuses the same from another tool", () => {
  for (const name of ["/abs.txt", "a/../b.txt", "a\\b.txt", "C:/x.txt", "a//b", "", "x\u0000y"]) assert.ok(nameProblem(name), JSON.stringify(name));
  assert.equal(nameProblem("issues/run-1/FI-0123abcd.json"), null);
  assert.throws(() => writeZip([{ name: "a.txt", data: "1" }, { name: "a.txt", data: "2" }]), /appears twice/);
  assert.throws(() => writeZip([{ name: "../a.txt", data: "1" }]), /'\.\.' segment/);
  // a hostile archive: the same bytes with a name rewritten to climb out
  const zip = writeZip([{ name: "aa/b.txt", data: "x" }]);
  const evil = Buffer.from(zip.toString("latin1").replaceAll("aa/b.txt", "../b.txt"), "latin1");
  assert.match(readZip(evil).error, /'\.\.' segment/);
});

test("zip: unzip -t accepts what the writer makes (when unzip is installed)", (t) => {
  if (spawnSync("unzip", ["-v"], { encoding: "utf8" }).error) return t.skip("unzip is not installed");
  const file = path.join(tempRoot(), "bundle.zip");
  writeFileSync(file, writeZip(ENTRIES));
  const r = spawnSync("unzip", ["-t", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No errors detected/);
});
