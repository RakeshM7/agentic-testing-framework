// The sheets' CSV core (src/sheets/csv.js): byte-for-byte round trips over the framework's real sheets, the same cell
// values as the framework's own reader, and edits that touch only the edited cells.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { decodeSheet, detectDelimiter, encodeCell, encodeSheet, parseSheet, rows, setCells } from "../src/sheets/csv.js";
import { parseCsv } from "../../core/scripts/lib/csv.mjs";
import { realSheets } from "./sheets-fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FROZEN = path.join(here, "..", "..", "core", "scripts", "fixtures", "workspaces", "contract-2", "artifacts", "acme", "modules", "contacts");

// Every cell's raw bytes, in order, plus the separators between them: rebuilding the text from the spans must give
// the text back exactly.
function rebuilt(doc) {
  let out = doc.bom ? "﻿" : "";
  let at = doc.bom ? 1 : 0;
  for (const r of doc.records) for (const c of r.cells) {
    out += doc.text.slice(at, c.start) + doc.text.slice(c.start, c.end);
    at = c.end;
  }
  return out + doc.text.slice(at);
}

// The text outside the given cells, which an edit must leave alone.
function outside(doc, cells) {
  const skip = new Set(cells.map(([r, c]) => `${r}:${c}`));
  return doc.records.flatMap((r, ri) => r.cells.map((c, ci) => (skip.has(`${ri}:${ci}`) ? "<edited>" : doc.text.slice(c.start, c.end)))).join("|");
}

// Excel's variants of a sheet the framework wrote: a BOM, LF line ends, ";" (a comma-decimal locale), quotes on every
// cell, a trailing blank line.
function variants(text) {
  const semi = rows(parseSheet(text)).map((r) => r.map((v) => encodeCell(v, ";")).join(";")).join("\r\n") + "\r\n";
  const allQuoted = rows(parseSheet(text)).map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\r\n") + "\r\n";
  return { asWritten: text, bom: `﻿${text}`, lf: text.replace(/\r\n/g, "\n"), semicolon: semi, allQuoted, trailingBlank: `${text}\r\n,,,\r\n` };
}

test("round trip: the frozen contract-2 sheets and freshly built ones parse and rebuild byte for byte, with the core's cell values", async () => {
  const sheets = { "frozen clarifications": readFileSync(path.join(FROZEN, "clarifications.csv"), "utf8"), "frozen approval": readFileSync(path.join(FROZEN, "testcases", "approval.csv"), "utf8"), ...(await realSheets()).texts };
  for (const [name, text] of Object.entries(sheets))
    for (const [variant, t] of Object.entries(variants(text))) {
      const doc = parseSheet(t);
      assert.equal(rebuilt(doc), t, `${name} (${variant}) rebuilds`);
      assert.equal(setCells(doc, []), t, `${name} (${variant}): no edit, same text`);
      assert.deepEqual(rows(doc), parseCsv(t, { delimiter: detectDelimiter(t) }), `${name} (${variant}): same values as the core's parseCsv`);
      const bytes = encodeSheet(t);
      assert.equal(decodeSheet(bytes), t, `${name} (${variant}): bytes -> text -> bytes`);
      assert.deepEqual(encodeSheet(decodeSheet(bytes)), bytes);
    }
});

test("an edit splices only its cells: quoting, line ends, the BOM and every other cell keep their bytes", async () => {
  const { texts } = await realSheets();
  for (const [name, base] of Object.entries(texts))
    for (const [variant, text] of Object.entries(variants(base))) {
      const doc = parseSheet(text);
      const target = doc.records.findIndex((r, i) => i > 0 && !r.blank);
      const edits = [
        { record: target, col: 1, value: 'a "quoted", multi-line\nvalue' },
        { record: target, col: 2, value: "plain" },
      ];
      const after = setCells(doc, edits);
      const again = parseSheet(after);
      assert.equal(again.records[target].cells[1].value, 'a "quoted", multi-line\nvalue', `${name} (${variant})`);
      assert.equal(again.records[target].cells[2].value, "plain");
      assert.equal(outside(again, [[target, 1], [target, 2]]), outside(doc, [[target, 1], [target, 2]]), `${name} (${variant}): nothing else changed`);
      assert.equal(again.bom, doc.bom);
      assert.equal(again.delimiter, doc.delimiter);
      // a cell Excel quoted stays quoted even when its new value needs no quotes
      if (variant === "allQuoted") assert.equal(after.slice(again.records[target].cells[2].start, again.records[target].cells[2].end), '"plain"');
    }
});

test("an edit past a short row adds the empty cells before it; an empty last cell is filled in place", () => {
  const doc = parseSheet("A,B,C,D\r\nx,y\r\np,q,,\r\n");
  const after = setCells(doc, [{ record: 1, col: 3, value: "d" }, { record: 2, col: 3, value: "z" }, { record: 2, col: 2, value: "w" }]);
  assert.equal(after, "A,B,C,D\r\nx,y,,d\r\np,q,w,z\r\n");
  const noEol = setCells(parseSheet("A,B\nx"), [{ record: 1, col: 1, value: "1;2" }]);
  assert.equal(noEol, "A,B\nx,1;2");
});

test("unchanged values are no-ops; bad input is refused", () => {
  const text = 'ID,Note\r\n1,"same"\r\n';
  assert.equal(setCells(parseSheet(text), [{ record: 1, col: 1, value: "same" }]), text, "the quoted cell keeps its quotes");
  assert.throws(() => parseSheet('a,"b\r\n'), /unterminated/);
  assert.throws(() => setCells(parseSheet(text), [{ record: 9, col: 0, value: "" }]), /no record/);
  assert.throws(() => decodeSheet(Uint8Array.from([0x41, 0xe9, 0x42])), "Latin-1 bytes are not edited through a lossy decode");
});
