#!/usr/bin/env node
// Guards against committing personal data and secrets.
//
// Fails (exit 1) on:
//   - e-mail addresses whose domain/address is not in scripts/pii-allowlist.json
//   - private keys, JWTs, AWS access keys, long literal api_key/secret/token assignments
//   - non-example .env files and Playwright storageState / session files (cookies)
// Warns (never fails) on every occurrence of `warnTerms` (e.g. a real tenant hostname), so it stays
// visible without blocking. Binary files (screenshots) cannot be scanned: review those by eye.
//
// Usage: node scripts/check-pii.mjs [--verbose]

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allow = JSON.parse(readFileSync(path.join(repoRoot, "scripts", "pii-allowlist.json"), "utf8"));
const verbose = process.argv.includes("--verbose");

const SKIP_DIRS = new Set(["node_modules", ".git", "playwright-report", "test-results"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".zip"]);
const SKIP_FILES = new Set(["package-lock.json", "pii-allowlist.json", "check-pii.mjs"]);

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const SECRET_RULES = [
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "literal secret assignment", re: /\b(?:api[_-]?key|secret|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["'][A-Za-z0-9_\-+/=]{24,}["']/i },
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const mask = (s) => (s.length <= 6 ? "***" : `${s.slice(0, 3)}***${s.slice(-6)}`);
const emailAllowed = (e) => {
  const lower = e.toLowerCase();
  const domain = lower.split("@")[1];
  return allow.emails.map((x) => x.toLowerCase()).includes(lower) || allow.emailDomains.includes(domain);
};

const findings = [];
const warnCounts = new Map();

for (const file of walk(repoRoot)) {
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();

  // File-level rules (apply even to files we won't read as text).
  if (/^\.env(\..+)?$/.test(base) && !/\.example$/.test(base)) {
    findings.push({ rel, line: 0, rule: "real .env file present (must be gitignored, never committed)", sample: base });
    continue;
  }
  if (/(^|\/)\.auth\//.test(rel) || /storage-?state/i.test(base)) {
    findings.push({ rel, line: 0, rule: "session/storageState file present (contains cookies)", sample: base });
    continue;
  }
  if (BINARY_EXT.has(ext) || SKIP_FILES.has(base)) continue;

  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const m of line.matchAll(EMAIL)) {
      if (!emailAllowed(m[0])) findings.push({ rel, line: i + 1, rule: "non-allowlisted e-mail address", sample: mask(m[0]) });
    }
    for (const rule of SECRET_RULES) {
      if (rule.re.test(line)) findings.push({ rel, line: i + 1, rule: rule.name, sample: "(redacted)" });
    }
    for (const term of allow.warnTerms ?? []) {
      if (line.includes(term)) warnCounts.set(term, (warnCounts.get(term) ?? new Map()).set(rel, ((warnCounts.get(term)?.get(rel)) ?? 0) + 1));
    }
  }
}

for (const f of findings) console.log(`FAIL  ${f.rel}${f.line ? `:${f.line}` : ""}  ${f.rule}  [${f.sample}]`);

for (const [term, perFile] of warnCounts) {
  const total = [...perFile.values()].reduce((a, b) => a + b, 0);
  console.log(`WARN  watched term '${term}': ${total} occurrence(s) in ${perFile.size} file(s) (not failing; replace or parametrize before publishing)`);
  if (verbose) for (const [f, n] of perFile) console.log(`        ${f} x${n}`);
}

console.log(`\n${findings.length} finding(s).${findings.length ? "" : " No personal data or secrets detected in text files."}`);
process.exit(findings.length ? 1 : 0);
