#!/usr/bin/env node
// Codex spike: audit hook (dev-only, never shipped; see README.md in this folder).
//
// Reads the hook payload from stdin and appends {ts, cwd, argv, payload, emitted} to audit.jsonl next to THIS
// script (not the cwd). Then:
//   default                              allow: exit 0, no output
//   tool input contains SPIKE-DENY-JSON   stdout deny JSON (the documented form), exit 0
//   tool input contains SPIKE-DENY-EXIT2  reason on stderr, exit 2
// Never throws. Dependency-free.
import { appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const audit = path.join(path.dirname(fileURLToPath(import.meta.url)), "audit.jsonl");

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    const timer = setTimeout(() => resolve(data), 5000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => (clearTimeout(timer), resolve(data)));
    process.stdin.on("error", () => (clearTimeout(timer), resolve(data)));
  });
}

let code = 0;
try {
  const raw = (await readStdin()).replace(/^﻿/, "");
  let payload;
  try {
    payload = raw.trim() ? JSON.parse(raw) : null;
  } catch (e) {
    payload = { unparsed: raw, parseError: String(e) };
  }
  let emitted = null;
  try {
    const isPre = String(payload?.hook_event_name ?? "PreToolUse") === "PreToolUse";
    const text = JSON.stringify(payload?.tool_input ?? "");
    if (isPre && text.includes("SPIKE-DENY-JSON")) {
      const out = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "atf spike: SPIKE-DENY-JSON refused (stdout JSON, exit 0)",
        },
      };
      process.stdout.write(JSON.stringify(out));
      emitted = { exit: 0, stdout: out };
    } else if (isPre && text.includes("SPIKE-DENY-EXIT2")) {
      const reason = "atf spike: SPIKE-DENY-EXIT2 refused (stderr, exit 2)";
      process.stderr.write(`${reason}\n`);
      emitted = { exit: 2, stderr: reason };
      code = 2;
    }
  } catch {
    // keep going: the audit line matters more
  }
  try {
    appendFileSync(audit, `${JSON.stringify({ ts: new Date().toISOString(), cwd: process.cwd(), argv: process.argv.slice(2), payload, emitted })}\n`);
  } catch {
    // an audit hook never blocks because it failed
  }
} catch {
  // never throw
}
process.exit(code);
