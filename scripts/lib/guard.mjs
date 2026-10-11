// Platform-neutral safety guard. Input: a canonical tool call (scripts/lib/tool-call.mjs, produced by a host adapter in
// scripts/hooks/hosts/) and the active runs. Output: { allowed, rule?, reason? }.
//
// Sources of truth (nothing else):
//   - active runs:  every artifacts/<product>/state/lock.json (one active run per product)
//   - mode:         that run's state/run.json `mode`, resolved once from the run-config at `run.mjs init`
//   - permissions:  that run's state/permissions.resolved.json (frozen copy of config/permissions.yaml)
//   - ownership:    that run's state/ledger.jsonl, entries of the CURRENT run only
//   - caller:       the call's `agent` (set by the adapter only from a trusted source) and `host`
// The env var AUTHORIZATIONS_MODE=readonly can only downgrade. No active run => readonly, no per-agent rules.
// Agents not listed in the permissions file ("unmanaged", e.g. a human's own session) get the mode rules only.
// full-run is honoured only on hosts that can identify the calling agent (scripts/lib/hosts.mjs); on any other host
// every call is evaluated as readonly.
//
// Dependency-free (imported by a PreToolUse hook on every guarded tool call).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { isMutatingBrowserTool } from "./browser-tools.mjs";
import { canIdentify, labelOf } from "./hosts.mjs";
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
// The liveness canary: an agent runs this before a run's stages; a working hook always blocks it (and the hook entry
// records which host/agent blocked it). If it ever executes, no guard intercepted it (scripts/run.mjs guard-check).
// Matched as any command of a compound line and by any path to run.mjs: agents often write `cd <repo> && node …`.
const CANARY = /(?:^\s*|[;&|(]\s*)node\s+(?:\S*\/)?scripts\/run\.mjs\s+guard-check\s+([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/;
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

function checkWrite(file, run, row) {
  const abs = path.resolve(run.root, file);
  const rel = path.relative(run.root, abs).replaceAll("\\", "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return deny("fs-write", `writes outside the repo are not allowed (${abs})`);
  return canWrite(row, rel, run.permissions.variables ?? {}, { product: run.product, run_id: run.runId })
    ? ALLOW
    : deny("fs-write", `${rel} is outside this agent's filesystem.write allow-list`);
}

function checkFetch(url, run, row) {
  const host = hostOf(url);
  if (host && host === run.targetHost)
    return atLeast(effectiveLiveTarget(row, run.mode).http, "read") ? ALLOW : deny("http-none", "this agent has no HTTP access to the product under test");
  return row.web_research === "allowed" ? ALLOW : deny("web-research", "web research is not allowed for this agent");
}

const firstDenied = (verdicts) => verdicts.find((v) => !v.allowed) ?? ALLOW;

function evaluateKind(call, run, row) {
  switch (call.kind) {
    case "spawn":
      return row && !row.spawns.includes(call.subagent) ? deny("spawn", `${call.agent} may only spawn [${row.spawns.join(", ")}]`) : ALLOW;
    case "shell":
      return checkShell(call.command ?? "", run, row);
    case "web_fetch":
      if (!row) return ALLOW;
      return call.urls.length ? firstDenied(call.urls.map((u) => checkFetch(u, run, row))) : checkFetch(undefined, run, row);
    case "web_search":
      return !row || row.web_research === "allowed" ? ALLOW : deny("web-research", "web research is not allowed for this agent");
    case "write":
      if (!row) return ALLOW;
      if (!call.paths.length) return deny("fs-write", `could not tell which file ${call.tool} writes; refusing for a managed agent`);
      return firstDenied(call.paths.map((f) => checkWrite(f, run, row)));
    case "browser": {
      const level = row ? effectiveLiveTarget(row, run.mode).browser : run.mode === "full-run" ? "mutate" : "read";
      if (level === "none") return deny("browser-none", "this agent has no browser access");
      if (level === "read" && isMutatingBrowserTool(call.browserAction))
        return deny("browser-read", `browser_${call.browserAction} can change data; this agent is read-only here (mode ${run.mode})`);
      return ALLOW;
    }
    case "unknown":
      return row ? deny("unmapped-tool", `'${call.tool}' is not a tool the guard knows on ${labelOf(call.host)}; add it to that host's adapter in scripts/hooks/hosts/`) : ALLOW;
    default: // read, ask, other
      return ALLOW;
  }
}

function evaluate(call, run) {
  if (run.broken) return call.kind === "shell" ? checkShell(call.command ?? "", run, null) : ALLOW;
  const row = call.agent ? run.permissions?.agents?.[call.agent] : undefined;
  const capped = run.mode === "full-run" && !canIdentify(call.host);
  const verdict = evaluateKind(call, capped ? { ...run, mode: "readonly" } : run, row);
  return capped && !verdict.allowed
    ? { ...verdict, reason: `${verdict.reason} [full-run is not honoured on ${labelOf(call.host)}: it cannot identify the calling agent]` }
    : verdict;
}

// -> { allowed, rule?, reason?, canary? }. With several active runs (different products): a write is allowed if ANY
// run's rules allow it (paths are product-specific); everything else must be allowed by EVERY active run.
export function checkTool(call, root, env = process.env) {
  const canary = call.kind === "shell" ? CANARY.exec(call.command ?? "") : null;
  if (canary)
    return { allowed: false, rule: "canary", reason: `guard is active on ${labelOf(call.host)} (caller: ${call.agent ?? "unidentified"}); this block is expected`, canary: { product: canary[1] } };
  const runs = findActiveRuns(root, env);
  if (!runs.length) return call.kind === "shell" ? checkShell(call.command ?? "", { mode: "readonly", ledgerFile: null, runId: null, targetHost: null }, null) : ALLOW;
  const verdicts = runs.map((r) => evaluate(call, r));
  if (call.kind === "write") return verdicts.find((v) => v.allowed) ?? verdicts[0];
  return firstDenied(verdicts);
}
