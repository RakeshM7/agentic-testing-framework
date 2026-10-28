#!/usr/bin/env node
// Antigravity spike: audit hook (dev-only, never shipped; see README.md in this folder).
//
//   node audit-hook.mjs [audit.jsonl] [--event pre|post] [--source <label>] [--agent <name>]
//                       [--deny-canary [--exit2] [--ask] | --allow-canary]
//
// Appends one JSON line per call: { ts, argv, cwd, env, payload, emitted } to the audit file (default
// ./antigravity-audit.jsonl, relative to the hook's cwd). env keeps only names matching
// /ANTIGRAVITY|GEMINI|AGY|CLAUDE|VSCODE|TERM_PROGRAM/i, and blanks the values of secret-looking ones.
//
// Default: prints nothing and exits 0, so it never blocks a call.
// --deny-canary: a pre-tool call whose arguments contain "atf-spike-canary" is refused, to test which deny form the
// host honours:
//   (alone)    stdout {"decision":"deny","reason":...}, exit 0   (the documented form)
//   --exit2    the reason on stderr, exit 2, nothing on stdout
//   --ask      stdout {"decision":"ask","reason":...}, exit 0    (does the human get a prompt?)
// --allow-canary: such a call gets stdout {"decision":"allow",...}, exit 0 instead. The second hook set (client-set,
// setup.mjs --second-set) uses it to test whether another set's allow can override the first set's deny.
// Dependency-free.
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const CANARY = "atf-spike-canary";
const ENV_NAMES = /ANTIGRAVITY|GEMINI|AGY|CLAUDE|VSCODE|TERM_PROGRAM/i;
const SECRET = /KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE/i;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};
const VALUED = new Set(["--event", "--source", "--agent"]);
const positional = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
const auditFile = path.resolve(positional[0] ?? "antigravity-audit.jsonl");

const env = Object.fromEntries(
  Object.entries(process.env)
    .filter(([k]) => ENV_NAMES.test(k))
    .map(([k, v]) => [k, SECRET.test(k) ? "<redacted>" : v])
    .sort(([a], [b]) => a.localeCompare(b)),
);

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    // a host that never closes stdin must not hang the call: take what arrived after 5 s
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
  } catch {
    payload = { unparsed: raw };
  }

  let emitted = null;
  const isPost = value("--event") === "post" || /post/i.test(String(payload?.hookEventName ?? payload?.event ?? ""));
  if (flag("--allow-canary") && !isPost && JSON.stringify(payload?.toolCall?.args ?? payload?.toolCall ?? payload ?? "").includes(CANARY)) {
    const out = { decision: "allow", reason: `atf spike: the second set allows a call containing ${CANARY}` };
    emitted = { exit: 0, stdout: out };
    process.stdout.write(JSON.stringify(out));
  } else if (flag("--deny-canary") && !isPost) {
    const args = payload?.toolCall?.args ?? payload?.toolCall ?? payload;
    if (JSON.stringify(args ?? "").includes(CANARY)) {
      const reason = `atf spike: refused a call containing ${CANARY} (${flag("--exit2") ? "exit 2" : flag("--ask") ? "ask" : "stdout deny"})`;
      if (flag("--exit2")) {
        emitted = { exit: 2, stderr: reason };
        process.stderr.write(`${reason}\n`);
        code = 2;
      } else {
        const out = { decision: flag("--ask") ? "ask" : "deny", reason };
        emitted = { exit: 0, stdout: out };
        process.stdout.write(JSON.stringify(out));
      }
    }
  }

  mkdirSync(path.dirname(auditFile), { recursive: true });
  appendFileSync(auditFile, `${JSON.stringify({ ts: new Date().toISOString(), argv, cwd: process.cwd(), env, payload, emitted })}\n`);
} catch {
  // an audit hook never blocks because it failed
}
process.exit(code);
