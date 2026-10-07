// Platform-neutral safety guard. Inputs: a tool call (tool name, input, calling agent type) and the active runs.
//
// Sources of truth (nothing else):
//   - active runs:  every artifacts/<product>/state/lock.json (one active run per product)
//   - mode:         that run's state/run.json `mode`, resolved once from the run-config at `run.mjs init`
//   - permissions:  that run's state/permissions.resolved.json (frozen copy of config/permissions.yaml)
//   - ownership:    that run's state/ledger.jsonl, entries of the CURRENT run only
// The env var AUTHORIZATIONS_MODE=readonly can only downgrade. No active run => readonly, no per-agent rules.
// Agents not listed in the permissions file ("unmanaged", e.g. a human's own session) get the mode rules only.
//
// Dependency-free (imported by a PreToolUse hook on every guarded tool call).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { live } from "./ledger.mjs";
import { atLeast, canWrite, effectiveLiveTarget, shellAllowed } from "./permissions.mjs";

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

export function findActiveRuns(root, env = process.env) {
  const artifacts = path.join(root, "artifacts");
  if (!existsSync(artifacts)) return [];
  const runs = [];
  for (const product of readdirSync(artifacts)) {
    const state = path.join(artifacts, product, "state");
    if (!existsSync(path.join(state, "lock.json"))) continue;
    try {
      const run = readJson(path.join(state, "run.json"));
      const permFile = path.join(state, "permissions.resolved.json");
      runs.push({
        root,
        product,
        runId: run.runId,
        mode: env.AUTHORIZATIONS_MODE === "readonly" ? "readonly" : run.mode === "full-run" ? "full-run" : "readonly",
        targetHost: hostOf(run.target?.url),
        ledgerFile: path.join(state, "ledger.jsonl"),
        permissions: existsSync(permFile) ? readJson(permFile) : null,
      });
    } catch {
      // A held lock with an unreadable run.json is treated as an active readonly run with no permissions.
      runs.push({ root, product, runId: null, mode: "readonly", targetHost: null, ledgerFile: null, permissions: null, broken: true });
    }
  }
  return runs;
}

function hostOf(u) {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const VERB = "(POST|PUT|PATCH|DELETE|MERGE)";
const HTTP_MUTATE = [
  new RegExp(`\\bcurl(\\.exe)?\\b[^|;&\\n]*(-X|--request)[\\s=]*['"]?${VERB}\\b`, "i"),
  /\bcurl(\.exe)?\b[^|;&\n]*\s(-d|--data(-\w+)?|--json|-F|--form|-T|--upload-file)\b/,
  new RegExp(`\\bwget\\b[^|;&\\n]*(--post-(data|file)|--body-(data|file)|--method[\\s=]*['"]?${VERB}\\b)`, "i"),
  new RegExp(`\\b(Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\\b[^|;&\\n]*-(Method\\s+['"]?${VERB}\\b|Body\\b|InFile\\b)`, "i"),
  new RegExp(`(method\\s*[:=]\\s*['"]${VERB}['"]|\\b(requests|httpx|axios|got|ky)\\.(post|put|patch|delete)\\b|\\burllib\\.request\\.Request\\b[^\\n]*data=)`, "i"),
];
const K6_LIVE = /\bk6(\.exe)?\s+(run|cloud)\b/i;
const DELETE_RE = /(-X|--request)[\s=]*['"]?DELETE\b|--method[\s=]*['"]?DELETE\b|-Method\s+['"]?Delete\b|method\s*[:=]\s*['"]DELETE['"]|\b(requests|httpx|axios|got|ky)\.delete\b/i;
// Playwright MCP tools that type, submit or run code. `click` stays allowed under read: navigation needs it.
const BROWSER_MUTATING = new Set(["type", "fill_form", "select_option", "file_upload", "drag", "drop", "press_key", "handle_dialog", "evaluate", "run_code_unsafe"]);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const deny = (rule, reason) => ({ allowed: false, rule, reason });
const ALLOW = { allowed: true };

function checkShell(cmd, run, row) {
  if (row && !shellAllowed(row, cmd)) return deny("shell", `shell is '${row.shell}' for this agent; command not in its allow-list`);
  const lt = row ? effectiveLiveTarget(row, run.mode) : null;
  const mutateOk = row ? lt.http === "mutate" : run.mode === "full-run";
  const loadOk = row ? lt.load === "run" : run.mode === "full-run";
  if (K6_LIVE.test(cmd) && !loadOk) return deny("k6-live", `live k6 needs load: run (mode ${run.mode}${row ? ", agent load: " + lt.load : ""})`);
  const isDelete = DELETE_RE.test(cmd);
  if ((isDelete || HTTP_MUTATE.some((r) => r.test(cmd))) && !mutateOk)
    return deny("http-mutate", `mutating HTTP needs http: mutate (mode ${run.mode}${row ? ", agent http: " + lt.http : ""})`);
  if (isDelete) {
    const owned = run.ledgerFile && run.runId ? live(run.ledgerFile, run.runId) : [];
    if (!owned.some((e) => new RegExp(`(?<![\\w-])${escapeRe(e.ref)}(?![\\w-])`).test(cmd)))
      return deny("delete-not-owned", "destructive request does not reference an entity the CURRENT run created (ledger.mjs list <product> --live)");
  }
  if (row && run.targetHost && lt.http === "none" && cmd.toLowerCase().includes(run.targetHost))
    return deny("http-none", "this agent has no HTTP access to the product under test");
  return ALLOW;
}

function evaluate(input, run) {
  const tool = String(input.tool_name ?? "");
  const ti = input.tool_input ?? {};
  const row = run.permissions?.agents?.[input.agent_type];
  if (run.broken) return /^(Bash|PowerShell)$/.test(tool) ? checkShell(String(ti.command ?? ""), run, null) : ALLOW;

  if (tool === "Agent") {
    if (row && !row.spawns.includes(ti.subagent_type)) return deny("spawn", `${input.agent_type} may only spawn [${row.spawns.join(", ")}]`);
    return ALLOW;
  }
  if (tool === "Bash" || tool === "PowerShell") return checkShell(String(ti.command ?? ""), run, row);
  if (tool === "WebFetch" || tool === "WebSearch") {
    if (!row) return ALLOW;
    const host = hostOf(ti.url);
    if (tool === "WebFetch" && host && host === run.targetHost)
      return atLeast(effectiveLiveTarget(row, run.mode).http, "read") ? ALLOW : deny("http-none", "this agent has no HTTP access to the product under test");
    return row.web_research === "allowed" ? ALLOW : deny("web-research", "web research is not allowed for this agent");
  }
  if (WRITE_TOOLS.has(tool)) {
    if (!row) return ALLOW;
    const abs = path.resolve(run.root, String(ti.file_path ?? ti.notebook_path ?? ""));
    const rel = path.relative(run.root, abs).replaceAll("\\", "/");
    if (rel.startsWith("..") || path.isAbsolute(rel)) return deny("fs-write", `writes outside the repo are not allowed (${abs})`);
    return canWrite(row, rel, run.permissions.variables ?? {}, { product: run.product, run_id: run.runId })
      ? ALLOW
      : deny("fs-write", `${rel} is outside this agent's filesystem.write allow-list`);
  }
  const m = /^mcp__.*playwright.*__browser_(\w+)$/.exec(tool);
  if (m) {
    const level = row ? effectiveLiveTarget(row, run.mode).browser : run.mode === "full-run" ? "mutate" : "read";
    if (level === "none") return deny("browser-none", "this agent has no browser access");
    if (level === "read" && BROWSER_MUTATING.has(m[1])) return deny("browser-read", `browser_${m[1]} can change data; this agent is read-only here (mode ${run.mode})`);
  }
  return ALLOW;
}

// -> { allowed, rule?, reason? }. With several active runs (different products): a write is allowed if ANY run's
// rules allow it (paths are product-specific); everything else must be allowed by EVERY active run.
export function checkTool(input, root, env = process.env) {
  const runs = findActiveRuns(root, env);
  if (!runs.length) {
    const tool = String(input.tool_name ?? "");
    if (tool === "Bash" || tool === "PowerShell")
      return checkShell(String(input.tool_input?.command ?? ""), { mode: "readonly", ledgerFile: null, runId: null, targetHost: null }, null);
    return ALLOW;
  }
  const verdicts = runs.map((r) => evaluate(input, r));
  if (WRITE_TOOLS.has(String(input.tool_name))) return verdicts.find((v) => v.allowed) ?? verdicts[0];
  return verdicts.find((v) => !v.allowed) ?? ALLOW;
}
