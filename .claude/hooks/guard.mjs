#!/usr/bin/env node
// Claude Code PreToolUse hook. Thin adapter over scripts/lib/guard.mjs, which holds the rules, the mode and the
// per-agent permissions (keyed on the hook input's `agent_type`). Exit 2 = block; stderr goes back to the model.
// Fails closed: if the guard itself errors while any product run is active, the call is blocked.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

try {
  const { checkTool } = await import(pathToFileURL(path.join(root, "scripts", "lib", "guard.mjs")).href);
  const verdict = checkTool(input, root);
  if (!verdict.allowed) {
    console.error(`Blocked by the framework safety guard (${verdict.rule}): ${verdict.reason}`);
    process.exit(2);
  }
} catch (e) {
  const artifacts = path.join(root, "artifacts");
  const active = existsSync(artifacts) && readdirSync(artifacts).some((p) => existsSync(path.join(artifacts, p, "state", "lock.json")));
  if (active) {
    console.error(`Blocked: the framework safety guard failed (${e.message}) while a run is active; failing closed.`);
    process.exit(2);
  }
}
