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
// Two rules hold for every call, in or out of a run, whoever calls: test case approval is human-only (humanOnly()), and
// so is the ledger sweep that deletes what ended runs left in the target (humanOnlySweep(), D-075). Both cover the atf
// CLI's forms: `atf approve`, `atf import … --approved` and `atf sweep` (D-087).
// During a run, no caller (named or not, in any mode) writes a managed foundation file directly (managedPath(), D-054),
// nor a file scripts/api-code.mjs generates (the API clients, types, schemas, registration and specs, D-056).
// Agents not listed in the permissions file ("unmanaged", e.g. a human's own session) get the mode rules only.
// On a host that cannot name the calling agent (scripts/lib/hosts.mjs), a full-run call gets what at least one of the
// run's agents may do (runCeiling, D-035): every call there comes from one of the run's agents.
// When the framework is installed apart from the workspace (D-085, scripts/lib/roots.mjs), no call writes under the
// framework root: in or out of a run, any caller and mode (frameworkWrite()). Only an installed framework (its real path
// inside node_modules, roots.mjs isInstalled) is read-only: a source checkout apart from the workspace (the monorepo's
// packages/core) stays editable under the other rules. In one directory, nothing changes.
// The workspace's atf/ (its marker, config overlays and ejected config, decision log, agent fragments) holds the client
// humans' own settings, which only a human changes (packaging §3.4, extending D-013): no framework agent (a name among
// the framework's agent sources, agents/<name>.md) writes under it, in or out of a run, in any mode, nor runs the atf
// CLI's `eject`; during a run, neither does a call its host can't attribute (D-035). A human's own session -- no agent
// on a host that names agents, or an agent type the framework doesn't ship -- stays allowed (workspaceSettingsWrite()).
// A printed command names the framework's scripts from the workspace (`node {fw}/scripts/...`, roots.mjs expandFw).
//
// Dependency-free (imported by a PreToolUse hook on every guarded tool call).

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { isInputBrowserTool, isMutatingBrowserTool, networkGuarded } from "./browser-tools.mjs";
import { shellWriteTargets } from "./decisions.mjs";
import { canIdentify, labelOf } from "./hosts.mjs";
import { live } from "./ledger.mjs";
import { atLeast, canWrite, effectiveLiveTarget, isManaged, normalizeWritePath, runCeiling, shellAllowed, shellSegments } from "./permissions.mjs";
import { expandFw, frameworkRel, frameworkRoot, isInstalled, sameDir } from "./roots.mjs";

const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

// Every state folder that can hold a run: a product's own state/ (the `default` environment) and each
// envs/<env>/state/ (D-081). -> [{product, environment, state}]
export function stateDirs(root) {
  const artifacts = path.join(root, "artifacts");
  if (!existsSync(artifacts)) return [];
  const out = [];
  for (const product of readdirSync(artifacts)) {
    out.push({ product, environment: "default", state: path.join(artifacts, product, "state") });
    const envs = path.join(artifacts, product, "envs");
    if (existsSync(envs)) for (const environment of readdirSync(envs)) out.push({ product, environment, state: path.join(envs, environment, "state") });
  }
  return out;
}

// framework: the framework root, whose config/mcp.yaml says whether the browser server runs the network guard.
export function findActiveRuns(root, env = process.env, framework = frameworkRoot) {
  const runs = [];
  for (const { product, environment, state } of stateDirs(root)) {
    if (!existsSync(path.join(state, "lock.json"))) continue;
    try {
      const run = readJson(path.join(state, "run.json"));
      const permFile = path.join(state, "permissions.resolved.json");
      runs.push({
        root,
        framework,
        product,
        environment,
        stateDir: state,
        runId: run.runId,
        mode: env.AUTHORIZATIONS_MODE === "readonly" ? "readonly" : run.mode === "full-run" ? "full-run" : "readonly",
        // The product's hosts: the target URL and its API hosts (D-045). A fetch to any of them touches the product.
        targetHosts: [...new Set([run.target?.url, ...(run.target?.api_urls ?? [])].map(hostOf).filter(Boolean))],
        ledgerFile: path.join(state, "ledger.jsonl"),
        permissions: existsSync(permFile) ? readJson(permFile) : null,
      });
    } catch {
      // A held lock with an unreadable run.json is treated as an active readonly run with no permissions.
      runs.push({ root, framework, product, environment, stateDir: state, runId: null, mode: "readonly", targetHosts: [], ledgerFile: null, permissions: null, broken: true });
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
const HUMAN_ONLY_REASON = "test case approval is human-only: a human edits testcases/approval.csv and runs `npx atf approve <product> <module>` (or `npx atf import <product> <module> --approved` for a file already approved) in their own terminal";
// Quotes, a backslash or cmd.exe's caret inside a word only split it for this match (`--appr''oved`, `appr\ove`,
// `appr^ove` reach the program whole), so they are dropped after the concatenations are joined: stricter only.
const WORD_SPLITTERS = /['"`]|\\(?=[a-z])|\^(?=[a-z])/gi;
// The former Makefile's human-only targets (V-3), still refused should a make of the client's own wrap them:
// `make approve`, and `make import … APPROVED=yes` (or APPROVED from the environment, which make reads too). Only an
// actual make invocation counts -- make as a command's program word (after a separator, `$(`, a backtick, env/sudo/npx or
// leading assignments) with an `approve` target or an `APPROVED=` assignment; or an `APPROVED=` assignment (inline or
// exported) before any make -- never prose that says "make" and "approve".
const MAKE = String.raw`\b(?:g|n|mingw32-)?make(?:\.exe)?\b`;
const makeRun = (starts) => String.raw`(?:^|[\n;&|(\x60${starts}])\s*(?:(?:npx|env|sudo|exec|command)\s+|\w+=\S*\s+)*(?:\S*[\\/])?${MAKE}`;
const APPROVED_SET = String.raw`\bAPPROVED\s*[:?+]*=`;
const humanOnlyMake = (starts) => new RegExp(`${makeRun(starts)}[^;&|\\n]*(?:\\sapprove\\b|${APPROVED_SET})|${APPROVED_SET}[\\s\\S]*${MAKE}`, "i");
const HUMAN_ONLY_MAKE = humanOnlyMake("");
// On a line with a word that runs a string (STRING_RUNNER below: `bash -c "make approve"`, `eval 'make approve'`), a
// quoted string can be a command, so an opening quote also starts one.
const HUMAN_ONLY_MAKE_RUN = humanOnlyMake(`'"`);
// The atf CLI's human-only commands (D-087): `atf approve`, `atf import … --approved` and `atf sweep`, matched like the
// make targets: atf as the end of a command's program word -- after any path (also one whose `\` the word-splitter pass
// dropped) and with a .mjs, .cmd, .ps1 or .exe suffix, after a separator, `$(`, a backtick, leading assignments,
// env/sudo/exec/command or a runner that starts it (npx, node, bun, pnpm, yarn, npm exec or run) -- with the verb or
// the flag later in that command. The CLI takes no alias, abbreviation or `--approved=<value>` (scripts/lib/cli.mjs),
// so these are the spellings it runs. On a line with a word that runs a string, its quotes are not read
// (quotedSeparatorsBlanked), so the rest of the line counts, separators included.
const ATF = String.raw`atf(?:\.mjs|\.cmd|\.ps1|\.exe)?(?![\w.\\/-])`;
const atfRun = (starts) => String.raw`(?:^|[\n;&|(\x60${starts}])\s*(?:(?:npx|env|sudo|exec|command|node|nodejs|bun|bunx|pnpm|yarn|npm\s+(?:exec|x|run|run-script))\s+(?:-\S+\s+)*|\w+=\S*\s+)*\S*${ATF}`;
const humanOnlyAtf = (starts, rest) => new RegExp(`${atfRun(starts)}${rest}\\s(?:approve|--approved)\\b`, "i");
const HUMAN_ONLY_ATF = humanOnlyAtf("", "[^;&|\\n]*");
// atf as a command's program anywhere before the line's last `\s<verb>`: the same match as `<program>[\s\S]*\s<verb>`
// without its backtracking, which took seconds on a 10k-character line of `;'atf` words (and a hook that slow can time
// out, which a host may take as no answer).
function atfThen(starts, verb) {
  const at = new RegExp(`\\s${verb}\\b`, "gi");
  const program = new RegExp(atfRun(starts), "i");
  return (cmd) => {
    const last = [...cmd.matchAll(at)].at(-1);
    return Boolean(last) && program.test(cmd.slice(0, last.index));
  };
}
const humanOnlyAtfRun = atfThen(`'"`, "(?:approve|--approved)");
const ATF_PROGRAM = new RegExp(atfRun(""), "i");
// A separator inside quotes is text, not a new command (`grep -n "a\|make approve" f`, `git commit -m 'x; make approve'`),
// so HUMAN_ONLY_MAKE reads the line with every `; & | ( ` and line break inside quotes blanked. Quotes count only where
// every shell reads them alike -- the allow-list's rules (shellSegments): no `$`, backtick or `\"` inside double quotes
// (so `"$(make approve)"` and a backtick substitution stay commands), no expansion, escape or unterminated quote outside
// them -- and only on a line without an unquoted glob or brace and without a word that can run a string (a shell, eval,
// an interpreter, ssh, git's --exec, ...), matched anywhere, prose included. Any other line keeps the quote-blind match.
const STRING_RUNNER = /\b(?:sh|bash|zsh|dash|ksh|ash|fish|csh|tcsh|busybox|cmd|pwsh|powershell|eval|exec|execdir|iex|invoke-expression|invoke-command|start-process|start-job|ssh|wsl|su|sudo|doas|runas|runuser|trap|watch|script|flock|expect|tmux|screen|at|batch|crontab|schtasks|parallel|xargs|alias|foreach|rebase|node|nodejs|nodemon|deno|bun|bunx|npx|npm|pnpm|yarn|python[\d.]*|py|perl|ruby|php|lua|tclsh|awk|gawk|sed|vim?|emacs|gdb|osascript|docker|podman|kubectl)\b/i;
function quotedSeparatorsBlanked(cmd) {
  if ([cmd, cmd.replace(WORD_SPLITTERS, "")].some((c) => STRING_RUNNER.test(c)) || !shellSegments(cmd.replace(/[<>]/g, " "))) return cmd;
  let q = null;
  let out = "";
  for (let c of cmd) {
    if (q) {
      if (c === q) q = null;
      else if (";&|(`\n\r".includes(c)) c = " ";
    } else if (c === "'" || c === '"') q = c;
    else if ("?*[{".includes(c)) return cmd;
    out += c;
  }
  return out;
}
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
// The line names testcases.mjs or runs the atf CLI, or a runner starts a program whose glob or expansion (`node $S …`)
// could be testcases.mjs.
const namesScript = (cmd, printf) => /testcases/i.test(cmd) || ATF_PROGRAM.test(cmd) ||
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
// The ledger sweep (D-075) deletes in the target outside any run, so no tool call may start it: a line that names the
// ledger script (or a make target, or runs the atf CLI, D-087) together with the sweep verb, read with quotes and word
// splitters dropped (stricter only). The script itself also refuses without an interactive terminal and the typed
// product slug.
const SWEEP_REASON = "the ledger sweep is human-only: a human runs `npx atf sweep <product>` in their own terminal, between runs";
const SWEEP_MAKE = new RegExp(`${makeRun("")}[^;&|\\n]*\\ssweep\\b`, "i");
// A line that runs the atf CLI with `verb` anywhere after it (a quoted string on a line with a word that runs one, too).
function atfVerb(verb) {
  const [any, run] = [atfThen("", verb), atfThen(`'"`, verb)];
  return (cmd) => any(cmd) || (STRING_RUNNER.test(cmd) && run(cmd));
}
const atfSweep = atfVerb("sweep");
// Each spelling a human-only match reads: concatenations joined, then also with the word splitters dropped (stricter).
const spellings = (command) => {
  const joined = String(command ?? "").replace(JOIN_CONCAT, "");
  return [joined, joined.replace(WORD_SPLITTERS, "")];
};
function humanOnlySweep(call) {
  if (call.kind !== "shell") return false;
  return spellings(call.command).some((cmd) => (/\bsweep\b/i.test(cmd) && /ledger/i.test(cmd)) || SWEEP_MAKE.test(cmd) || atfSweep(cmd));
}
function humanOnly(call) {
  if (call.kind === "shell") {
    const joined = String(call.command ?? "").replace(JOIN_CONCAT, "");
    const hit = (cmd) => humanOnlyCmd(cmd) || HUMAN_ONLY_FILES.test(cmd) || expandedHumanOnly(cmd);
    const makeHit = (cmd) => HUMAN_ONLY_MAKE.test(cmd) || HUMAN_ONLY_ATF.test(cmd) || (STRING_RUNNER.test(cmd) && (HUMAN_ONLY_MAKE_RUN.test(cmd) || humanOnlyAtfRun(cmd)));
    // a decoded form also counts the bare `approved`, but only one the decoding produced (a payload, not the prose)
    const scan = (line, test, verbs) => [line, line.replace(WORD_SPLITTERS, "")].some((cmd) => test(cmd) ||
      decodedForms(cmd).some((d) => test(d) || (verbs && decodedVerbs(d) > decodedVerbs(cmd) && namesScript(d, /\bprintf\b/i.test(d)))));
    return scan(joined, hit, true) || scan(quotedSeparatorsBlanked(joined), makeHit, false);
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
// The run values a glob expands with: the product, the run id and, since state lives per environment (D-081), the
// run's own state folder (the permissions file's `${state}` variable defaults to the `default` environment's).
const runValues = (run) => ({ product: run.product, run_id: run.runId, ...(run.stateDir ? { state: path.relative(run.root, run.stateDir).replaceAll("\\", "/") } : {}) });
function managedPath(file, run) {
  const values = runValues(run);
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

// D-085: the spelling of a framework file the call would write, else null; only when the framework root is not the
// workspace root and the framework is installed (isInstalled: its real path inside node_modules; a source checkout
// apart from the workspace stays editable, and isInstalled fails closed). A written path and every shell write target the hook can read (scripts/lib/decisions.mjs
// shellWriteTargets: redirects, tee, cp, mv, rm, sed -i, git restore, ...; a relative one from the workspace and from
// every directory the line changes into) are compared as written (a device or UNC prefix and `..` resolved; case,
// separators, a trailing dot or space and a stream suffix folded) and as the file system resolves them (symlinks,
// junctions, 8.3 names), with the framework root both as given and as resolved. Fails closed: a write tool whose
// target can't be told is refused. A write the hook can't read (`node -e`, a package manager) is the known limit of
// D-031's shell heuristic.
const UNKNOWN_TARGET = Symbol("unknown write target");
const CD_DIRS = /(?:^|[;&|(]\s*)(?:cd|pushd|Set-Location)(?:\s+\/d|\s+-(?:Literal)?Path)?\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|'"()]+))/gi;
function frameworkWrite(call, root, framework) {
  if (!framework || sameDir(root, framework) || !isInstalled(framework)) return null;
  return writeUnder(call, root, framework);
}
// The workspace-relative spelling of the first file the call writes under `dir`, else null; UNKNOWN_TARGET for a write
// tool whose target can't be told. Compared as frameworkWrite() describes.
function writeUnder(call, root, dir) {
  if (call.kind === "write" && !(call.paths ?? []).length) return UNKNOWN_TARGET;
  const command = String(call.command ?? "");
  const files = call.kind === "write" ? call.paths : call.kind === "shell" ? shellWriteTargets(command) : [];
  const bases = [root, ...(call.kind === "shell" ? [...command.matchAll(CD_DIRS)].map((m) => path.resolve(root, devicePath(m[1] ?? m[2] ?? m[3]))) : [])];
  const dirs = [...new Set([path.resolve(dir), realOf(path.resolve(dir))].filter(Boolean).map(normalizeWritePath))];
  for (const f of files)
    for (const base of bases) {
      const abs = path.resolve(base, devicePath(f));
      // a UNC path to another host is never inside `dir`; don't touch the network to resolve it
      const real = /^[\\/]{2}/.test(abs) ? null : realOf(abs);
      for (const target of [abs, real].filter(Boolean)) {
        const t = normalizeWritePath(target);
        if (dirs.some((d) => t === d || t.startsWith(`${d}/`))) return path.relative(root, abs).replaceAll("\\", "/") || String(f);
      }
    }
  return null;
}

// The workspace's own settings (packaging §3.4, the user's decision 2026-10-26, extending D-013 from the framework's
// config/ to the client's overrides): atf/ holds the marker atf.json, the config overlays atf/<file>.yaml, the ejected
// config atf/config/<file>.yaml, the client's decision log and agent fragments, and only a human changes them.
// -> what the call would write there: its workspace-relative path, ATF_EJECT for a line that runs the atf CLI's eject
// (it writes atf/config/ in process, where no write target shows; matched like `atf sweep`), UNKNOWN_TARGET for a write
// tool whose target can't be told, else null. Paths compare as in frameworkWrite() (case, separators, `..`, device and
// UNC prefixes, symlinks into atf/), so a look-alike folder (config/atf/, artifacts/<product>/atf/) is not atf/.
const atfEject = atfVerb("eject");
const ATF_EJECT = Symbol("atf eject");
function workspaceSettingsWrite(call, root) {
  if (call.kind === "shell" && spellings(call.command).some(atfEject)) return ATF_EJECT;
  return writeUnder(call, root, path.join(root, "atf"));
}
// The framework's agents: the names of its agent sources, agents/<name>.md (the fragments in agents/_shared/ are no
// agent). null when they can't be read, and then every named caller counts as one (fails closed).
function frameworkAgents(framework) {
  try {
    return new Set(readdirSync(path.join(framework, "agents"), { withFileTypes: true }).filter((d) => !d.isDirectory() && d.name.endsWith(".md")).map((d) => d.name.slice(0, -3)));
  } catch {
    return null;
  }
}
// Whom the settings rule binds: a framework agent, in or out of a run, in any mode; during a run (any mode), also a
// call whose host can't name its caller, since every call there comes from one of the run's agents (D-035). A human's
// own session -- no agent on a host that names agents, or an agent type the framework doesn't ship (a host's built-in
// helper) -- is not bound; the decision hook still asks before it edits a governed file.
function bindsSettings(call, framework, inRun) {
  if (!call.agent) return inRun && !canIdentify(call.host);
  const roster = frameworkAgents(framework);
  return !roster || roster.has(call.agent);
}
const SETTINGS_REASON = "atf/ holds this workspace's own settings (its marker, config overlays and ejected config, decision log and agent fragments), which only a human changes (D-013, packaging §3.4): report the change it needs instead";

function checkWrite(file, run, row) {
  const abs = path.resolve(run.root, file);
  const rel = path.relative(run.root, abs).replaceAll("\\", "/");
  if (rel.startsWith("..") || path.isAbsolute(rel)) return deny("fs-write", `writes outside the repo are not allowed (${abs})`);
  return canWrite(row, rel, run.permissions.variables ?? {}, runValues(run))
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
      // readonly input (D-076): typing, selecting and key presses change nothing while the browser server's init page
      // aborts every write to the product; without it they are mutating like the rest. The effective mcp.yaml says so:
      // the framework's, or the run's workspace's override of it (atf/, scripts/lib/config.mjs)
      if (level === "read" && isMutatingBrowserTool(call.browserAction) && !(isInputBrowserTool(call.browserAction) && networkGuarded(run.framework, run.root)))
        return deny("browser-read", `browser_${call.browserAction} can change data; this agent is read-only here (mode ${run.mode})${isInputBrowserTool(call.browserAction) ? ", and the browser server does not run the framework's network guard (--init-page scripts/browser/init-page.cjs in the effective mcp.yaml: config/mcp.yaml, or the workspace's atf/mcp.yaml overlay or ejected atf/config/mcp.yaml)" : ""}`);
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
// root: the workspace root; framework: the framework root (scripts/lib/roots.mjs; the same directory in this repo).
export function checkTool(call, root, env = process.env, { framework = frameworkRoot } = {}) {
  // a printed command: the framework's scripts as the workspace runs them
  const fw = (text) => expandFw(text, frameworkRel(root, framework));
  const canary = call.kind === "shell" ? CANARY.exec(call.command ?? "") : null;
  if (canary)
    return { allowed: false, rule: "canary", reason: `guard is active on ${labelOf(call.host)} (caller: ${call.agent ?? "unidentified"}); this block is expected`, canary: { product: canary[1] } };
  if (humanOnly(call)) return deny("human-only", fw(HUMAN_ONLY_REASON));
  if (humanOnlySweep(call)) return deny("human-only", fw(SWEEP_REASON));
  const fwFile = frameworkWrite(call, root, framework);
  if (fwFile === UNKNOWN_TARGET) return deny("framework-readonly", `could not tell which file ${call.tool} writes, and the framework (${framework}) is installed read-only (D-085); refusing`);
  if (fwFile)
    return deny("framework-readonly", `${fwFile} is part of the installed framework (${framework}), which no agent changes (D-085): change the workspace's own files instead, or report it (${fw("node {fw}/scripts/framework-issues.mjs add")})`);
  const runs = findActiveRuns(root, env, framework);
  const settings = bindsSettings(call, framework, runs.length > 0) ? workspaceSettingsWrite(call, root) : null;
  if (settings && settings !== UNKNOWN_TARGET) return deny("workspace-settings", `${settings === ATF_EJECT ? "`atf eject` writes atf/config/" : `${settings} is under atf/`}; ${SETTINGS_REASON}`);
  // a write tool whose target can't be told fails closed: refused by the run's own rules first (fs-write), else here
  const settingsUnknown = (verdict) =>
    settings === UNKNOWN_TARGET && verdict.allowed ? deny("workspace-settings", `could not tell which file ${call.tool} writes; refusing, since no agent writes under atf/: ${SETTINGS_REASON}`) : verdict;
  if (!runs.length) return call.kind === "shell" ? checkShell(call.command ?? "", { mode: "readonly", ledgerFile: null, runId: null, targetHosts: [] }, null) : settingsUnknown(ALLOW);
  // Managed foundation files (D-054) are rendered by scripts/foundation.mjs through node, never by a hooked write: no
  // caller writes one directly, named or not, in any mode, whichever active run's product it belongs to.
  if (call.kind === "write")
    for (const r of runs) {
      const managed = r.permissions ? (call.paths ?? []).map((f) => managedPath(f, r)).find(Boolean) : null;
      if (managed)
        return deny(
          "managed-file",
          fw(/\/fixtures\/(ui|api)\/index\.ts$|\/fixtures\/ui\/pages\//i.test(`/${managed}`)
            ? `${managed} is generated from the module registrations (D-056): run the module's build (ui-code.mjs or api-code.mjs), never edit it`
            : /\/(clients|tests\/api|config\/api\/schemas|fixtures\/api\/clients)\//i.test(`/${managed}`)
              ? `${managed} is generated by {fw}/scripts/api-code.mjs from the endpoint catalogue and the API plan (D-056): change the client or tests overlay, or a slot of helpers/api/<module>.payloads.ts or .glue.ts, and run api-code.mjs build`
              : /\/k6\/workload(-coverage|-registry)?\.json$/i.test(`/${managed}`)
                ? `${managed} is written by {fw}/scripts/workload.mjs (D-057): change k6/workload-overlay.json and run workload.mjs build, then check`
                : /\/k6\/(code-plan\.json|parked\.json|legacy\/)|^\/k6-tests\/[^/]+\/scripts\//i.test(`/${managed}`)
                  ? `${managed} is generated by {fw}/scripts/k6-code.mjs from the verified workload (D-057): write only the slots of k6-tests/<product>/scripts/slots/<module>.js and run k6-code.mjs build, then check`
                  : `${managed} is rendered by {fw}/scripts/foundation.mjs from {fw}/templates/: change the side's overlay (artifacts/<product>/foundation/) and run foundation.mjs render`),
        );
    }
  const verdicts = runs.map((r) => evaluate(call, r));
  if (call.kind === "write") return settingsUnknown(verdicts.find((v) => v.allowed) ?? verdicts[0]);
  return firstDenied(verdicts);
}
