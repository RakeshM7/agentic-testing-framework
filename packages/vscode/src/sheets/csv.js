// A CSV reader and writer that round-trips the framework's sheets byte for byte. No vscode import, no dependencies.
//
// Why not packages/core/scripts/lib/csv.mjs: it is the same RFC-4180 state machine, but it returns values only, drops
// the BOM, and its writer re-quotes every cell and joins rows with CRLF. Writing a human's edit back through it would
// rewrite every cell of a sheet the human (or Excel) saved, which is exactly what the contract asks a human edit not to
// do. It also ships in the licensed package, and this extension is public and holds no framework code. So this module
// parses with the *same* state machine (the cell values agree with the core's parseCsv, which the tests check over real
// sheets) but keeps each cell's span in the text, and an edit splices only the edited cells' spans. Every other byte --
// BOM, delimiter, line endings, quoting, blank lines, column order -- is the file's own.

// Text from the file's bytes. Strict UTF-8 (the framework reads and writes UTF-8 only), with the BOM kept in the text so
// that encode(decode(bytes)) is the same bytes. A file that is not valid UTF-8 (an Excel "CSV (Windows)" save) throws:
// editing it through a lossy decode would change bytes the human never touched.
export function decodeSheet(bytes) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  return text;
}
export const encodeSheet = (text) => new TextEncoder().encode(text);

// The delimiter of the header line: ";" when it has more unquoted semicolons than commas, else ",". The same rule as
// the core's detectDelimiter (approval.csv may be saved by Excel in a locale whose list separator is ";").
export function detectDelimiter(text) {
  let comma = 0;
  let semi = 0;
  let q = false;
  for (const c of String(text).replace(/^﻿/, "")) {
    if (c === '"') q = !q;
    else if (!q && (c === "\n" || c === "\r")) break;
    else if (!q && c === ",") comma++;
    else if (!q && c === ";") semi++;
  }
  return semi > comma ? ";" : ",";
}

// -> { text, bom, delimiter, eol, records: [{ cells: [{value, start, end, quoted}], start, end, blank }] }
// start/end are offsets into `text` (end exclusive); a record's end is where its line break starts. `blank` marks a
// record whose cells are all empty: the core's parseCsv drops those, so models skip them too (`rows()` below).
// eol is the file's first record separator (CRLF when it has none yet), used only if an edit must add one.
export function parseSheet(text, { delimiter = detectDelimiter(text) } = {}) {
  if (typeof text !== "string") throw new TypeError("parseSheet: text must be a string");
  if (delimiter !== "," && delimiter !== ";") throw new Error(`delimiter must be ',' or ';', not '${delimiter}'`);
  const bom = text.charCodeAt(0) === 0xfeff;
  const records = [];
  let eol = null;
  let cells = [];
  let recStart = bom ? 1 : 0;
  let cellStart = recStart;
  let field = "";
  let inQuotes = false;
  const endCell = (i) => {
    cells.push({ value: field, start: cellStart, end: i, quoted: text[cellStart] === '"' });
    field = "";
    cellStart = i + 1;
  };
  const endRecord = (i) => {
    records.push({ cells, start: recStart, end: i, blank: cells.every((c) => c.value === "") });
    cells = [];
  };
  let i = recStart;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true; // anywhere in a field, exactly as the core reads it
    else if (c === delimiter) endCell(i);
    else if (c === "\n" || c === "\r") {
      const crlf = c === "\r" && text[i + 1] === "\n";
      eol ??= crlf ? "\r\n" : c;
      endCell(i);
      endRecord(i);
      if (crlf) i++;
      recStart = cellStart = i + 1;
    } else field += c;
  }
  if (inQuotes) throw new Error("unterminated quoted field (the file may be mid-save; reload it in a moment)");
  if (field !== "" || cells.length || cellStart < text.length) {
    endCell(i);
    endRecord(i);
  }
  return { text, bom, delimiter, eol: eol ?? "\r\n", records };
}

// The non-blank records as arrays of values: what the core's parseCsv returns for the same text.
export const rows = (doc) => doc.records.filter((r) => !r.blank).map((r) => r.cells.map((c) => c.value));

// One cell as the file will hold it. Quoted when the core's writer would quote it (a quote, a comma, the delimiter or
// a line break), or when the cell being replaced was quoted, so a column Excel quoted keeps looking the same.
export function encodeCell(value, delimiter, { quoted = false } = {}) {
  const s = String(value ?? "");
  const needs = /[",\r\n]/.test(s) || s.includes(delimiter);
  return needs || quoted ? `"${s.replace(/"/g, '""')}"` : s;
}

// Replace cells. edits: [{ record, col, value }] with `record` an index into doc.records and `col` a column index.
// A column past the record's last cell is added with the empty cells before it (a row Excel saved short). The text
// outside the edited cells is copied unchanged; an edit whose value equals the cell's current value is a no-op, so an
// untouched cell keeps its exact bytes. -> the new text
export function setCells(doc, edits) {
  const byRecord = new Map();
  for (const e of edits) {
    const rec = doc.records[e.record];
    if (!rec) throw new Error(`no record ${e.record}`);
    if (!Number.isInteger(e.col) || e.col < 0) throw new Error(`bad column ${e.col}`);
    if (!byRecord.has(e.record)) byRecord.set(e.record, new Map());
    byRecord.get(e.record).set(e.col, String(e.value ?? ""));
  }
  const splices = [];
  for (const [ri, cols] of byRecord) {
    const rec = doc.records[ri];
    const max = Math.max(...cols.keys());
    if (max >= rec.cells.length) {
      let tail = "";
      for (let c = rec.cells.length; c <= max; c++) tail += doc.delimiter + (cols.has(c) ? encodeCell(cols.get(c), doc.delimiter) : "");
      splices.push({ start: rec.end, end: rec.end, text: tail, tail: true });
    }
    for (const [c, value] of cols) {
      const cell = rec.cells[c];
      if (!cell || cell.value === value) continue;
      splices.push({ start: cell.start, end: cell.end, text: encodeCell(value, doc.delimiter, { quoted: cell.quoted }) });
    }
  }
  // right to left, so earlier offsets stay valid. At one offset the tail (a zero-width insert at the record's end) goes
  // first: an empty last cell also starts there, and its new value must land before the added cells, not after them.
  splices.sort((a, b) => b.start - a.start || (a.tail ? -1 : b.tail ? 1 : 0));
  let text = doc.text;
  for (const s of splices) text = text.slice(0, s.start) + s.text + text.slice(s.end);
  return text;
}
