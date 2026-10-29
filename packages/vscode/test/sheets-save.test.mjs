// Saving a sheet: atomic, refused when the file changed on disk since it was loaded, and under the framework's lock.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hashBytes, loadSheet, saveSheet } from "../src/sheets/save.js";
import * as clar from "../src/sheets/clarifications.js";
import { realSheets } from "./sheets-fixtures.mjs";
import { append } from "../../core/scripts/lib/clarifications.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "atf-sheets-"));

test("a save writes the edited text when the disk is still what was loaded, and leaves no temp file behind", async () => {
  const { files } = await realSheets();
  const loaded = await loadSheet(files.clarifications);
  assert.equal(loaded.hash, hashBytes(readFileSync(files.clarifications)));
  const text = clar.applyEdits(clar.readClarifications(loaded.text), [{ id: "contacts-2", answer: "Any address.", approve: false }]);
  const r = await saveSheet(files.clarifications, loaded.hash, text);
  assert.deepEqual(r, { saved: true, hash: hashBytes(Buffer.from(text)) });
  assert.equal(readFileSync(files.clarifications, "utf8"), text);
  assert.deepEqual(readdirSync(path.dirname(files.clarifications)).filter((f) => /\.tmp$|\.lock$/.test(f)), []);
  assert.deepEqual(await saveSheet(files.clarifications, r.hash, text), { saved: false, unchanged: true, hash: r.hash });
});

test("a save is refused, writing nothing, when the file changed on disk since it was loaded (an agent appended a row)", async () => {
  const { files } = await realSheets();
  const loaded = await loadSheet(files.clarifications);
  const text = clar.applyEdits(clar.readClarifications(loaded.text), [{ id: "contacts-2", answer: "Mine.", approve: false }]);
  append(files.clarifications, "contacts", "acme-run-1", [{ question: "A new question from the explorer?", steps: "1. Look." }]);
  const disk = readFileSync(files.clarifications, "utf8");
  const r = await saveSheet(files.clarifications, loaded.hash, text);
  assert.equal(r.saved, false);
  assert.equal(r.conflict, true);
  assert.equal(r.diskText, disk);
  assert.equal(readFileSync(files.clarifications, "utf8"), disk, "the agent's row is still there; the human's edit was not written");
});

test("the same bytes rewritten (a touch, a script rewriting identical text) are no conflict; a deleted file is", async () => {
  const dir = tmp();
  const file = path.join(dir, "clarifications.csv");
  writeFileSync(file, `${clar.HEADERS.join(",")}\r\nc-1,c,Q,S,,,,r\r\n`);
  const loaded = await loadSheet(file);
  writeFileSync(file, readFileSync(file));
  utimesSync(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
  assert.equal((await saveSheet(file, loaded.hash, loaded.text.replace("S,,", "S,A,"))).saved, true);
  const gone = path.join(dir, "gone.csv");
  assert.equal((await saveSheet(gone, loaded.hash, "x")).conflict, true);
  assert.equal(existsSync(gone), false);
  await assert.rejects(saveSheet(file, "", "x"), /hash is required/);
});

test("a save waits for the framework's lock on the file, and gives up with a clear message while a script holds it", async () => {
  const dir = tmp();
  const file = path.join(dir, "sheet.csv");
  writeFileSync(file, "A\r\n1\r\n");
  const { hash } = await loadSheet(file);
  writeFileSync(`${file}.lock`, ""); // clarifications.mjs mid-write
  await assert.rejects(saveSheet(file, hash, "A\r\n2\r\n", { lock: { retries: 2, waitMs: 5, staleMs: 60_000 } }), /being written by a script/);
  assert.equal(readFileSync(file, "utf8"), "A\r\n1\r\n");
  // a lock left by a crashed script is broken after staleMs, as the core's withFileLock does
  utimesSync(`${file}.lock`, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  assert.equal((await saveSheet(file, hash, "A\r\n2\r\n")).saved, true);
  assert.equal(existsSync(`${file}.lock`), false);
});

test("a file that is not UTF-8 is not loaded for editing", async () => {
  const file = path.join(tmp(), "latin1.csv");
  writeFileSync(file, Buffer.from([0x49, 0x44, 0x0d, 0x0a, 0xe9, 0x0d, 0x0a]));
  await assert.rejects(loadSheet(file));
  assert.deepEqual(await loadSheet(path.join(tmp(), "none.csv")), { text: null, hash: null });
});
