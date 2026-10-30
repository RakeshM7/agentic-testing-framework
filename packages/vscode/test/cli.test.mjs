// src/cli.js: the human-only rule, node's arguments, the terminal's shell and quoting (POSIX, PowerShell, cmd.exe on
// Windows and elsewhere), runJson and runStreaming over a fake spawn, the confirmation file and confirmedRun, and
// runInTerminal (agent sessions only) over a fake vscode. No VS Code; the real atf for runStreaming's `atf config` and
// the CLI's plan (an installed copy of the framework), and the framework's own sweep script for a confirmation.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { CONFIRM_LIFETIME_MS, CliError, HUMAN_ONLY, SESSION_COMMANDS, confirmTargetProblem, confirmationBody, createCli, isHumanOnly, lastJson, lineSplitter, nodeArgs, plainLine, quoteCmd, quotePosix, quotePowerShell, shellKind, terminalLine, writeConfirmation } from "../src/cli.js";
import { APPROVAL_CONFIRM, SWEEP_CONFIRM, approvalConfirmFile, sweepConfirmFile } from "../src/workspace.js";
import { fakeVscode } from "./fake-vscode.mjs";

const FW = path.join(path.sep, "ws", "node_modules", "@testagentic", "atf");
const CORE = path.resolve(import.meta.dirname, "..", "..", "core");
const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-cli-")));

test("the spec's human-only commands, and the scripts behind them, are human-only", () => {
  for (const c of HUMAN_ONLY) assert.equal(isHumanOnly([c, "acme"]), true, c);
  assert.deepEqual(HUMAN_ONLY, ["approve", "sweep", "eject", "migrate", "issues"]);
  assert.equal(isHumanOnly(["import", "acme", "contacts", "--approved"]), true);
  assert.equal(isHumanOnly(["import", "acme", "contacts", "--approved=yes"]), true);
  assert.equal(isHumanOnly(["import", "acme", "contacts", "--file", "cases.xlsx"]), false);
  for (const c of ["status", "next", "run", "resume", "doctor", "sync", "check", "version", "validate", "init"]) assert.equal(isHumanOnly([c, "acme"]), false, c);
  assert.equal(isHumanOnly(["approve", "acme", "contacts"], { script: "scripts/testcases.mjs" }), true);
  assert.equal(isHumanOnly(["approve", "acme", "contacts", "--confirm-file", "x"], { script: "scripts/testcases.mjs" }), true, "a confirmation does not make it any less human-only");
  assert.equal(isHumanOnly(["importCases", "acme"], { script: path.join(FW, "scripts", "testcases.mjs") }), true);
  assert.equal(isHumanOnly(["check", "acme", "contacts"], { script: "scripts/testcases.mjs" }), false);
  assert.equal(isHumanOnly(["sweep", "acme"], { script: "scripts/ledger.mjs" }), true);
  assert.equal(isHumanOnly(["status", "acme"], { script: "scripts/run.mjs" }), false);
  assert.equal(isHumanOnly(["node", path.join(FW, "scripts", "ledger.mjs"), "sweep", "acme"]), true, "the node form");
  assert.equal(isHumanOnly(["node", path.join(FW, "scripts", "report.mjs"), "render", "acme"]), false);
  // a sweep's dry run sends nothing: it runs in the background like any read, but never with a confirmation
  assert.equal(isHumanOnly(["sweep", "acme", "--dry-run"]), false);
  assert.equal(isHumanOnly(["sweep", "acme", "--dry-run"], { script: "scripts/ledger.mjs" }), false);
  assert.equal(isHumanOnly(["sweep", "acme", "--dry-run", "--confirm-file", "x"], { script: "scripts/ledger.mjs" }), true);
});

test("runJson's node arguments: atf's bin, a script, or a module", () => {
  assert.deepEqual(nodeArgs({ framework: FW, args: ["status", "acme"] }), [path.join(FW, "bin", "atf.mjs"), "status", "acme"]);
  assert.deepEqual(nodeArgs({ framework: FW, args: ["status", "acme"], script: path.join("scripts", "run.mjs") }), [path.join(FW, "scripts", "run.mjs"), "status", "acme"]);
  const abs = path.resolve("x.mjs");
  assert.deepEqual(nodeArgs({ framework: FW, args: [], script: abs }), [abs]);
  assert.deepEqual(nodeArgs({ framework: FW, args: ["a"], evalCode: "code" }), ["--input-type=module", "-e", "code", "a"]);
});

test("the terminal's shell kind, from its executable, on Windows and POSIX", () => {
  const cases = [
    ["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "win32", "powershell"],
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", "win32", "powershell"],
    ["C:\\Windows\\System32\\cmd.exe", "win32", "cmd"],
    ["C:\\Program Files\\Git\\bin\\bash.exe", "win32", "posix"],
    ["C:\\Windows\\System32\\wsl.exe", "win32", "posix"],
    ["", "win32", "powershell"],
    ["/bin/zsh", "darwin", "posix"],
    ["/usr/bin/fish", "linux", "posix"],
    ["/usr/local/bin/pwsh", "linux", "powershell"],
    ["", "linux", "posix"],
    [undefined, "darwin", "posix"],
  ];
  for (const [shell, platform, kind] of cases) assert.equal(shellKind(shell, platform), kind, `${shell} on ${platform}`);
});

test("POSIX quoting: inert words plain, anything else single-quoted", () => {
  assert.equal(quotePosix("acme-crm"), "acme-crm");
  assert.equal(quotePosix("--env"), "--env");
  assert.equal(quotePosix("explore,testcases"), "explore,testcases");
  assert.equal(quotePosix("/Users/a b/node"), "'/Users/a b/node'");
  assert.equal(quotePosix("it's"), `'it'\\''s'`);
  assert.equal(quotePosix("$(rm -rf ~)"), "'$(rm -rf ~)'");
  assert.equal(quotePosix("=ls"), "'=ls'", "zsh's =cmd expansion");
  assert.equal(quotePosix("~"), "'~'");
  assert.equal(quotePosix("a;b"), "'a;b'");
  assert.equal(quotePosix(""), "''");
  assert.throws(() => quotePosix("a\nb"), /can't pass/);
});

test("PowerShell quoting: no array commas, no expansion, no double quotes", () => {
  assert.equal(quotePowerShell("acme-crm"), "acme-crm");
  assert.equal(quotePowerShell("C:\\Users\\me\\node.exe"), "C:\\Users\\me\\node.exe");
  assert.equal(quotePowerShell("explore,testcases"), "'explore,testcases'");
  assert.equal(quotePowerShell("$env:X"), "'$env:X'");
  assert.equal(quotePowerShell("@args"), "'@args'");
  assert.equal(quotePowerShell("it's here"), "'it''s here'");
  assert.equal(quotePowerShell("a`b"), "'a`b'");
  assert.equal(quotePowerShell(""), "''");
  assert.throws(() => quotePowerShell('say "hi"'), /PowerShell/);
});

test("cmd.exe quoting matches the CLI's: quote specials, refuse \" and %", () => {
  assert.equal(quoteCmd("acme"), "acme");
  assert.equal(quoteCmd("explore,testcases"), '"explore,testcases"');
  assert.equal(quoteCmd("C:\\Program Files\\nodejs\\node.exe"), '"C:\\Program Files\\nodejs\\node.exe"');
  assert.equal(quoteCmd("a&b"), '"a&b"');
  assert.equal(quoteCmd(""), '""');
  assert.throws(() => quoteCmd("%PATH%"), /cmd\.exe/);
  assert.throws(() => quoteCmd('a"b'), /cmd\.exe/);
});

test("the terminal line: npx --no atf, npx.cmd on Windows PowerShell", () => {
  const args = ["resume", "acme", "--stage", "explore", "--module", "a b", "--env", "uat"];
  assert.equal(terminalLine(args, { kind: "posix", platform: "darwin" }), "npx --no atf resume acme --stage explore --module 'a b' --env uat");
  assert.equal(terminalLine(args, { kind: "powershell", platform: "win32" }), "npx.cmd --no atf resume acme --stage explore --module 'a b' --env uat");
  assert.equal(terminalLine(args, { kind: "powershell", platform: "linux" }), "npx --no atf resume acme --stage explore --module 'a b' --env uat");
  assert.equal(terminalLine(args, { kind: "cmd", platform: "win32" }), 'npx --no atf resume acme --stage explore --module "a b" --env uat');
  assert.throws(() => terminalLine(["run", "%x%"], { kind: "cmd", platform: "win32" }), /cmd\.exe/);
});

test("lastJson: the last JSON block a script printed, after any other output", () => {
  const o = (line) => ({ line, stream: "stdout" });
  assert.deepEqual(lastJson([o("Fixing: npm install"), o("{"), o('  "a": {'), o('    "b": 1'), o("  }"), o("}"), { line: "{", stream: "stderr" }]), { a: { b: 1 } });
  assert.deepEqual(lastJson([o('{"one":1}'), o("noise"), o("{"), o('  "two": [2]'), o("}")]), { two: [2] });
  assert.deepEqual(lastJson([o("["), o("  1"), o("]")]), [1]);
  assert.equal(lastJson([o("{ not json"), o("done")]), null);
  assert.equal(lastJson([]), null);
});

// ---- runJson over a fake spawn --------------------------------------------------------------------------------------

function fakeSpawn(script) {
  const calls = [];
  const spawn = (cmd, argv, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit("close", null, "SIGTERM"));
    };
    calls.push({ cmd, argv, opts, child });
    setImmediate(() => script(child, { cmd, argv, opts }));
    return child;
  };
  return { spawn, calls };
}
const reply = (stdout, code = 0, stderr = "") => (child) => {
  if (stderr) child.stderr.emit("data", Buffer.from(stderr));
  if (stdout) child.stdout.emit("data", Buffer.from(stdout));
  child.emit("close", code);
};
const setup = (script, { config = {}, workspace, platform, killProcess } = {}) => {
  const vscode = fakeVscode({ config });
  const output = vscode.window.createOutputChannel("atf");
  const s = fakeSpawn(script);
  const cli = createCli({ vscode, workspace: workspace ?? { root: path.join(path.sep, "ws"), framework: FW }, output, spawn: s.spawn, env: { PATH: "/bin", ATF_ENV: "inherited" }, ...(platform ? { platform } : {}), ...(killProcess ? { killProcess } : {}) });
  return { cli, output, calls: s.calls, vscode };
};

test("runJson runs node on atf's bin with an argument array, no shell, and parses the JSON", async () => {
  const { cli, calls, output } = setup(reply('{"product":"acme","stages":[]}', 0, "a warning\n"));
  const r = await cli.runJson(["status", "acme"], { env: { ATF_ENV: "" } });
  assert.deepEqual(r, { product: "acme", stages: [] });
  const [{ cmd, argv, opts }] = calls;
  assert.equal(cmd, "node");
  assert.deepEqual(argv, [path.join(FW, "bin", "atf.mjs"), "status", "acme"]);
  assert.equal(opts.shell, false);
  assert.equal(opts.cwd, path.join(path.sep, "ws"));
  assert.equal(opts.env.ATF_ENV, "", "the caller's environment wins over the inherited one");
  assert.equal(opts.env.PATH, "/bin");
  assert.ok(output.lines[0].startsWith("$ node "));
  assert.ok(output.lines.some((l) => /exit 0 in \d+ ms/.test(l) && l.includes("a warning")));
  assert.ok(!output.lines.join("\n").includes('"product"'), "stdout is not logged");
});

test("runJson uses atf.nodePath when set", async () => {
  const { cli, calls } = setup(reply("{}"), { config: { nodePath: "  /opt/node/bin/node " } });
  await cli.runJson(["version", "--json"]);
  assert.equal(calls[0].cmd, "/opt/node/bin/node");
});

test("runJson: a refusal's JSON on an allowed exit is the answer; otherwise a CliError with it", async () => {
  const refusal = JSON.stringify({ errors: ["no run state for product 'acme' (run.mjs init first)"] });
  assert.deepEqual(await setup(reply(refusal, 1)).cli.runJson(["status", "acme"], { allowExit: [0, 1] }), JSON.parse(refusal));
  await assert.rejects(setup(reply(refusal, 1)).cli.runJson(["status", "acme"]), (e) => e instanceof CliError && e.code === 1 && /no run state/.test(e.message) && e.json.errors.length === 1);
});

test("runJson: output that is not JSON, a timeout and a missing node are clear errors", async () => {
  await assert.rejects(setup(reply("Usage: …", 2, "bad args")).cli.runJson(["status"]), /printed no JSON \(exit 2\): bad args/);
  await assert.rejects(setup(() => {}).cli.runJson(["status", "acme"], { timeoutMs: 20 }), (e) => e.timedOut && /no answer in 0 s; stopped/.test(e.message));
  const enoent = (child) => child.emit("error", Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }));
  await assert.rejects(setup(enoent).cli.runJson(["status", "acme"]), /node not found: install Node\.js, or set atf\.nodePath/);
});

const REFUSED = /human-only, so the extension runs it only after you confirm it in its dialog/;

test("runJson refuses human-only commands without spawning, and works only with the framework installed", async () => {
  const { cli, calls } = setup(reply("{}"));
  for (const args of [["approve", "acme", "contacts"], ["sweep", "acme"], ["import", "acme", "contacts", "--approved"], ["eject", "config"], ["migrate"], ["issues", "export"]])
    await assert.rejects(cli.runJson(args), REFUSED, args.join(" "));
  await assert.rejects(cli.runJson(["approve", "acme", "contacts"], { script: "scripts/testcases.mjs" }), REFUSED);
  await assert.rejects(cli.runJson(["sweep", "acme"], { script: "scripts/ledger.mjs" }), REFUSED);
  assert.equal(calls.length, 0);
  // a sweep's dry run is a read
  await cli.runJson(["sweep", "acme", "--dry-run"], { script: "scripts/ledger.mjs" });
  assert.deepEqual(calls[0].argv, [path.join(FW, "scripts", "ledger.mjs"), "sweep", "acme", "--dry-run"]);
  const none = setup(reply("{}"), { workspace: { root: "/ws", framework: null, message: "atf: install it" } });
  await assert.rejects(none.cli.runJson(["status", "acme"]), /install it/);
  assert.equal(none.calls.length, 0);
});

test("runJson with a script or a module", async () => {
  const { cli, calls } = setup(reply("[]"));
  await cli.runJson(["status", "acme"], { script: path.join("scripts", "run.mjs") });
  await cli.runJson(["acme"], { eval: "console.log('[]')" });
  assert.deepEqual(calls[0].argv, [path.join(FW, "scripts", "run.mjs"), "status", "acme"]);
  assert.deepEqual(calls[1].argv, ["--input-type=module", "-e", "console.log('[]')", "acme"]);
});

// ---- runInTerminal: agent sessions only ---------------------------------------------------------------------------------

const terminalCli = ({ platform = "darwin", shell = "/bin/zsh", shellIntegration = false, noIntegrationEvent = false, config = {} } = {}) => {
  const vscode = fakeVscode({ shell, shellIntegration, config });
  if (noIntegrationEvent) delete vscode.window.onDidChangeTerminalShellIntegration;
  const output = vscode.window.createOutputChannel("atf");
  const cli = createCli({ vscode, workspace: { root: "/ws", framework: FW }, output, platform, spawn: () => assert.fail("a terminal command never spawns") });
  return { cli, vscode };
};

test("an agent session opens in a terminal tab in the editor area, named for it, through shell integration", async () => {
  const { cli, vscode } = terminalCli({ shellIntegration: true });
  const t = await cli.runInTerminal(["run", "acme", "--host", "copilot"], { name: "atf run acme", location: vscode.TerminalLocation.Editor });
  assert.equal(t.opts.name, "atf run acme");
  assert.equal(t.opts.location, vscode.TerminalLocation.Editor);
  assert.equal(t.opts.cwd, "/ws");
  assert.equal(t.opts.shellPath, "/bin/zsh", "the shell quoted for is the shell that runs");
  assert.equal(t.shown, true);
  assert.deepEqual(t.executed, ["npx --no atf run acme --host copilot"]);
  assert.deepEqual(t.sent, []);
});

test("runInTerminal refuses human-only commands and anything that is not an agent session", async () => {
  const { cli, vscode } = terminalCli({ shellIntegration: true });
  assert.deepEqual(SESSION_COMMANDS, ["run", "resume", "interview", "explore", "clarifications", "testcases", "k6", "report", "automate"]);
  for (const args of [["approve", "acme", "contacts"], ["sweep", "acme"], ["import", "acme", "contacts", "--approved"]]) await assert.rejects(cli.runInTerminal(args), /human-only, never sent to a terminal/, args[0]);
  for (const args of [["sync"], ["init"], ["doctor", "acme"], ["config", "acme", "--url", "https://x"]]) await assert.rejects(cli.runInTerminal(args), /only agent sessions open in a terminal/, args[0]);
  assert.equal(vscode.rec.terminals.length, 0);
});

test("without shell integration the line is sent as text; Windows shells get their own quoting", async () => {
  const posix = terminalCli({ noIntegrationEvent: true });
  const t1 = await posix.cli.runInTerminal(["interview"], { name: "atf interview" });
  assert.deepEqual(t1.sent, [["npx --no atf interview", true]]);
  assert.equal(t1.opts.location, undefined, "the panel unless asked");

  const ps = terminalCli({ platform: "win32", shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", noIntegrationEvent: true });
  const t2 = await ps.cli.runInTerminal(["resume", "acme", "--stage", "explore", "--module", "my module"], { name: "atf resume acme" });
  assert.deepEqual(t2.sent, [["npx.cmd --no atf resume acme --stage explore --module 'my module'", true]]);

  const cmd = terminalCli({ platform: "win32", shell: "C:\\Windows\\System32\\cmd.exe", noIntegrationEvent: true });
  const t3 = await cmd.cli.runInTerminal(["run", "acme", "--env", "uat"], { name: "atf run acme (uat)", env: { X: "1" } });
  assert.deepEqual(t3.sent, [["npx --no atf run acme --env uat", true]]);
  assert.deepEqual(t3.opts.env, { X: "1" });
  await assert.rejects(cmd.cli.runInTerminal(["run", "%PATH%"]), /cmd\.exe/);
  assert.equal(cmd.vscode.rec.terminals.length, 1, "nothing is opened for a line that can't be quoted");
});

// ---- runStreaming -----------------------------------------------------------------------------------------------------

const fakeToken = () => {
  const t = { isCancellationRequested: false, listeners: [], onCancellationRequested: (fn) => (t.listeners.push(fn), { dispose() {} }) };
  t.cancel = () => ((t.isCancellationRequested = true), t.listeners.forEach((fn) => fn()));
  return t;
};
const tick = () => new Promise((r) => setImmediate(r));

test("streamed lines: split across chunks, \\r\\n too, a last partial line kept; colour codes dropped", () => {
  const got = [];
  const s = lineSplitter((l) => got.push(l));
  s.push("Created conf");
  s.push("ig/a.yaml\r\nMicrosoft Edge is open");
  s.push(" on x\n\nlast");
  s.end();
  assert.deepEqual(got, ["Created config/a.yaml", "Microsoft Edge is open on x", "", "last"]);
  assert.equal(plainLine("\x1b[32mok\x1b[0m  "), "ok");
});

test("runStreaming: node on atf's bin, no shell, its own process group, each line logged and passed on as it comes", async () => {
  const { cli, calls, output } = setup((child) => {
    child.stdout.emit("data", Buffer.from("Created config/acme.yaml. Still to fill in\n"));
    child.stderr.emit("data", Buffer.from("Microsoft Edge is open on https://x: sign in\npartial"));
    child.emit("close", 0);
  });
  const lines = [];
  const r = await cli.runStreaming(["config", "acme", "--url", "https://x"], { env: { ATF_ENV: "" }, onLine: (line, stream) => lines.push([stream, line]) });
  assert.deepEqual(r, { code: 0, cancelled: false });
  const [{ cmd, argv, opts }] = calls;
  assert.equal(cmd, "node");
  assert.deepEqual(argv, [path.join(FW, "bin", "atf.mjs"), "config", "acme", "--url", "https://x"]);
  assert.deepEqual([opts.shell, opts.cwd, opts.env.ATF_ENV, opts.env.NO_COLOR, opts.env.PATH], [false, path.join(path.sep, "ws"), "", "1", "/bin"]);
  assert.equal(opts.detached, process.platform !== "win32");
  assert.deepEqual(lines, [["stdout", "Created config/acme.yaml. Still to fill in"], ["stderr", "Microsoft Edge is open on https://x: sign in"], ["stderr", "partial"]]);
  assert.ok(output.lines.includes("  Created config/acme.yaml. Still to fill in"));
  assert.ok(output.lines.some((l) => /^ {2}exit 0 in \d+ ms$/.test(l)));
});

test("runStreaming: a framework script, or another installed framework in another folder (atf init)", async () => {
  const { cli, calls } = setup(reply(""));
  await cli.runStreaming(["/ws/config/acme.yaml", "--fix", "--json"], { script: path.join(FW, "scripts", "doctor.mjs") });
  await cli.runStreaming(["init"], { cwd: "/new", framework: "/new/node_modules/@testagentic/atf" });
  assert.deepEqual(calls[0].argv, [path.join(FW, "scripts", "doctor.mjs"), "/ws/config/acme.yaml", "--fix", "--json"]);
  assert.deepEqual([calls[1].argv, calls[1].opts.cwd], [[path.join("/new/node_modules/@testagentic/atf", "bin", "atf.mjs"), "init"], "/new"]);
  const none = setup(reply(""), { workspace: { root: null, framework: null, message: "atf: no workspace" } });
  await none.cli.runStreaming(["init"], { cwd: "/new", framework: "/new/node_modules/@testagentic/atf" });
  assert.equal(none.calls.length, 1, "init needs no workspace yet, only the framework in its folder");
});

test("runStreaming: a cancel kills the process tree (its group on POSIX, taskkill /T on Windows)", async () => {
  const killed = [];
  const posix = setup((child) => (child.pid = 4242), { platform: "linux", killProcess: (pid, sig) => (killed.push([pid, sig]), posix.calls[0].child.emit("close", null)) });
  const token = fakeToken();
  const p = posix.cli.runStreaming(["config", "acme", "--url", "https://x"], { token });
  await tick();
  assert.equal(posix.calls[0].opts.detached, true);
  token.cancel();
  assert.deepEqual(await p, { code: null, cancelled: true });
  assert.deepEqual(killed, [[-4242, "SIGTERM"]]);
  assert.ok(posix.output.lines.some((l) => l.includes("exit (cancelled)")));

  const win = setup(
    (child, { cmd }) => {
      if (cmd === "taskkill") return win.calls[0].child.emit("close", 1);
      child.pid = 77;
    },
    { platform: "win32" },
  );
  const t2 = fakeToken();
  const q = win.cli.runStreaming(["config", "acme", "--url", "https://x"], { token: t2 });
  await tick();
  assert.equal(win.calls[0].opts.detached, false);
  t2.cancel();
  assert.deepEqual(await q, { code: 1, cancelled: true });
  assert.deepEqual([win.calls[1].cmd, win.calls[1].argv], ["taskkill", ["/pid", "77", "/T", "/F"]]);

  // an already cancelled token spawns nothing
  const early = setup(reply(""));
  const t3 = fakeToken();
  t3.isCancellationRequested = true;
  assert.deepEqual(await early.cli.runStreaming(["config", "acme", "--url", "https://x"], { token: t3 }), { code: null, cancelled: true });
  assert.equal(early.calls.length, 0);
});

test("runStreaming refuses human-only commands and a missing framework without spawning", async () => {
  const { cli, calls } = setup(reply(""));
  for (const args of [["approve", "acme", "contacts"], ["sweep", "acme"], ["import", "acme", "contacts", "--approved"], ["eject", "config"]]) await assert.rejects(cli.runStreaming(args), REFUSED, args.join(" "));
  await assert.rejects(cli.runStreaming(["sweep", "acme"], { script: "scripts/ledger.mjs" }), REFUSED);
  assert.equal(calls.length, 0);
  const none = setup(reply(""), { workspace: { root: "/ws", framework: null, message: "atf: install it" } });
  await assert.rejects(none.cli.runStreaming(["config", "acme", "--url", "https://x"]), /install it/);
  assert.equal(none.calls.length, 0);
});

// ---- the confirmation file and confirmedRun -------------------------------------------------------------------------------

// a workspace with the folders the confirmations live in: the module's testcases/ and the environments' state/
function confirmWorkspace() {
  const root = tmp();
  for (const d of ["artifacts/acme/modules/contacts/testcases", "artifacts/acme/state", "artifacts/acme/envs/uat/state"]) mkdirSync(path.join(root, ...d.split("/")), { recursive: true });
  return root;
}

test("the confirmation's paths and body: the framework's one path per action, exactly its keys", () => {
  const root = "/ws";
  assert.equal(approvalConfirmFile(root, "acme", "contacts"), path.join(root, "artifacts", "acme", "modules", "contacts", "testcases", APPROVAL_CONFIRM));
  assert.equal(sweepConfirmFile(root, "acme"), path.join(root, "artifacts", "acme", "state", SWEEP_CONFIRM));
  assert.equal(sweepConfirmFile(root, "acme", "uat"), path.join(root, "artifacts", "acme", "envs", "uat", "state", SWEEP_CONFIRM));
  const now = Date.parse("2026-10-29T10:00:00.000Z");
  const a = confirmationBody({ action: "approve", product: "acme", module: "contacts", typed: "contacts", now, nonce: "n".repeat(32) });
  assert.deepEqual(a, { action: "approve", product: "acme", module: "contacts", environment: "default", typed: "contacts", nonce: "n".repeat(32), createdAt: "2026-10-29T10:00:00.000Z", expiresAt: "2026-10-29T10:02:00.000Z" });
  const s = confirmationBody({ action: "sweep", product: "acme", environment: "uat", typed: "acme", now });
  assert.deepEqual(Object.keys(s), ["action", "product", "environment", "typed", "nonce", "createdAt", "expiresAt"], "a sweep names no module");
  assert.match(s.nonce, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(Date.parse(s.expiresAt) - Date.parse(s.createdAt), CONFIRM_LIFETIME_MS);
  assert.ok(CONFIRM_LIFETIME_MS <= 120_000, "the framework's limit");
  assert.ok(JSON.stringify(s).length < 4096);
  for (const [action, t, why] of [
    ["approve", { product: "acme" }, /module/],
    ["approve", { product: "../x", module: "m" }, /product/],
    ["sweep", { product: "acme", environment: "UAT" }, /environment/],
    ["sweep", { product: "acme", run: "../r" }, /run/],
    ["import", { product: "acme" }, /unknown/],
  ])
    assert.match(confirmTargetProblem(action, t), why);
  assert.equal(confirmTargetProblem("sweep", { product: "acme", run: "acme-run-1" }), null);
});

test("writeConfirmation: exclusive, owner-only, and never through a link someone left at the path", () => {
  const root = confirmWorkspace();
  const file = approvalConfirmFile(root, "acme", "contacts");
  writeConfirmation(file, { a: 1 });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { a: 1 });
  if (process.platform !== "win32") assert.equal(lstatSync(file).mode & 0o777, 0o600);
  writeConfirmation(file, { a: 2 }); // a leftover is replaced, not appended to
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { a: 2 });
  const elsewhere = path.join(root, "elsewhere.json");
  writeFileSync(elsewhere, "keep me");
  const linked = sweepConfirmFile(root, "acme");
  try {
    symlinkSync(elsewhere, linked);
  } catch {
    return; // no symlinks here (Windows without the right): nothing more to show
  }
  writeConfirmation(linked, { b: 1 });
  assert.equal(readFileSync(elsewhere, "utf8"), "keep me", "the link's target is untouched");
  assert.equal(lstatSync(linked).isSymbolicLink(), false);
  assert.throws(() => writeConfirmation(path.join(root, "artifacts", "nope", "state", SWEEP_CONFIRM), {}), /ENOENT/, "its folder must exist");
});

test("confirmedRun: the file written at the framework's path with the right JSON, the exact arguments, then gone", async () => {
  const root = confirmWorkspace();
  const seen = [];
  const { cli, calls } = setup(
    (child, { argv }) => {
      const at = argv.indexOf("--confirm-file");
      const file = argv[at + 1];
      seen.push({ exists: existsSync(file), body: JSON.parse(readFileSync(file, "utf8")) });
      child.stdout.emit("data", Buffer.from('{\n  "recorded": ["TC-contacts-1"]\n}\n'));
      child.emit("close", 0);
    },
    { workspace: { root, framework: FW } },
  );
  const lines = [];
  const r = await cli.confirmedRun("approve", { product: "acme", module: "contacts" }, { typed: "contacts", onLine: (line, stream) => lines.push({ line, stream }) });
  assert.deepEqual(r, { code: 0, cancelled: false });
  const file = approvalConfirmFile(root, "acme", "contacts");
  assert.deepEqual(calls[0].argv, [path.join(FW, "scripts", "testcases.mjs"), "approve", "acme", "contacts", "--confirm-file", file]);
  assert.deepEqual([calls[0].opts.env.ATF_ENV, calls[0].opts.env.ATF_WORKSPACE, calls[0].opts.shell], ["", root, false]);
  assert.equal(seen[0].exists, true);
  assert.deepEqual(Object.keys(seen[0].body), ["action", "product", "module", "environment", "typed", "nonce", "createdAt", "expiresAt"]);
  assert.deepEqual([seen[0].body.action, seen[0].body.product, seen[0].body.module, seen[0].body.environment, seen[0].body.typed], ["approve", "acme", "contacts", "default", "contacts"]);
  assert.equal(existsSync(file), false, "removed after the run (the script deletes it first; a script that stopped early leaves it)");
  assert.deepEqual(lastJson(lines), { recorded: ["TC-contacts-1"] });

  // sweep: the environment's state folder, its ATF_ENV, and --run when one was picked
  await cli.confirmedRun("sweep", { product: "acme", environment: "uat", run: "acme-run-1" }, { typed: "acme" });
  const sweepFile = sweepConfirmFile(root, "acme", "uat");
  assert.deepEqual(calls[1].argv, [path.join(FW, "scripts", "ledger.mjs"), "sweep", "acme", "--run", "acme-run-1", "--confirm-file", sweepFile]);
  assert.equal(calls[1].opts.env.ATF_ENV, "uat");
  assert.deepEqual([seen[1].body.action, seen[1].body.environment, seen[1].body.typed, seen[1].body.module], ["sweep", "uat", "acme", undefined]);
  assert.equal(existsSync(sweepFile), false);
});

test("confirmedRun: a wrong or missing slug writes nothing and runs nothing; a cancel leaves no file", async () => {
  const root = confirmWorkspace();
  const file = approvalConfirmFile(root, "acme", "contacts");
  const { cli, calls } = setup(reply(""), { workspace: { root, framework: FW } });
  for (const typed of [undefined, "", "Contacts", "contacts ", "acme"]) await assert.rejects(cli.confirmedRun("approve", { product: "acme", module: "contacts" }, { typed }), /not confirmed/, String(typed));
  await assert.rejects(cli.confirmedRun("sweep", { product: "acme" }, { typed: "contacts" }), /not confirmed/);
  await assert.rejects(cli.confirmedRun("approve", { product: "acme", module: "x;y" }, { typed: "x;y" }), /not a slug/);
  assert.equal(calls.length, 0);
  assert.equal(existsSync(file), false);
  // cancelled before it starts: nothing written
  const t = fakeToken();
  t.isCancellationRequested = true;
  assert.deepEqual(await cli.confirmedRun("approve", { product: "acme", module: "contacts" }, { typed: "contacts", token: t }), { code: null, cancelled: true });
  assert.equal(existsSync(file), false);
  // cancelled while it runs: the process is stopped and the file removed
  const killed = [];
  const slow = setup((child) => (child.pid = 99), { workspace: { root, framework: FW }, platform: "linux", killProcess: (pid) => (killed.push(pid), slow.calls[0].child.emit("close", null)) });
  const t2 = fakeToken();
  const p = slow.cli.confirmedRun("approve", { product: "acme", module: "contacts" }, { typed: "contacts", token: t2 });
  await tick();
  assert.equal(existsSync(file), true, "written just before the run");
  t2.cancel();
  assert.deepEqual(await p, { code: null, cancelled: true });
  assert.deepEqual(killed, [-99]);
  assert.equal(existsSync(file), false);
});

test("the confirmed rule: runJson and runStreaming take --confirm-file only for a file confirmedRun wrote for that exact command", async () => {
  const root = confirmWorkspace();
  const file = approvalConfirmFile(root, "acme", "contacts");
  const script = path.join("scripts", "testcases.mjs");
  const args = ["approve", "acme", "contacts", "--confirm-file", file];
  // a file someone else wrote at the very path is not a confirmation
  writeFileSync(file, JSON.stringify(confirmationBody({ action: "approve", product: "acme", module: "contacts", typed: "contacts" })));
  const forged = setup(reply("{}"), { workspace: { root, framework: FW } });
  await assert.rejects(forged.cli.runStreaming(args, { script }), REFUSED);
  await assert.rejects(forged.cli.runJson(args, { script }), REFUSED);
  assert.equal(forged.calls.length, 0);

  // during confirmedRun's own run, its file opens exactly its command and nothing else
  let during;
  let first = true;
  const own = setup(
    async (child) => {
      if (!first) return child.emit("close", 0); // a command started below
      first = false;
      during = await Promise.allSettled([
        own.cli.runStreaming(args, { script }), // the same command again: still confirmed while the file exists, so this one runs too
        own.cli.runStreaming(["approve", "acme", "other", "--confirm-file", file], { script }),
        own.cli.runStreaming(["sweep", "acme", "--confirm-file", file], { script: path.join("scripts", "ledger.mjs") }),
        own.cli.runStreaming([...args, "--confirm-file", file], { script }),
      ]);
      child.emit("close", 0);
    },
    { workspace: { root, framework: FW } },
  );
  await own.cli.confirmedRun("approve", { product: "acme", module: "contacts" }, { typed: "contacts" });
  assert.deepEqual(during.map((d) => d.status), ["fulfilled", "rejected", "rejected", "rejected"]);
  // afterwards the path confirms nothing, even if a file is put back there
  writeFileSync(file, "{}");
  await assert.rejects(own.cli.runStreaming(args, { script }), REFUSED);
});

test("confirmedRun through the framework's own sweep script: the confirmation is accepted and the script's refusal surfaces", async () => {
  const root = confirmWorkspace();
  mkdirSync(path.join(root, "atf"), { recursive: true });
  writeFileSync(path.join(root, "atf", "atf.json"), "{}");
  const vscode = fakeVscode({ config: { nodePath: process.execPath } });
  const cli = createCli({ vscode, workspace: { ok: true, root, framework: CORE }, output: vscode.window.createOutputChannel("atf") });
  const lines = [];
  const r = await cli.confirmedRun("sweep", { product: "acme" }, { typed: "acme", onLine: (line, stream) => lines.push({ line, stream }) });
  const out = lastJson(lines);
  assert.equal(r.code, 1, JSON.stringify(lines));
  assert.ok(out.errors.some((e) => /no run state for 'acme'/.test(e)), JSON.stringify(out));
  assert.ok(!out.errors.some((e) => /confirmation refused/.test(e)), "the file was the framework's, at its path, in time");
  assert.equal(existsSync(sweepConfirmFile(root, "acme")), false, "used once");
});

// ---- the real atf ---------------------------------------------------------------------------------------------------------

let installed;
const installedOnce = async () => {
  if (installed) return installed;
  const { installedWorkspace } = await import(pathToFileURL(path.resolve(CORE, "scripts", "test-helpers.mjs")).href);
  return (installed = installedWorkspace());
};

test("runStreaming through the real atf: config writes the run-config once, and refuses it the second time", async () => {
  const { root, framework } = await installedOnce();
  const vscode = fakeVscode({ config: { nodePath: process.execPath } });
  const output = vscode.window.createOutputChannel("atf");
  const cli = createCli({ vscode, workspace: { ok: true, root, framework }, output });
  const lines = [];
  const args = ["config", "acme-new", "--url", "https://new.example.com", "--no-login"];
  assert.deepEqual(await cli.runStreaming(args, { env: { ATF_ENV: "" }, onLine: (l) => lines.push(l) }), { code: 0, cancelled: false });
  assert.ok(lines.some((l) => l.startsWith("Created config/acme-new.yaml")), lines.join("\n"));
  assert.match(readFileSync(path.join(root, "config", "acme-new.yaml"), "utf8"), /^product: acme-new$/m);
  const again = [];
  const r = await cli.runStreaming(args, { onLine: (l) => again.push(l) });
  assert.notEqual(r.code, 0);
  assert.ok(again.some((l) => /config\/acme-new\.yaml already exists/.test(l)), again.join("\n"));
  assert.ok(existsSync(path.join(root, "config", "acme-new.yaml")));
});

test("cliPlan through the real atf: the doctor pre-check and the first prompt, exactly as the CLI would run them", async () => {
  const { root, framework } = await installedOnce();
  const vscode = fakeVscode({ config: { nodePath: process.execPath } });
  const cli = createCli({ vscode, workspace: { ok: true, root, framework }, output: vscode.window.createOutputChannel("atf") });
  const run = await cli.cliPlan(["run", "acme", "--host", "copilot"]);
  assert.equal(run.steps.length, 2, JSON.stringify(run));
  const [doctor, agent] = run.steps;
  assert.equal(doctor.script, path.join(framework, "scripts", "doctor.mjs"));
  assert.deepEqual(doctor.args, ["config/acme.yaml", "--fix", "--warn-only"]);
  assert.deepEqual(doctor.env, {});
  assert.equal(agent.agent, true);
  assert.match(agent.prompt, /^Start or resume the run for config\/acme\.yaml: node node_modules\/@testagentic\/atf\/scripts\/run\.mjs init config\/acme\.yaml/);
  const { plan } = await import(pathToFileURL(path.join(framework, "scripts", "lib", "cli.mjs")).href);
  assert.equal(agent.prompt, plan(["run", "acme", "--host", "copilot"], { workspace: root, framework }).steps[1].args.at(-1), "the CLI's own prompt, not a copy");
  const resume = await cli.cliPlan(["resume", "acme", "--stage", "explore", "--env", "uat", "--host", "copilot"]);
  assert.match(resume.error ?? "", /No config\/acme-uat\.yaml/);
  const interview = await cli.cliPlan(["interview", "--host", "copilot"]);
  assert.deepEqual(interview.steps.map((s) => Object.keys(s).sort()), [["agent", "prompt"]]);
  const doc = await cli.cliPlan(["doctor", "acme"]);
  assert.deepEqual(doc.steps.map((s) => s.args), [["config/acme.yaml", "--fix"]]);
  await assert.rejects(cli.cliPlan(["approve", "acme", "contacts"]), /human-only; the extension does not plan it/);
});
