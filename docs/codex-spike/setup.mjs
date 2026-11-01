#!/usr/bin/env node
// Codex spike: writes the scratch workspace (dev-only; see README.md in this folder).
//   node docs/codex-spike/setup.mjs [target-dir]
// Copies workspace/ and audit-hook.mjs into a fresh temp dir (or target-dir), and rewrites __HOOK__ in
// .codex/hooks.json to the absolute path of the copied audit hook. Dependency-free.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const arg = process.argv[2];
const dir = arg ? path.resolve(arg) : mkdtempSync(path.join(os.tmpdir(), "atf-codex-spike-"));
const rel = path.relative(repo, dir);
if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
  console.error(`${dir} is inside this repo; use a folder outside it`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });
cpSync(path.join(here, "workspace"), dir, { recursive: true });
cpSync(path.join(here, "audit-hook.mjs"), path.join(dir, "audit-hook.mjs"));
const hook = path.join(dir, "audit-hook.mjs").replaceAll("\\", "/");
const file = path.join(dir, ".codex", "hooks.json");
writeFileSync(file, readFileSync(file, "utf8").replaceAll("__HOOK__", hook));
console.log(`spike workspace: ${dir}`);
console.log(`audit file: ${path.join(dir, "audit.jsonl")}`);
console.log("");
console.log("Next: open the folder in the Codex CLI (cd there, run codex), the app and the IDE extension;");
console.log("trust the project; run /hooks and review the four hooks; paste the prompts from PROMPTS.md;");
console.log("then read audit.jsonl (see README.md).");
