// How the extension runs atf (P-12): the installed @testagentic/atf's own commands and scripts, nothing of its own.
//
//   runJson(args, opts)        a child node, no shell, on the framework's bin/atf.mjs (or `script`, or an `eval`
//                              module), whose stdout is JSON: parsed, or a clear error. A timeout kills it. Every call is
//                              logged to the `atf` output channel: the command, exit code, time and stderr, never stdout
//                              (it can be large; nothing the scripts print is a secret, but the log is not a data dump).
//   runInTerminal(args, opts)  a VS Code terminal in the workspace running `npx --no atf <args>`, for anything
//                              interactive, long or human-only. The arguments are quoted for that terminal's shell (POSIX
//                              shells, PowerShell, cmd.exe); one that can't be passed safely is refused, never mangled.
//                              `--no` stops npx from fetching some other public package named `atf` when the framework is
//                              not installed. args[0] === "node" runs that node script instead (["node", script, …]),
//                              with the configured Node.js: the report's render command, for one.
//
// The human-only commands (approve, sweep, `import --approved`, eject, init, migrate, issues; and the scripts behind
// them) run only in a terminal the human sees: runJson refuses them before spawning anything. The guard refuses them to
// agents (scripts/lib/guard.mjs); the extension's own processes are the human's, but a background process would still
// hide what is being signed off or deleted, so it never runs them.
//
// The pure parts (argument building, quoting, the shell kinds, the human-only rule) take no `vscode` and are tested in
// test/cli.test.mjs; createCli() gets `vscode`, the workspace and the output channel injected, and `spawn` for tests.
import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";

export const HUMAN_ONLY = Object.freeze(["approve", "sweep", "eject", "init", "migrate", "issues"]);
export const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDOUT = 64 * 1024 * 1024;

const approvedFlag = (a) => a === "--approved" || String(a).startsWith("--approved=");

// Whether a command is human-only. `script`: the framework script runJson would run instead of atf (testcases.mjs
// approve / import --approved, ledger.mjs sweep).
export function isHumanOnly(args, { script } = {}) {
  const list = args.map(String);
  if (list.some(approvedFlag)) return true;
  if (script) {
    const name = path.basename(String(script)).toLowerCase();
    if (name === "testcases.mjs") return list.some((a) => a === "approve" || a === "importCases");
    if (name === "ledger.mjs") return list.includes("sweep");
    return false;
  }
  // ["node", <script>, …]: the terminal form of a script
  if (list[0] === "node" && list[1]) return isHumanOnly(list.slice(2), { script: list[1] });
  return HUMAN_ONLY.includes(list[0]);
}

// node's argv for runJson. framework: the installed package's folder.
export function nodeArgs({ framework, args, script, evalCode }) {
  if (evalCode !== undefined) return ["--input-type=module", "-e", evalCode, ...args];
  if (script) return [path.isAbsolute(script) ? script : path.join(framework, script), ...args];
  return [path.join(framework, "bin", "atf.mjs"), ...args];
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

// The line a terminal runs. args: atf's arguments, or ["node", script, …] for a node script. On Windows PowerShell
// npx is called as npx.cmd: an execution policy that blocks scripts would refuse npx.ps1. `node` is the configured
// Node.js (PowerShell needs & before a quoted path).
export function terminalLine(args, { kind, platform = process.platform, node = "node" }) {
  const q = QUOTE[kind];
  if (!q) throw new Error(`atf: unknown shell kind '${kind}'`);
  if (args[0] === "node") {
    const exe = q(node);
    return [kind === "powershell" && exe !== node ? `& ${exe}` : exe, ...args.slice(1).map(q)].join(" ");
  }
  const npx = kind === "powershell" && platform === "win32" ? "npx.cmd" : "npx";
  return [npx, "--no", "atf", ...args.map(q)].join(" ");
}

// How a command shows in the output channel.
export const displayLine = (argv) => argv.map((a) => quotePosix(a)).join(" ");

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

const tail = (s, n = 1500) => {
  const t = String(s ?? "").trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
};

// ---- the runner -------------------------------------------------------------------------------------------------------

// deps.cli. workspace: deps.workspace (root, framework); output: the `atf` OutputChannel. spawn/platform/now are for
// tests; nodePath() reads the atf.nodePath setting (empty: node on the PATH).
export function createCli({ vscode, workspace, output, spawn = nodeSpawn, platform = process.platform, now = Date.now, env = process.env }) {
  const nodePath = () => (vscode?.workspace.getConfiguration("atf").get("nodePath") || "").trim() || "node";
  const log = (line) => output?.appendLine(line);

  // -> Promise<parsed JSON>. opts: cwd (default the workspace), script | eval, env (added to the process's), timeoutMs,
  // allowExit (exit codes whose JSON is the answer, default [0]; run.mjs exits 1 with {errors} when it refuses).
  function runJson(args, { cwd, script, eval: evalCode, env: extra = {}, timeoutMs = DEFAULT_TIMEOUT_MS, allowExit = [0] } = {}) {
    return new Promise((resolve, reject) => {
      const label = evalCode !== undefined ? `node -e <module> ${args.join(" ")}` : script ? `node ${path.basename(script)} ${args.join(" ")}` : `atf ${args.join(" ")}`;
      if (isHumanOnly(args, { script })) return reject(new CliError(`${label}: human-only, so it runs only in a terminal you see, never in the background`));
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

  // The terminal's shell: VS Code's default for the platform (env.shell honours terminal.integrated.defaultProfile).
  // It is passed as the terminal's shellPath, so the shell quoted for is the shell that runs.
  // -> the Terminal. opts: name, cwd (default the workspace), env, show (default true).
  async function runInTerminal(args, { name, cwd, env: extra, show = true } = {}) {
    const shell = vscode.env.shell || "";
    const kind = shellKind(shell, platform);
    const line = terminalLine(args, { kind, platform, node: nodePath() });
    const terminal = vscode.window.createTerminal({
      name: `atf: ${name ?? args[0]}`,
      cwd: cwd ?? workspace.root ?? undefined,
      ...(shell ? { shellPath: shell } : {}),
      ...(extra && Object.keys(extra).length ? { env: extra } : {}),
    });
    if (show) terminal.show();
    log(`$ ${line}   (terminal "atf: ${name ?? args[0]}")`);
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

  return { runJson, runInTerminal, isHumanOnly, nodePath };
}
