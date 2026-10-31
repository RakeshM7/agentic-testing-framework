// How the extension runs atf (P-12): the installed @testagentic/atf's own commands and scripts, nothing of its own.
// Everything happens inside VS Code (user, 2026-10-29): no plain terminal hand-offs.
//
//   runJson(args, opts)        a child node, no shell, on the framework's bin/atf.mjs (or `script`, or an `eval`
//                              module), whose stdout is JSON: parsed, or a clear error. A timeout kills it. Every call is
//                              logged to the `atf` output channel: the command, exit code, time and stderr, never stdout
//                              (it can be large; nothing the scripts print is a secret, but the log is not a data dump).
//   runStreaming(args, opts)   a child node, no shell, on bin/atf.mjs (or `script`), whose output is the human's to read:
//                              every line goes to the `atf` output channel and to opts.onLine as it comes (a progress
//                              message follows it), and the exit code is the answer. No timeout (a login waits on the
//                              human); a cancelled token kills the process tree instead. Every command that needs no
//                              typing runs this way: config, sync, check, doctor, validate, init, the report's render.
//   confirmedRun(action, t, o) a human-only command (approve, sweep) the human confirmed in the extension's dialog by
//                              typing the slug: it writes the one-time confirmation file the framework defines for that
//                              action (scripts/lib/confirm.mjs), exclusively, then runs the script with --confirm-file
//                              through runStreaming, and deletes the file afterwards whatever happened (the script
//                              deletes it first when it reads it; a script that stopped before reading it leaves it).
//   runNpm(tool, args, opts)   npm or npx itself (D-107), for the two things that happen before the framework is
//                              installed: `npx --yes @testagentic/atf@<the extension's own version> init <folder>`
//                              (Create new project…) and `npm install` (Install the framework, in a cloned project).
//                              Nothing else: npmCommandProblem() refuses every other npm or npx command, so the only
//                              framework the extension ever runs that is not installed is the registry's copy pinned to
//                              its own version. Streamed, cancelled and killed exactly as runStreaming. npm is a .cmd on
//                              Windows, which Node runs only through a shell since CVE-2024-27980, so there the line is
//                              built here, quoted for cmd.exe (quoteNpmCmd), and an argument that can't be passed
//                              safely is refused; elsewhere it is an argument array with no shell. An inherited
//                              allow-scripts setting is left out of its environment (npmEnv: npm 12 refuses it there).
//   runInTerminal(args, opts)  an agent session only (run, resume, interview and the stage shortcuts): a VS Code
//                              terminal running `npx --no atf <args>`, shown as a tab in the editor area when
//                              opts.location says so. The agent CLI (claude, copilot) is an interactive program the
//                              human types into, so it needs a terminal; nothing else gets one. The arguments are quoted
//                              for that terminal's shell (POSIX shells, PowerShell, cmd.exe); one that can't be passed
//                              safely is refused, never mangled. `--no` stops npx from fetching some other public
//                              package named `atf` when the framework is not installed.
//
// The human-only rule. approve, sweep, `import --approved`, eject, migrate and issues (and the scripts behind them) are
// refused by runJson and runStreaming before anything is spawned, UNLESS the command carries `--confirm-file <path>`
// naming a file confirmedRun itself just wrote for exactly this command (`confirmed`): so the only way the extension
// runs one is the typed-slug dialog. The guard refuses all of them to agents (scripts/lib/guard.mjs), and refuses AI
// tool calls that write the confirmation files or name them; the extension's processes are the human's, not tool calls.
// A sweep's --dry-run sends nothing and needs no confirmation (the script refuses it together with --confirm-file), so
// it runs in the background like any read. init is not human-only here: it asks nothing and writes only the workspace
// files in the folder the human picked (the guard still refuses it to agents).
//
// The registry token (D-107). The extension keeps it in VS Code's secret storage (src/project.js) and hands it only to
// the processes runStreaming and runNpm start for create, install and init, in their environment (opts.env), never in
// argv or a file. Both mask it (opts.redact) in every line they log or pass on; runInTerminal refuses any environment
// that carries it, so an agent session never gets it.
//
// The pure parts (argument building, quoting, the shell kinds, the human-only rule, the confirmation's body, the npm
// commands allowed and their spawn line) take no
// `vscode` and are tested in test/cli.test.mjs; createCli() gets `vscode`, the workspace and the output channel
// injected, and `spawn` for tests.
import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { DEFAULT_ENV, SLUG_RE, approvalConfirmFile, sweepConfirmFile } from "./workspace.js";

export const HUMAN_ONLY = Object.freeze(["approve", "sweep", "eject", "migrate", "issues"]);
// The commands that open an orchestrator-agent session (scripts/lib/cli.mjs): the only ones runInTerminal runs.
export const SESSION_COMMANDS = Object.freeze(["run", "resume", "interview", "explore", "clarifications", "testcases", "k6", "report", "automate"]);
export const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT = 64 * 1024 * 1024;

const approvedFlag = (a) => a === "--approved" || String(a).startsWith("--approved=");
// a sweep that only lists: no --confirm-file (which the script refuses with --dry-run anyway)
const dryRunOnly = (list) => list.includes("--dry-run") && !list.some((a) => a === "--confirm-file" || a.startsWith("--confirm-file="));

// Whether a command is human-only. `script`: the framework script runJson would run instead of atf (testcases.mjs
// approve / import --approved, ledger.mjs sweep).
export function isHumanOnly(args, { script } = {}) {
  const list = args.map(String);
  if (list.some(approvedFlag)) return true;
  if (script) {
    const name = path.basename(String(script)).toLowerCase();
    if (name === "testcases.mjs") return list.some((a) => a === "approve" || a === "importCases");
    if (name === "ledger.mjs") return list.includes("sweep") && !dryRunOnly(list);
    return false;
  }
  // ["node", <script>, …]: the terminal form of a script
  if (list[0] === "node" && list[1]) return isHumanOnly(list.slice(2), { script: list[1] });
  if (list[0] === "sweep") return !dryRunOnly(list);
  return HUMAN_ONLY.includes(list[0]);
}

// node's argv for runJson and runStreaming. framework: the installed package's folder.
export function nodeArgs({ framework, args, script, evalCode }) {
  if (evalCode !== undefined) return ["--input-type=module", "-e", evalCode, ...args];
  if (script) return [path.isAbsolute(script) ? script : path.join(framework, script), ...args];
  return [path.join(framework, "bin", "atf.mjs"), ...args];
}

// ---- the confirmation file (scripts/lib/confirm.mjs) ------------------------------------------------------------------

// What each confirmable action runs and what the human types: the module slug for approve, the product slug for sweep
// (exactly what the scripts' terminal prompts ask). import --approved is confirmable too in the framework, but the
// extension offers no import, so it is not here.
export const CONFIRMABLE = Object.freeze({
  approve: { script: path.join("scripts", "testcases.mjs"), args: (t) => ["approve", t.product, t.module], slug: (t) => t.module, file: (root, t) => approvalConfirmFile(root, t.product, t.module) },
  sweep: { script: path.join("scripts", "ledger.mjs"), args: (t) => ["sweep", t.product, ...(t.run ? ["--run", t.run] : [])], slug: (t) => t.product, file: (root, t) => sweepConfirmFile(root, t.product, t.environment) },
});
export const CONFIRM_LIFETIME_MS = 120_000; // the framework's MAX_LIFETIME_MS: the script runs at once, well within it
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

// A target's problem, or null: slugs only (they become a path and arguments), and a run id that is a plain word.
export function confirmTargetProblem(action, t) {
  if (!CONFIRMABLE[action]) return `unknown confirmation action '${action}'`;
  if (!SLUG_RE.test(String(t?.product ?? ""))) return `the product '${t?.product}' is not a slug`;
  if (action === "approve" && !SLUG_RE.test(String(t.module ?? ""))) return `the module '${t.module}' is not a slug`;
  if (!SLUG_RE.test(String(t.environment ?? DEFAULT_ENV))) return `the environment '${t.environment}' is not a slug`;
  if (action === "sweep" && t.run !== undefined && t.run !== null && !RUN_ID.test(String(t.run))) return `the run '${t.run}' is not a run id`;
  return null;
}

// The file's JSON, exactly the keys the framework accepts: {action, product, module (approve), environment, typed,
// nonce, createdAt, expiresAt}. The environment is the session's ATF_ENV (required for sweep, checked for approve).
export function confirmationBody({ action, product, module, environment = DEFAULT_ENV, typed, now = Date.now(), nonce = randomBytes(24).toString("base64url") }) {
  return {
    action,
    product,
    ...(action === "sweep" ? {} : { module }),
    environment,
    typed,
    nonce,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONFIRM_LIFETIME_MS).toISOString(),
  };
}

// Removes a confirmation file (a link is removed, never followed; a folder is left alone). -> whether one was removed
export function discardConfirmation(file) {
  try {
    if (lstatSync(file).isDirectory()) return false;
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// Writes the file exclusively ("wx": never through a link or over a file someone else put there) and readable by the
// owner only. A leftover at the one defined path (an earlier attempt killed before its cleanup) is removed first:
// discarding a confirmation can only take authority away. Its folder must exist (the sheet's testcases/, the state/):
// the action makes no sense without it.
export function writeConfirmation(file, body) {
  const write = () => {
    const fd = openSync(file, "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify(body));
    } finally {
      closeSync(fd);
    }
  };
  try {
    write();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    discardConfirmation(file);
    write();
  }
}

// ---- terminal quoting -------------------------------------------------------------------------------------------------

// The shell a terminal runs, from its executable: posix (bash, zsh, sh, fish, …), powershell (pwsh, Windows
// PowerShell) or cmd. Unknown: PowerShell on Windows (VS Code's default there), POSIX elsewhere.
export function shellKind(shellPath, platform = process.platform) {
  const name = path.win32.basename(String(shellPath ?? "")).toLowerCase().replace(/\.exe$/, "");
  if (name === "pwsh" || name === "powershell" || name.startsWith("pwsh-")) return "powershell";
  if (name === "cmd") return "cmd";
  if (/^(ba|z|k|da|fi|tc|c)?sh$/.test(name) || name === "fish" || name === "nu" || name === "wsl") return "posix";
  return platform === "win32" ? "powershell" : "posix";
}

const refuse = (a, kind) => {
  throw new Error(`atf: can't pass ${JSON.stringify(a)} to ${kind} safely`);
};

// POSIX shells (fish too): plain when every character is inert, else single-quoted with ' as '\''. A leading = (zsh's
// =cmd expansion), ~, # or % is never plain.
export function quotePosix(a) {
  const s = String(a);
  if (/[\r\n\0]/.test(s)) refuse(s, "the shell");
  if (/^[A-Za-z0-9_./:@+-][A-Za-z0-9_./:@+=,%-]*$/.test(s)) return s;
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

// PowerShell: plain when inert (no , which makes an array, no @ $ ` # ; ( { at all), else single-quoted with ' as ''.
// A double quote is refused: Windows PowerShell 5.1 strips it when it builds a native command's line.
export function quotePowerShell(a) {
  const s = String(a);
  if (/[\r\n\0"]/.test(s)) refuse(s, "PowerShell");
  if (/^[A-Za-z0-9_./:\\-][A-Za-z0-9_./:\\=+-]*$/.test(s)) return s;
  return `'${s.replaceAll("'", "''")}'`;
}

// cmd.exe, as the CLI quotes for it (scripts/lib/cli.mjs windowsCommandLine): double-quoted when it holds a space or
// one of & | < > ^ ( ) ! , ; =; a double quote or % (which cmd.exe expands even inside quotes) is refused.
export function quoteCmd(a) {
  const s = String(a);
  if (/["%\r\n\0]/.test(s)) refuse(s, "cmd.exe");
  return s === "" || /[\s&|<>^()!,;=]/.test(s) ? `"${s}"` : s;
}

export const QUOTE = { posix: quotePosix, powershell: quotePowerShell, cmd: quoteCmd };

// The line a terminal runs: `npx --no atf <args>`. On Windows PowerShell npx is called as npx.cmd: an execution policy
// that blocks scripts would refuse npx.ps1.
export function terminalLine(args, { kind, platform = process.platform }) {
  const q = QUOTE[kind];
  if (!q) throw new Error(`atf: unknown shell kind '${kind}'`);
  const npx = kind === "powershell" && platform === "win32" ? "npx.cmd" : "npx";
  return [npx, "--no", "atf", ...args.map(q)].join(" ");
}

// How a command shows in the output channel.
export const displayLine = (argv) => argv.map((a) => quotePosix(a)).join(" ");

// ---- npm and npx (D-107) ------------------------------------------------------------------------------------------------

export const FRAMEWORK_SPEC_RE = /^@testagentic\/atf@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/; // an exact version: no range, no tag
// The only npm commands the extension runs (runNpm): npx --yes @testagentic/atf@<exact version> init <absolute folder>,
// and npm install with nothing else. -> the problem, or null.
const isAbsoluteOn = (p, platform) => (platform === "win32" ? path.win32 : path.posix).isAbsolute(p);
export function npmCommandProblem(tool, args, { platform = process.platform } = {}) {
  const list = args.map(String);
  if (tool === "npm") return list.length === 1 && list[0] === "install" ? null : `npm ${list.join(" ")}: the extension runs only npm install`;
  if (tool === "npx")
    return list.length === 4 && list[0] === "--yes" && FRAMEWORK_SPEC_RE.test(list[1]) && list[2] === "init" && isAbsoluteOn(list[3], platform)
      ? null
      : `npx ${list.join(" ")}: the extension runs only npx --yes @testagentic/atf@<its own version> init <folder>`;
  return `${tool}: not npm or npx`;
}

// cmd.exe through a .cmd shim, stricter than quoteCmd: the shim's %* re-reads the line, so besides " and % (expanded even
// inside quotes) a ! or ^ is refused too, and a quoted argument may not end in \ (it would escape the closing quote
// for the program's own argument parser). Plain when inert, else double-quoted.
export function quoteNpmCmd(a) {
  const s = String(a);
  if (/["%!^\r\n\0]/.test(s)) refuse(s, "cmd.exe");
  if (s !== "" && !/[\s&|<>(),;=]/.test(s)) return s;
  if (s.endsWith("\\")) refuse(s, "cmd.exe");
  return `"${s}"`;
}

// How runNpm spawns: on POSIX the tool and an argument array with no shell; on Windows one line for cmd.exe
// (shell: true, no separate arguments, so Node adds no quoting of its own), npm.cmd or npx.cmd named explicitly.
// bin: the tool's full path when atf.nodePath names a Node.js with npm beside it (else the tool on the PATH).
// -> { command, args, shell }
export function npmSpawnSpec(tool, args, { platform = process.platform, bin } = {}) {
  if (platform !== "win32") return { command: bin ?? tool, args: args.map(String), shell: false };
  return { command: [bin ?? `${tool}.cmd`, ...args].map(quoteNpmCmd).join(" "), args: [], shell: true };
}

// A line as it may be shown: every secret masked (the registry token, which npm would never print, but the log is
// not the place to find out).
export const redactLine = (line, secrets = []) => secrets.filter((x) => typeof x === "string" && x.length >= 4).reduce((l, x) => l.split(x).join("***"), line);

// The environment npm and npx start with (runNpm): the host's, without an inherited allow-scripts setting
// (npm_config_allow_scripts, or allow-scripts, any case: npm reads both as allow-scripts). npx exports the user's
// ~/.npmrc allow-scripts to the npm it starts that way, and npm 12 refuses it there as a command-line flag
// (EALLOWSCRIPTS: --allow-scripts is not allowed in project-scoped installs); from ~/.npmrc itself npm reads it as it
// should. Everything else, the registry's settings among them, is kept.
export const isAllowScriptsKey = (k) => /^npm_config_allow[-_]scripts$/i.test(k);
export const npmEnv = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !isAllowScriptsKey(k)));

// An environment key that carries the registry token: ATF_NPM_TOKEN, or an npm auth setting (npm_config_…_authToken).
export const isRegistrySecretKey = (k) => /^ATF_NPM_TOKEN$/i.test(k) || /^npm_config_.*:_auth(token)?$/i.test(k);

export class CliError extends Error {
  constructor(message, { code = null, json, stderr = "", timedOut = false } = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.json = json;
    this.stderr = stderr;
    this.timedOut = timedOut;
  }
}

// A streamed line as the output channel shows it: no colour codes, no trailing blanks.
export const plainLine = (s) => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trimEnd();

// Splits a stream's chunks into lines (\n or \r\n), holding a partial line until it ends or the stream does.
export function lineSplitter(onLine) {
  let rest = "";
  return {
    push(chunk) {
      const parts = (rest + chunk).split(/\r?\n/);
      rest = parts.pop();
      for (const p of parts) onLine(p);
    },
    end() {
      if (rest) onLine(rest);
      rest = "";
    },
  };
}

// The last JSON block a script printed on stdout (they print it indented: its own opening brace or bracket starts a
// line), parsed; null when there is none. lines: [{ line, stream }] as runStreaming's onLine gives them.
export function lastJson(lines) {
  const out = lines.filter((l) => l.stream === "stdout").map((l) => l.line);
  for (let at = out.length - 1; at >= 0; at--) {
    if (out[at] !== "{" && out[at] !== "[" && !/^[{[].*[}\]]$/.test(out[at])) continue;
    try {
      return JSON.parse(out.slice(at).join("\n"));
    } catch {
      // a brace in the output that starts no JSON: look further up
    }
  }
  return null;
}

const tail = (s, n = 1500) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

// ---- the CLI's plan, without running it -------------------------------------------------------------------------------

// A child node that imports the installed framework's scripts/lib/cli.mjs and prints what `atf <argv>` would run (its
// plan()), without running any of it: each node-script step as {script, args, env}, the agent step as {agent, prompt}
// (the prompt is the agent command's last argument, whatever host or ATF_AGENT), anything else as {other}. So the
// extension runs the CLI's own pre-checks and sends its own first prompt, and never restates either.
export const PLAN_MODULE = `
import path from "node:path";
import { pathToFileURL } from "node:url";
const [framework, json] = process.argv.slice(1);
const cli = await import(pathToFileURL(path.join(framework, "scripts", "lib", "cli.mjs")).href);
const p = cli.plan(JSON.parse(json));
const wsErr = !p.print && !p.error && !p.standalone && cli.workspaceError();
const step = (s) =>
  s.agent ? { agent: true, prompt: s.args.at(-1) }
  : s.cmd === process.execPath && Array.isArray(s.args) && s.args.length && !String(s.args[0]).startsWith("-") ? { script: s.args[0], args: s.args.slice(1), env: s.env ?? {}, ...(s.cwd ? { cwd: s.cwd } : {}) }
  : { other: Object.keys(s).find((k) => k !== "env" && k !== "failNote") ?? "step" };
console.log(JSON.stringify(wsErr ? { error: wsErr } : p.error ? { error: p.error } : p.print ? { print: p.print } : { steps: p.steps.map(step) }));
`;

// ---- the runner -------------------------------------------------------------------------------------------------------

// deps.cli. workspace: deps.workspace (root, framework); output: the `atf` OutputChannel. spawn/platform/now are for
// tests (killProcess too: process.kill); nodePath() reads the atf.nodePath setting (empty: node on the PATH).
export function createCli({ vscode, workspace, output, spawn = nodeSpawn, platform = process.platform, now = Date.now, env = process.env, killProcess = (pid, signal) => process.kill(pid, signal) }) {
  const running = new Set(); // runStreaming's processes, stopped with the extension (dispose)
  const issued = new Map(); // confirmation file (resolved) -> the exact command it was written for (confirmedRun)
  const nodePath = () => (vscode?.workspace.getConfiguration("atf").get("nodePath") || "").trim() || "node";
  const log = (line) => output?.appendLine(line);
  // npm or npx beside an atf.nodePath Node.js (its folder then leads the PATH, since npx and what it starts run node
  // from it); else the tool on the PATH. -> { bin?, env }
  const npmOf = (tool) => {
    const node = nodePath();
    if (node === "node" || !path.isAbsolute(node)) return { env: {} };
    const dir = path.dirname(node);
    const bin = path.join(dir, platform === "win32" ? `${tool}.cmd` : tool);
    if (!existsSync(bin)) return { env: {} };
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    return { bin, env: { [key]: [dir, env[key]].filter(Boolean).join(platform === "win32" ? ";" : ":") } };
  };

  // The `confirmed` rule: args carry exactly one --confirm-file whose path confirmedRun wrote for exactly this script
  // and these arguments, and the file is still there. Anything else is not a confirmation.
  const commandKey = (script, args) => JSON.stringify([path.basename(String(script ?? "atf")).toLowerCase(), ...args.map(String)]);
  function confirmed(args, { script, cwd }) {
    const list = args.map(String);
    const at = list.indexOf("--confirm-file");
    if (at < 0 || list.indexOf("--confirm-file", at + 1) >= 0 || list.some((a) => a.startsWith("--confirm-file="))) return false;
    const file = list[at + 1];
    if (!file) return false;
    const key = path.resolve(cwd ?? workspace.root ?? ".", file);
    return issued.get(key) === commandKey(script, list) && existsSync(key);
  }
  const humanOnlyRefusal = (label, args, opts) =>
    isHumanOnly(args, { script: opts.script }) && !confirmed(args, opts)
      ? new CliError(`${label}: human-only, so the extension runs it only after you confirm it in its dialog (typing the slug), never otherwise`)
      : null;

  // -> Promise<parsed JSON>. opts: cwd (default the workspace), script | eval, env (added to the process's), timeoutMs,
  // allowExit (exit codes whose JSON is the answer, default [0]; run.mjs exits 1 with {errors} when it refuses).
  function runJson(args, { cwd, script, eval: evalCode, env: extra = {}, timeoutMs = DEFAULT_TIMEOUT_MS, allowExit = [0] } = {}) {
    return new Promise((resolve, reject) => {
      const label = evalCode !== undefined ? `node -e <module> ${args.join(" ")}` : script ? `node ${path.basename(script)} ${args.join(" ")}` : `atf ${args.join(" ")}`;
      const refused = humanOnlyRefusal(label, args, { script, cwd });
      if (refused) return reject(refused);
      if (!workspace.framework) return reject(new CliError(workspace.message ?? `atf: @testagentic/atf is not installed in this workspace`));
      const argv = nodeArgs({ framework: workspace.framework, args, script, evalCode });
      const node = nodePath();
      const started = now();
      log(`$ ${displayLine([node, ...(evalCode !== undefined ? ["--input-type=module", "-e", "<module>", ...args] : argv)])}`);
      let child;
      try {
        child = spawn(node, argv, { cwd: cwd ?? workspace.root, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell: false });
      } catch (e) {
        return reject(new CliError(`${label}: ${e.message}`));
      }
      const out = [];
      let size = 0;
      let stderr = "";
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      child.stdout.on("data", (d) => {
        size += d.length;
        if (size > MAX_STDOUT) child.kill();
        else out.push(d);
      });
      child.stderr.on("data", (d) => {
        stderr = (stderr + d).slice(-20_000);
      });
      child.on("error", (e) =>
        finish(() => {
          const msg = e.code === "ENOENT" ? `${node} not found: install Node.js, or set atf.nodePath to it` : e.message;
          log(`  failed: ${msg}`);
          reject(new CliError(`${label}: ${msg}`, { stderr }));
        }),
      );
      child.on("close", (code) =>
        finish(() => {
          log(`  exit ${timedOut ? "(timed out)" : code} in ${now() - started} ms${stderr.trim() ? `\n${tail(stderr).replace(/^/gm, "  ")}` : ""}`);
          if (timedOut) return reject(new CliError(`${label}: no answer in ${Math.round(timeoutMs / 1000)} s; stopped`, { timedOut: true, stderr }));
          if (size > MAX_STDOUT) return reject(new CliError(`${label}: printed more than ${MAX_STDOUT} bytes; stopped`, { code, stderr }));
          const text = Buffer.concat(out).toString("utf8").trim();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            return reject(new CliError(`${label} printed no JSON (exit ${code})${stderr.trim() ? `: ${tail(stderr, 400)}` : ""}`, { code, stderr }));
          }
          if (!allowExit.includes(code)) {
            const why = Array.isArray(json?.errors) && json.errors.length ? json.errors.join("; ") : tail(stderr, 400) || `exit ${code}`;
            return reject(new CliError(`${label}: ${why}`, { code, json, stderr }));
          }
          resolve(json);
        }),
      );
    });
  }

  // -> Promise<{ code, cancelled }> once the process has exited; a CliError when it can't start. opts: cwd (default the
  // workspace), script (a framework script instead of atf's bin; absolute, or relative to the framework), framework
  // (another installed package: atf init in a folder that is not a workspace yet), env (added to the process's),
  // onLine(line, "stdout" | "stderr"), token (a vscode CancellationToken), redact (secrets masked in every line).
  function runStreaming(args, { cwd, script, framework, env: extra = {}, onLine, token, redact } = {}) {
    const label = script ? `node ${path.basename(script)} ${args.join(" ")}` : `atf ${args.join(" ")}`;
    const refused = humanOnlyRefusal(label, args, { script, cwd });
    if (refused) return Promise.reject(refused);
    const fw = framework ?? workspace.framework;
    if (!fw) return Promise.reject(new CliError(workspace.message ?? `atf: @testagentic/atf is not installed in this workspace`));
    const argv = nodeArgs({ framework: fw, args, script });
    const node = nodePath();
    return stream({ label, command: node, argv, shown: [node, ...argv], shell: false, cwd: cwd ?? workspace.root, env: extra, onLine, token, redact, missing: `${node} not found: install Node.js, or set atf.nodePath to it` });
  }

  // npm or npx itself (D-107): only the commands npmCommandProblem allows. opts: cwd (required: the folder it works
  // in), env (added to the process's: the registry's, with the token), onLine, token, redact. The process's environment
  // carries no allow-scripts setting (npmEnv). -> as runStreaming
  function runNpm(tool, args, { cwd, env: extra = {}, onLine, token, redact } = {}) {
    const problem = npmCommandProblem(tool, args, { platform });
    if (problem) return Promise.reject(new CliError(`atf: ${problem}; nothing was run`));
    // cwd is a spawn option, never part of the command line, so any folder is safe there
    if (!cwd || !isAbsoluteOn(cwd, platform)) return Promise.reject(new CliError(`atf: ${tool} needs the folder it works in; nothing was run`));
    const found = npmOf(tool);
    let spec;
    try {
      spec = npmSpawnSpec(tool, args, { platform, bin: found.bin });
    } catch (e) {
      return Promise.reject(new CliError(`${e.message}; nothing was run`));
    }
    return stream({ label: `${tool} ${args.join(" ")}`, command: spec.command, argv: spec.args, shown: [found.bin ?? tool, ...args], shell: spec.shell, cwd, base: npmEnv(env), env: npmEnv({ ...found.env, ...extra }), onLine, token, redact, missing: `${tool} not found: install Node.js (it brings npm), or set atf.nodePath to a Node.js with npm beside it, then reload VS Code` });
  }

  // One streamed child process (runStreaming, runNpm): every line logged and passed on as it comes, masked; the exit
  // code the answer; a cancelled token kills the process tree. NO_COLOR keeps colour codes out of the output channel.
  // On POSIX the child leads its own process group, so a cancel stops the steps it spawned too (the login's browser, an
  // npm install among them); Windows has taskkill /T. base: the environment extra is added to (default the host's).
  function stream({ label, command, argv, shown, shell, cwd, base = env, env: extra, onLine, token, redact = [], missing }) {
    return new Promise((resolve, reject) => {
      if (token?.isCancellationRequested) return resolve({ code: null, cancelled: true });
      const mask = (l) => redactLine(l, redact);
      const started = now();
      log(mask(`$ ${displayLine(shown)}`));
      let child;
      try {
        child = spawn(command, argv, { cwd, env: { ...base, NO_COLOR: "1", ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], shell, detached: platform !== "win32" });
      } catch (e) {
        return reject(new CliError(mask(`${label}: ${e.message}`)));
      }
      running.add(child);
      let cancelled = false;
      const cancel = token?.onCancellationRequested?.(() => {
        cancelled = true;
        log("  cancelled");
        killTree(child);
      });
      const lines = (name) => {
        const decoder = new StringDecoder("utf8");
        const split = lineSplitter((raw) => {
          const line = mask(plainLine(raw));
          log(`  ${line}`);
          try {
            onLine?.(line, name);
          } catch {
            // a listener's mistake must not lose the process's answer
          }
        });
        child[name].on("data", (d) => split.push(decoder.write(d)));
        return () => {
          split.push(decoder.end());
          split.end();
        };
      };
      const flush = [lines("stdout"), lines("stderr")];
      let settled = false;
      const finish = (fn) => {
        if (settled) return;
        settled = true;
        running.delete(child);
        cancel?.dispose();
        fn();
      };
      child.on("error", (e) =>
        finish(() => {
          const msg = e.code === "ENOENT" ? missing : mask(e.message);
          log(`  failed: ${msg}`);
          reject(new CliError(`${label}: ${msg}`));
        }),
      );
      child.on("close", (code) =>
        finish(() => {
          for (const f of flush) f();
          log(`  exit ${cancelled ? "(cancelled)" : code} in ${now() - started} ms`);
          resolve({ code, cancelled });
        }),
      );
    });
  }

  // A human-only command the human confirmed in the extension's dialog. action: "approve" | "sweep"; t: { product,
  // module (approve), environment (default `default`), run (sweep, optional) }; opts.typed: what the human typed, which
  // must be the slug (checked here again: the dialog's validation is not the only line). Writes the confirmation at the
  // framework's one path for it, runs the script at once with the same ATF_ENV and the workspace pinned (the script
  // resolves the path from its own workspace root), and removes the file afterwards whatever the outcome.
  // -> runStreaming's { code, cancelled }; a CliError when it can't be written or started (nothing was run).
  async function confirmedRun(action, t, { typed, onLine, token } = {}) {
    const problem = confirmTargetProblem(action, t);
    if (problem) throw new CliError(`atf: ${problem}; nothing was run`);
    if (!workspace.root || !workspace.framework) throw new CliError(workspace.message ?? `atf: @testagentic/atf is not installed in this workspace`);
    const spec = CONFIRMABLE[action];
    const slug = spec.slug(t);
    if (typed !== slug) throw new CliError(`atf: not confirmed: '${typed ?? ""}' is not '${slug}'; nothing was written or run`);
    if (token?.isCancellationRequested) return { code: null, cancelled: true };
    const environment = t.environment ?? DEFAULT_ENV;
    const file = spec.file(workspace.root, { ...t, environment });
    const args = [...spec.args(t), "--confirm-file", file];
    try {
      writeConfirmation(file, confirmationBody({ action, product: t.product, module: t.module, environment, typed, now: now() }));
    } catch (e) {
      throw new CliError(`atf: can't write the confirmation ${path.relative(workspace.root, file)} (${e.code ?? e.message}); nothing was run`);
    }
    const key = path.resolve(file);
    issued.set(key, commandKey(spec.script, args));
    log(`atf: you confirmed ${action} ${slug}: ${path.relative(workspace.root, file)} written for this one command`);
    try {
      return await runStreaming(args, { script: spec.script, env: { ATF_ENV: environment === DEFAULT_ENV ? "" : environment, ATF_WORKSPACE: workspace.root }, onLine, token });
    } finally {
      issued.delete(key);
      discardConfirmation(file); // normally already gone: the script deletes it before it acts
    }
  }

  // What `atf <argv>` would run, from the installed CLI's own plan() (PLAN_MODULE), run nothing.
  // -> { error } | { print } | { steps: [{ script, args, env, cwd? } | { agent, prompt } | { other }] }
  async function cliPlan(argv) {
    if (isHumanOnly(argv)) throw new CliError(`atf ${argv.join(" ")}: human-only; the extension does not plan it`);
    if (!workspace.root) throw new CliError(workspace.message ?? "atf: no atf workspace is open");
    return runJson([workspace.framework ?? "", JSON.stringify(argv)], { eval: PLAN_MODULE, env: { ATF_WORKSPACE: workspace.root, ATF_ENV: "" }, timeoutMs: 30_000 });
  }

  // The process and everything it started: its group on POSIX (it was spawned detached, so it leads one), taskkill /T on
  // Windows. Either failing falls back to the process alone.
  function killTree(child) {
    try {
      if (platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", shell: false }).on?.("error", () => child.kill());
      else killProcess(-child.pid, "SIGTERM");
    } catch {
      child.kill();
    }
  }

  // An agent session in a terminal: the only thing that gets one (SESSION_COMMANDS). The terminal's shell is VS Code's
  // default for the platform (env.shell honours terminal.integrated.defaultProfile), passed as its shellPath, so the
  // shell quoted for is the shell that runs. -> the Terminal. opts: name (the terminal's title), cwd (default the
  // workspace), env, location (vscode.TerminalLocation.Editor: a tab in the editor area), show (default true).
  async function runInTerminal(args, { name, cwd, env: extra, location, show = true } = {}) {
    if (isHumanOnly(args)) throw new CliError(`atf ${args.join(" ")}: human-only, never sent to a terminal`);
    if (!SESSION_COMMANDS.includes(String(args[0]))) throw new CliError(`atf ${args[0]}: only agent sessions open in a terminal; the extension runs everything else itself`);
    if (Object.keys(extra ?? {}).some(isRegistrySecretKey)) throw new CliError(`atf ${args[0]}: the registry token is never given to an agent session`);
    const shell = vscode.env.shell || "";
    const kind = shellKind(shell, platform);
    const line = terminalLine(args, { kind, platform });
    const title = name ?? `atf ${args[0]}`;
    const terminal = vscode.window.createTerminal({
      name: title,
      cwd: cwd ?? workspace.root ?? undefined,
      ...(shell ? { shellPath: shell } : {}),
      ...(extra && Object.keys(extra).length ? { env: extra } : {}),
      ...(location !== undefined ? { location } : {}),
    });
    if (show) terminal.show();
    log(`$ ${line}   (terminal "${title}")`);
    const integration = await shellIntegration(terminal);
    if (integration) integration.executeCommand(line);
    else terminal.sendText(line, true);
    return terminal;
  }

  // The terminal's shell integration once it is active (it reports the command's run and exit), or null after a few
  // seconds: then sendText, which works in every shell.
  function shellIntegration(terminal, ms = 3000) {
    if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
    const onChange = vscode.window.onDidChangeTerminalShellIntegration;
    if (typeof onChange !== "function") return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = (v) => {
        clearTimeout(timer);
        sub.dispose();
        resolve(v);
      };
      const sub = onChange((e) => e.terminal === terminal && done(e.shellIntegration));
      const timer = setTimeout(() => done(null), ms);
    });
  }

  // the extension is going away: a background atf command must not outlive it (a detached one would), nor a
  // confirmation it wrote
  const dispose = () => {
    for (const child of running) killTree(child);
    running.clear();
    for (const file of issued.keys()) discardConfirmation(file);
    issued.clear();
  };

  return { runJson, runStreaming, runNpm, confirmedRun, cliPlan, runInTerminal, isHumanOnly, nodePath, dispose };
}
