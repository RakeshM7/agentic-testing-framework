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
// One rule holds for every call, in or out of a run, whoever calls: test case approval is human-only (humanOnly()).
// During a run, no caller (named or not, in any mode) writes a managed foundation file directly (managedPath(), D-054),
// nor a file scripts/api-code.mjs generates (the API clients, types, schemas, registration and specs, D-056).
// Agents not listed in the permissions file ("unmanaged", e.g. a human's own session) get the mode rules only.
// On a host that cannot name the calling agent (scripts/lib/hosts.mjs), a full-run call gets what at least one of the
// run's agents may do (runCeiling, D-035): every call there comes from one of the run's agents.
//
// Dependency-free (imported by a PreToolUse hook on every guarded tool call).

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { isMutatingBrowserTool } from "./browser-tools.mjs";
import { canIdentify, labelOf } from "./hosts.mjs";
import { live } from "./ledger.mjs";
import { atLeast, canWrite, effectiveLiveTarget, isManaged, runCeiling, shellAllowed } from "./permissions.mjs";

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
        // The product's hosts: the target URL and its API hosts (D-045). A fetch to any of them touches the product.
        targetHosts: [...new Set([run.target?.url, ...(run.target?.api_urls ?? [])].map(hostOf).filter(Boolean))],
        ledgerFile: path.join(state, "ledger.jsonl"),
        permissions: existsSync(permFile) ? readJson(permFile) : null,
      });
    } catch {
      // A held lock with an unreadable run.json is treated as an active readonly run with no permissions.
      runs.push({ root, product, runId: null, mode: "readonly", targetHosts: [], ledgerFile: null, permissions: null, broken: true });
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
// Human-only (the user's decision, 2026-10-17): a test case is automated only once a human approves it. Every tool call
// the hook sees -- any host and mode, identified caller or not, inside or outside a run -- is denied when it runs
// `testcases.mjs approve` (also chained, through the lib, or with the names split by string concatenation) or touches
// the approval sheet and its record (approval.csv, approvals.json, their 8.3 short names, anything named approv* in a
// testcases folder). A human edits the sheet and runs the command in their own terminal. Matching code text can't be
// complete (an in-process import can hide any name), so this is defence in depth: `approve` itself also insists on an
// interactive terminal and a typed confirmation (scripts/lib/testcases.mjs).
// Known limit (accepted, recorded in G3's decision): an agent with `shell: project` can still write approvals.json
// through code this match can't read -- `node -e` with String.fromCharCode, template literals, base64 or eval, or a
// shell glob such as appro?als.json. Restricted agents can't: their allow-list never vouches for such a line.
// `testcases.mjs import --approved` (selectable steps, decision 10) records approvals too: the `--approved` flag and the
// lib's importCases are matched like `approve`. The bare word `approved` is plain prose and file names
// (`data/approved-cases.feature`, `--error "case not approved"`), so it counts only where a decoded payload (printf
// escapes, base64) produced it.
const JOIN_CONCAT = /(['"`])\s*\+\s*(['"`])/g;
const HUMAN_ONLY_VERB = /(?<![\w-])--approved\b|\b(?:approve|importCases)\b/i;
const DECODED_VERB = /\b(?:approve|approved|importCases)\b/gi;
const humanOnlyCmd = (cmd) => /testcases/i.test(cmd) && HUMAN_ONLY_VERB.test(cmd);
const HUMAN_ONLY_FILES = /approvals?\.(csv|json)|approv~\d|testcases[\\/]+approv/i;
const HUMAN_ONLY_PATH = /(^|[\\/])(testcases[\\/]+approv[^\\/]*|approvals?\.(csv|json)|approv~\d[^\\/]*)$/i;
const HUMAN_ONLY_REASON = "test case approval is human-only: a human edits testcases/approval.csv and runs `node scripts/testcases.mjs approve` (or `import ... --approved` for a file already approved) in their own terminal";
// Quotes, a backslash or cmd.exe's caret inside a word only split it for this match (`--appr''oved`, `appr\ove`,
// `appr^ove` reach the program whole), so they are dropped after the concatenations are joined: stricter only.
const WORD_SPLITTERS = /['"`]|\\(?=[a-z])|\^(?=[a-z])/gi;
// The Makefile's human-only targets (V-3): `make approve`, and `make import … APPROVED=yes` (or APPROVED from the
// environment, which make reads too). Only an actual make invocation counts -- make as a command's program word (after
// a separator, `$(`, a backtick, env/sudo/npx or leading assignments) with an `approve` target or an `APPROVED=`
// assignment; or an `APPROVED=` assignment (inline or exported) before any make -- never prose that says "make" and
// "approve".
const MAKE = String.raw`\b(?:g|n|mingw32-)?make(?:\.exe)?\b`;
const MAKE_RUN = String.raw`(?:^|[\n;&|(\x60])\s*(?:(?:npx|env|sudo|exec|command)\s+|\w+=\S*\s+)*(?:\S*[\\/])?${MAKE}`;
const APPROVED_SET = String.raw`\bAPPROVED\s*[:?+]*=`;
const HUMAN_ONLY_MAKE = new RegExp(`${MAKE_RUN}[^;&|\\n]*(?:\\sapprove\\b|${APPROVED_SET})|${APPROVED_SET}[\\s\\S]*${MAKE}`, "i");
// A word written with shell globs or expansions (`testc?ses.mjs`, `test[c]ases`, `--appro${x}ved`, `$(printf …)`,
// backticks) reaches the program as whatever the shell makes of it, so it is read as the glob it is: an expansion
// stands for any text, `?` and a `[...]` class for one character (and, on a printf line, a `%s`-style directive for any
// text). A line is denied when its script (testcases.mjs, or a glob or expansion that a runner -- node, xargs, npx, bun
// -- starts as its program) and its verb or flag (approve, --approved, importCases) can both be what the human-only
// command needs, one of them through such a word. A glob word that no runner starts (`grep -n x scripts/*.mjs`) is a
// file argument, not the script. Plain non-approving testcases.mjs commands keep no such word and stay allowed.
const GLOBBY = /[$`?*[\]]/;
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function globRegex(word, printf) {
  let t = word.replace(/['"]/g, "").replace(/\$\{[^}]*\}?|\$\([^)]*\)?|`[^`]*`?|\$\w*/g, "\u0001");
  if (printf) t = t.replace(/%[-#0 +.\d]*[a-z]/gi, "\u0001");
  t = t.replace(/\[[^\]]*\]/g, "\u0002").replace(/\?/g, "\u0002").replace(/[*[\]]/g, "\u0001");
  const src = [...t].map((ch) => (ch === "\u0001" ? "[\\s\\S]*" : ch === "\u0002" ? "." : reEscape(ch))).join("");
  return new RegExp(`^${src}$`, "i");
}
const VERBS = ["approve", "approved", "--approved", "importCases"];
// A word that is all expansion (`${slug}`, `` `code` ``, `$(…)`) is how code and prose quote things: it counts only
// through the decoded forms below. A word read as a glob keeps at least three characters of its own.
const literalOf = (word, printf) => {
  const t = word.replace(/['"]/g, "").replace(/\$\{[^}]*\}?|\$\([^)]*\)?|`[^`]*`?|\$\w*/g, "");
  return (printf ? t.replace(/%[-#0 +.\d]*[a-z]/gi, "") : t).replace(/\[[^\]]*\]|[?*[\]]/g, "");
};
// The program word a runner starts, after its options: `node $S`, `node scripts/test*.mjs`, `xargs node …`.
const RUNNER_PROGRAM = /\b(?:node(?:\.exe)?|xargs|npx|bun)\s+(?:-\S+\s+)*["']?((?:\$\([^)]*\)|\$\{[^}]*\}|`[^`]*`|[^\s"';|&])+)/gi;
const globPrograms = (cmd) => [...cmd.matchAll(RUNNER_PROGRAM)].map((m) => m[1]).filter((w) => GLOBBY.test(w));
// The line names testcases.mjs, or a runner starts a program whose glob or expansion (`node $S …`) could be it.
const namesScript = (cmd, printf) => /testcases/i.test(cmd) ||
  globPrograms(cmd).some((w) => [w, w.split(/[\\/]/).pop()].some((p) => ["testcases.mjs", "testcases"].some((s) => globRegex(p, printf).test(s))));
function expandedHumanOnly(cmd) {
  const printf = /\bprintf\b/i.test(cmd);
  const words = cmd.split(/[\s;|&<>]+/).filter((w) => (GLOBBY.test(w) || (printf && /%[-#0 +.\d]*[a-z]/i.test(w))) && literalOf(w, printf).length >= 3);
  if (!words.length && !globPrograms(cmd).length) return false;
  const verb = HUMAN_ONLY_VERB.test(cmd) || words.some((w) => VERBS.some((v) => globRegex(w, printf).test(v)));
  return verb && namesScript(cmd, printf);
}
// printf \x / octal escapes and base64 words, decoded where it can be seen (`$(echo YXBwcm92ZWQ= | base64 -d)`).
function decodedForms(cmd) {
  const out = [];
  const esc = cmd.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  if (esc !== cmd) out.push(esc);
  for (const w of cmd.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? []) {
    const d = Buffer.from(w, "base64").toString("utf8");
    // on a line of its own, so a decoded `make approve` starts a command like a piped `| sh` would run it
    if (/^[\x20-\x7e\t\r\n]+$/.test(d)) out.push(`${cmd}\n${d}`);
  }
  return out;
}
const decodedVerbs = (s) => s.match(DECODED_VERB)?.length ?? 0;
function humanOnly(call) {
  if (call.kind === "shell") {
    const joined = String(call.command ?? "").replace(JOIN_CONCAT, "");
    const hit = (cmd) => humanOnlyCmd(cmd) || HUMAN_ONLY_FILES.test(cmd) || HUMAN_ONLY_MAKE.test(cmd) || expandedHumanOnly(cmd);
    // a decoded form also counts the bare `approved`, but only one the decoding produced (a payload, not the prose)
    return [joined, joined.replace(WORD_SPLITTERS, "")].some((cmd) => hit(cmd) ||
      decodedForms(cmd).some((d) => hit(d) || (decodedVerbs(d) > decodedVerbs(cmd) && namesScript(d, /\bprintf\b/i.test(d)))));
  }
  return call.kind === "write" && call.paths.some((p) => HUMAN_ONLY_PATH.test(String(p)));
}

const deny = (rule, reason) => ({ allowed: false, rule, reason });
const ALLOW = { allowed: true };

// A leading change into the repo's own root (`cd <root> &&`, `cd /d <root> &&`, `Set-Location <root>;`) does not count
// against a restricted agent's allow-list: agents add it when their terminal opened elsewhere (D-041). Only an absolute
// path equal to the run's root is stripped, once; the HTTP/load/delete checks still see the whole command.
const CD_PREFIX = /^\s*(?:cd(?:\s+\/d)?|Set-Location(?:\s+-(?:Literal)?Path)?)\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|'"]+))\s*(?:&&|;)\s*/i;
const samePath = (a, b) => {
  const norm = (p) => p.replaceAll("\\", "/").replace(/^\/([a-z])\//i, "$1:/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
};
function withoutRootCd(cmd, root) {
  const m = root ? CD_PREFIX.exec(cmd) : null;
  const dir = m && (m[1] ?? m[2] ?? m[3]);
  return dir && /^([a-z]:[\\/]|\/)/i.test(dir) && samePath(dir, root) ? cmd.slice(m[0].length) : cmd;
}

function checkShell(cmd, run, row) {
  if (row && !shellAllowed(row, withoutRootCd(cmd, run.root)))
    return deny("shell", `shell is '${row.shell}' for this agent; command not in its allow-list`);
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
  if (row && lt.http === "none" && run.targetHosts.some((h) => cmd.toLowerCase().includes(h)))
    return deny("http-none", "this agent has no HTTP access to the product under test");
  return ALLOW;
}

// Stricter only (D-054): the repo-relative path of a managed foundation file the call would write, else null.
// The path is tested as written and as the file system resolves it, so neither a device prefix (`\\?\C:\…`), a UNC
// path to this machine (`\\localhost\C$\…`, `\\?\UNC\…`), a directory short name nor a junction or symlink inside a
// writable folder (helpers/ui/link -> fixtures/ui) reaches a managed file. Resolution only adds candidates: when it
// fails, the string check still applies.
const LOCAL_HOSTS = () => new Set(["localhost", "127.0.0.1", "[::1]", "::1", ".", "?", hostname().toLowerCase()]);
function devicePath(p) {
  let s = String(p);
  if (/^[\\/]{2}[?.][\\/]unc[\\/]/i.test(s)) s = `\\\\${s.slice(8)}`; // \\?\UNC\host\share\… -> \\host\share\…
  else if (/^[\\/]{2}[?.][\\/]/.test(s)) s = s.slice(4); // \\?\C:\… -> C:\…
  const unc = /^[\\/]{2}([^\\/]+)[\\/]([a-z])\$(?:[\\/](.*))?$/i.exec(s); // \\localhost\C$\… -> C:\…
  if (unc && LOCAL_HOSTS().has(unc[1].toLowerCase())) s = `${unc[2]}:\\${unc[3] ?? ""}`;
  return s;
}
function realOf(abs) {
  const rest = [];
  let dir = abs;
  try {
    while (!existsSync(dir)) {
      const up = path.dirname(dir);
      if (up === dir) return null;
      rest.unshift(path.basename(dir));
      dir = up;
    }
    return path.join(realpathSync.native(dir), ...rest);
  } catch {
    return null;
  }
}
function managedPath(file, run) {
  const values = { product: run.product, run_id: run.runId };
  const roots = [...new Set([run.root, realOf(run.root)].filter(Boolean))];
  const abs = path.resolve(run.root, devicePath(file));
  // a UNC path to another host is never inside the repo; don't touch the network to resolve it
  const real = /^[\\/]{2}/.test(abs) ? null : realOf(abs);
  for (const target of [...new Set([abs, real].filter(Boolean))])
    for (const root of roots) {
      const rel = path.relative(root, target).replaceAll("\\", "/");
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      if (isManaged(run.permissions, rel, values)) return rel;
    }
  return null;
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
  if (host && run.targetHosts.includes(host))
    return atLeast(effectiveLiveTarget(row, run.mode).http, "read") ? ALLOW : deny("http-none", "this agent has no HTTP access to the product under test");
  return row.web_research === "allowed" ? ALLOW : deny("web-research", "web research is not allowed for this agent");
}

const firstDenied = (verdicts) => verdicts.find((v) => !v.allowed) ?? ALLOW;

function evaluateKind(call, run, row) {
  switch (call.kind) {
    case "spawn":
      return row && !row.spawns.includes(call.subagent) ? deny("spawn", `${call.agent ?? "this caller"} may only spawn [${row.spawns.join(", ")}]`) : ALLOW;
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
  if (call.agent || run.mode !== "full-run" || canIdentify(call.host)) return evaluateKind(call, run, call.agent ? run.permissions?.agents?.[call.agent] : undefined);
  // full-run on a host that cannot name the caller: the run's combined permissions; readonly if there are none to combine.
  const ceiling = runCeiling(run.permissions);
  const verdict = evaluateKind(call, ceiling ? run : { ...run, mode: "readonly" }, ceiling);
  const why = ceiling ? "so it allows what at least one of this run's agents may do" : "and this run has no permissions to combine, so it is readonly here";
  return verdict.allowed ? verdict : { ...verdict, reason: `${verdict.reason} [${labelOf(call.host)} cannot tell the guard which agent is calling, ${why}]` };
}

// -> { allowed, rule?, reason?, canary? }. With several active runs (different products): a write is allowed if ANY
// run's rules allow it (paths are product-specific); everything else must be allowed by EVERY active run.
export function checkTool(call, root, env = process.env) {
  const canary = call.kind === "shell" ? CANARY.exec(call.command ?? "") : null;
  if (canary)
    return { allowed: false, rule: "canary", reason: `guard is active on ${labelOf(call.host)} (caller: ${call.agent ?? "unidentified"}); this block is expected`, canary: { product: canary[1] } };
  if (humanOnly(call)) return deny("human-only", HUMAN_ONLY_REASON);
  const runs = findActiveRuns(root, env);
  if (!runs.length) return call.kind === "shell" ? checkShell(call.command ?? "", { mode: "readonly", ledgerFile: null, runId: null, targetHosts: [] }, null) : ALLOW;
  // Managed foundation files (D-054) are rendered by scripts/foundation.mjs through node, never by a hooked write: no
  // caller writes one directly, named or not, in any mode, whichever active run's product it belongs to.
  if (call.kind === "write")
    for (const r of runs) {
      const managed = r.permissions ? (call.paths ?? []).map((f) => managedPath(f, r)).find(Boolean) : null;
      if (managed)
        return deny(
          "managed-file",
          /\/fixtures\/(ui|api)\/index\.ts$|\/fixtures\/ui\/pages\//i.test(`/${managed}`)
            ? `${managed} is generated from the module registrations (D-056): run the module's build (ui-code.mjs or api-code.mjs), never edit it`
            : /\/(clients|tests\/api|config\/api\/schemas|fixtures\/api\/clients)\//i.test(`/${managed}`)
              ? `${managed} is generated by scripts/api-code.mjs from the endpoint catalogue and the API plan (D-056): change the client or tests overlay, or a slot of helpers/api/<module>.payloads.ts or .glue.ts, and run api-code.mjs build`
              : /\/k6\/workload(-coverage|-registry)?\.json$/i.test(`/${managed}`)
                ? `${managed} is written by scripts/workload.mjs (D-057): change k6/workload-overlay.json and run workload.mjs build, then check`
                : /\/k6\/(code-plan\.json|parked\.json|legacy\/)|^\/k6-tests\/[^/]+\/scripts\//i.test(`/${managed}`)
                  ? `${managed} is generated by scripts/k6-code.mjs from the verified workload (D-057): write only the slots of k6-tests/<product>/scripts/slots/<module>.js and run k6-code.mjs build, then check`
                  : `${managed} is rendered by scripts/foundation.mjs from templates/: change the side's overlay (artifacts/<product>/foundation/) and run foundation.mjs render`,
        );
    }
  const verdicts = runs.map((r) => evaluate(call, r));
  if (call.kind === "write") return verdicts.find((v) => v.allowed) ?? verdicts[0];
  return firstDenied(verdicts);
}
