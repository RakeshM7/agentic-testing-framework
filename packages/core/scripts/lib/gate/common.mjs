// Shared pieces of the pre-review gate (scripts/gate.mjs): file walking, findings in the review-findings format
// (docs/agent-handoffs.md §6), and the compile/list commands. Rules are mechanical on purpose: anything that needs
// judgment stays with the domain's reviewer.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const SEVERITIES = ["blocker", "major", "minor"];

export const finding = (severity, file, line, rule, problem, fix) => ({ severity, file, line, rule, problem, fix });

// Files under dir (relative to root, forward slashes) whose name matches re. Missing dirs are empty.
export function walk(root, dir, re = /./) {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).flatMap((f) => {
    const rel = path.posix.join(dir, f);
    if (statSync(path.join(root, rel)).isDirectory()) return f === "node_modules" ? [] : walk(root, rel, re);
    return re.test(f) ? [rel] : [];
  });
}

export const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
export const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const isComment = (line) => /^\s*(\/\/|\/?\*)/.test(line);

// Every match of re outside comment lines: [{line, text}].
export function matches(text, re) {
  const out = [];
  text.split(/\r?\n/).forEach((l, i) => {
    if (!isComment(l) && re.test(l)) out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}

// Titles of Playwright tests: test('…'), test.fixme('…'), test.skip('…'), test.only('…').
export function testTitles(text) {
  return [...text.matchAll(/(?<![\w$.])test(?:\.(fixme|skip|only))?\(\s*(['"`])((?:(?!\2)[\s\S])*)\2/g)].map((m) => ({
    title: m[3],
    kind: m[1] ?? "test",
    line: lineOf(text, m.index),
  }));
}

// Code hygiene every generated-code tree shares: no hard-coded URLs, no focused tests.
export function hygiene(root, files) {
  const out = [];
  for (const f of files) {
    const text = read(root, f);
    for (const m of matches(text, /https?:\/\//)) out.push(finding("blocker", f, m.line, "no-hardcoded-url", `hard-coded URL: ${m.text}`, "read the base URL from the environment (BASE_URL / API_BASE_URL)"));
    for (const m of matches(text, /\btest\.only\(/)) out.push(finding("blocker", f, m.line, "no-focused-test", "test.only would skip every other test", "remove .only"));
  }
  return out;
}

// Runs a command in cwd; returns null on success, otherwise the first lines of its output.
export function run(cmd, args, cwd) {
  try {
    execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32", timeout: 300_000 });
    return null;
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message;
    return out.split(/\r?\n/).slice(0, 8).join(" / ");
  }
}

export function renderFindings(domain, module, findings) {
  const verdict = findings.some((f) => f.severity !== "minor") ? "changes-required" : "pass";
  const cell = (s) => String(s ?? "").replace(/\r?\n+/g, " ").replace(/\|/g, "\\|");
  const rows = findings.map((f, i) => `| ${i + 1} | ${f.severity} | ${cell(f.file)} | ${f.line ?? ""} | ${cell(f.rule)} | ${cell(f.problem)} | ${cell(f.fix)} |`);
  return {
    verdict,
    text: [`# Gate -- ${domain} / ${module}`, `Verdict: ${verdict}`, "| # | Severity | File | Line | Rule | Problem | Required fix |", "|---|---|---|---|---|---|---|", ...rows, ""].join("\n"),
  };
}
