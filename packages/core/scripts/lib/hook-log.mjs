// The hook entries' error log (D-065): one JSON line per error in artifacts/hook-errors.jsonl, with the stack and what
// the hook was handling, since a host shows a hook's stderr briefly or (for Claude Code's async PostToolUse) not at all.
// Records the tool name and input keys only, never input values (they can hold file contents); the raw payload, cut
// short, only when it could not be parsed. Callers wrap this in their own try: logging must never change a verdict.
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export const HOOK_LOG = path.join("artifacts", "hook-errors.jsonl");
const MAX_BYTES = 1024 * 1024; // past this the log is moved to hook-errors.jsonl.1 (one generation kept)
const RAW_CHARS = 500;

export function logHookError(root, { hook, args = {}, error, payload, raw, outcome }) {
  const file = path.join(root, HOOK_LOG);
  mkdirSync(path.dirname(file), { recursive: true });
  if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`);
  const p = payload && typeof payload === "object" ? payload : undefined;
  const input = p && (p.tool_input ?? p.toolArgs);
  const entry = {
    time: new Date().toISOString(),
    hook,
    host: args.host,
    agent: args.agent ?? p?.agent_type,
    tool: p?.tool_name ?? p?.toolName,
    inputKeys: input && typeof input === "object" ? Object.keys(input) : undefined,
    sessionId: p?.session_id ?? p?.sessionId,
    cwd: process.cwd(),
    outcome,
    error: error?.message ?? String(error),
    stack: error?.stack,
    raw: p ? undefined : typeof raw === "string" ? raw.slice(0, RAW_CHARS) : undefined,
  };
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
  return file;
}
