// Minimal RFC-4180 CSV I/O that round-trips what Excel writes (BOM, CRLF, quoted multi-line cells).

// delimiter: "," (default) or ";" (Excel in locales whose decimal mark is a comma); detectDelimiter() tells which.
export function parseCsv(text, { delimiter = "," } = {}) {
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
    else if (c === delimiter) {
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

export function serializeCsv(rows, { delimiter = "," } = {}) {
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(delimiter)).join("\r\n") + "\r\n";
}

// The delimiter of a CSV file's header line: ";" when it has more unquoted semicolons than commas, else ",".
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
