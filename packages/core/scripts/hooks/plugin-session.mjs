#!/usr/bin/env node
// SessionStart hook of the Claude Code plugin (docs/packaging.md §3.12, draft P-11; scripts/build-plugin.mjs registers
// it in the plugin's hooks/hooks.json). It records which plugin version this session loaded, so the doctor and
// run.mjs can hold it to the installed @testagentic/atf, which must be the same version: the plugin's agents call the
// package's scripts (`node node_modules/@testagentic/atf/scripts/…`), and an agent from one release driving the
// scripts of another is exactly the drift the lock exists to refuse.
//
//   node "${CLAUDE_PROJECT_DIR}/node_modules/@testagentic/atf/scripts/hooks/plugin-session.mjs" --plugin-version <v>
//
// writes <workspace>/artifacts/.atf-plugin.json = { "plugin": "atf", "version": "<v>", "at": "<ISO time>" }.
//
// Not a safety hook: the guard is never in the plugin (D-020, D-092); it stays registered in the project's
// .claude/settings.json by atf sync. So this one must never get in a session's way:
//   - it always exits 0 and prints nothing on stdout (Claude Code adds a SessionStart hook's stdout to the session's
//     context); a problem is one line on stderr, which only a debug session shows. A missing record is what the
//     doctor reports, so failing quietly here loses nothing;
//   - it writes only inside a workspace (atf/atf.json, found from the project directory up, as every script finds it:
//     scripts/lib/roots.mjs), creating artifacts/ when needed; anywhere else it does nothing;
//   - it reads no stdin (the project directory comes from the environment Claude Code sets for hooks, else the
//     working directory, which is the project's), so it can't hang on a terminal;
//   - roots.mjs is loaded with import() inside the try, as the hook entries load their libs (pretooluse.mjs), so even
//     a broken install can't make it throw. Node built-ins only.
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const PLUGIN = "atf";
const RECORD = "artifacts/.atf-plugin.json";
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const say = (msg) => {
  try {
    process.stderr.write(`atf plugin-session: ${msg}\n`);
  } catch {}
};

let tmp;
try {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { "plugin-version": { type: "string" } }, strict: false });
  const version = values["plugin-version"];
  if (typeof version !== "string" || !SEMVER.test(version)) say(`no valid --plugin-version (got ${JSON.stringify(version ?? null)}); nothing recorded`);
  else {
    const { findWorkspace } = await import("../lib/roots.mjs");
    const start = process.env.ATF_WORKSPACE || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const ws = findWorkspace(start);
    if (!ws) say(`${start} is not in an atf workspace (no atf/atf.json); nothing recorded`);
    else {
      const file = path.join(ws, ...RECORD.split("/"));
      mkdirSync(path.dirname(file), { recursive: true });
      // written whole, then renamed over the old record, so a reader never sees half a file (two sessions starting at
      // once each leave a complete one)
      tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify({ plugin: PLUGIN, version, at: new Date().toISOString() }, null, 2)}\n`);
      renameSync(tmp, file);
      tmp = undefined;
    }
  }
} catch (e) {
  say(`could not record the plugin version (${e?.message ?? e})`);
  if (tmp)
    try {
      rmSync(tmp, { force: true });
    } catch {}
}
process.exitCode = 0;
