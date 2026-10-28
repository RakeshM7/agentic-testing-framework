#!/usr/bin/env node
// Antigravity spike: writes the scratch workspace (dev-only; see README.md in this folder).
//
//   node docs/antigravity-spike/setup.mjs <scratch-dir> [--deny-canary [--exit2] [--ask]] [--second-set]
//
// Copies workspace/ and audit-hook.mjs into <scratch-dir>, filling the placeholders:
//   __SPIKE_DIR__  the scratch dir (absolute, forward slashes)
//   __REPO__       this repo (absolute, forward slashes), for the browser server's init page
//   __MODE__       the deny flags passed here, added to the workspace hook set only
// The hook set client-set (an audit hook that answers allow to the canary, after atf-spike) is kept only with
// --second-set, to test how Antigravity combines two sets (README check 8).
// Run it again with other flags to switch the deny form; the audit file is kept. Dependency-free.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const [target, ...flags] = process.argv.slice(2);
const MODES = new Set(["--deny-canary", "--exit2", "--ask", "--second-set"]);
if (!target || flags.some((f) => !MODES.has(f))) {
  console.error("usage: node docs/antigravity-spike/setup.mjs <scratch-dir> [--deny-canary [--exit2] [--ask]] [--second-set]");
  process.exit(1);
}
const dir = path.resolve(target);
const rel = path.relative(repo, dir);
if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
  console.error(`${dir} is inside this repo; use a scratch folder outside it (e.g. C:\\atf-spike or ~/atf-spike)`);
  process.exit(1);
}
if (/\s/.test(dir)) console.error(`warning: ${dir} has a space; the hook commands quote it, but a path without spaces is safer`);

const slash = (p) => p.replaceAll("\\", "/");
const secondSet = flags.includes("--second-set");
const hookFlags = flags.filter((f) => f !== "--second-set");
const fill = (text) => text.replaceAll("__SPIKE_DIR__", slash(dir)).replaceAll("__REPO__", slash(repo)).replaceAll(" __MODE__", hookFlags.length ? ` ${hookFlags.join(" ")}` : "");

function copy(from, to) {
  for (const name of readdirSync(from)) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copy(src, dst);
    } else writeFileSync(dst, fill(readFileSync(src, "utf8")));
  }
}
mkdirSync(dir, { recursive: true });
copy(path.join(here, "workspace"), dir);
cpSync(path.join(here, "audit-hook.mjs"), path.join(dir, "audit-hook.mjs"));
if (!secondSet) {
  const hooks = path.join(dir, ".agents", "hooks.json");
  const sets = JSON.parse(readFileSync(hooks, "utf8"));
  delete sets["client-set"];
  writeFileSync(hooks, `${JSON.stringify(sets, null, 2)}
`);
}
console.log(`spike workspace written to ${dir} (workspace hook flags: ${hookFlags.join(" ") || "audit only"}${secondSet ? "; with the second set client-set" : ""})`);
console.log(`audit file: ${path.join(dir, "antigravity-audit.jsonl")}${existsSync(path.join(dir, "antigravity-audit.jsonl")) ? " (kept)" : ""}`);
