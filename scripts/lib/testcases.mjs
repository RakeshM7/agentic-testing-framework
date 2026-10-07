// Test case file contract: artifacts/<product>/modules/<m>/testcases/
//   <m>-testcases.<ext>     ext by testcases.output_format: gherkin -> .feature, csv/testrail -> .csv, markdown-table -> .md
//   testcases-summary.md    must contain a line "Total test cases: N" equal to the number of cases in the file
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv.mjs";

export const EXT = { gherkin: "feature", csv: "csv", testrail: "csv", "markdown-table": "md" };
const TOTAL_RE = /^Total test cases:\s*(\d+)\s*$/im;

export const testcasesFile = (moduleDir, module, format) => path.join(moduleDir, "testcases", `${module}-testcases.${EXT[format]}`);

export function countCases(file, format) {
  const text = readFileSync(file, "utf8");
  if (format === "gherkin") return (text.match(/^\s*Scenario( Outline)?:/gm) ?? []).length;
  if (format === "csv" || format === "testrail") return Math.max(parseCsv(text).length - 1, 0);
  // markdown-table: data rows of every table (header + separator excluded)
  const lines = text.split(/\r?\n/);
  let n = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].trim().startsWith("|") && !/^\|?\s*:?-{3,}/.test(lines[i].trim()) && !/^\|?\s*:?-{3,}/.test((lines[i + 1] ?? "").trim())) n++;
  return n;
}

export function checkTestcases(summaryFile, { module, testcasesFormat = "gherkin" }) {
  const file = testcasesFile(path.dirname(path.dirname(summaryFile)), module, testcasesFormat);
  if (!existsSync(file)) return [`${path.basename(file)} is missing (format ${testcasesFormat})`];
  const m = TOTAL_RE.exec(readFileSync(summaryFile, "utf8"));
  if (!m) return ['summary needs a line "Total test cases: N"'];
  const n = countCases(file, testcasesFormat);
  if (!n) return [`${path.basename(file)} contains no test cases`];
  return Number(m[1]) === n ? [] : [`summary says ${m[1]} test cases but ${path.basename(file)} has ${n}`];
}
