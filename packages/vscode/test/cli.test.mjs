// src/cli.js: the human-only rule, node's arguments, the terminal's shell and quoting (POSIX, PowerShell, cmd.exe on
// Windows and elsewhere), runJson over a fake spawn, and runInTerminal over a fake vscode. No VS Code, no real atf.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { CliError, HUMAN_ONLY, createCli, isHumanOnly, nodeArgs, quoteCmd, quotePosix, quotePowerShell, shellKind, terminalLine } from "../src/cli.js";
import { fakeVscode } from "./fake-vscode.mjs";

const FW = path.join(path.sep, "ws", "node_modules", "@testagentic", "atf");

test("the spec's human-only commands, and the scripts behind them, are human-only", () => {
  for (const c of HUMAN_ONLY) assert.equal(isHumanOnly([c, "acme"]), true, c);
  assert.deepEqual(HUMAN_ONLY, ["approve", "sweep", "eject", "init", "migrate", "issues"]);
  assert.equal(isHumanOnly(["import", "acme", "contacts", "--approved"]), true);
  assert.equal(isHumanOnly(["import", "acme", "contacts", "--approved=yes"]), true);
  assert.equal(isHumanOnly(["import", "acme", "contacts", "--file", "cases.xlsx"]), false);
  for (const c of ["status", "next", "run", "resume", "doctor", "sync", "check", "version"]) assert.equal(isHumanOnly([c, "acme"]), false, c);
  assert.equal(isHumanOnly(["approve", "acme", "contacts"], { script: "scripts/testcases.mjs" }), true);
  assert.equal(isHumanOnly(["importCases", "acme"], { script: path.join(FW, "scripts", "testcases.mjs") }), true);
  assert.equal(isHumanOnly(["check", "acme", "contacts"], { script: "scripts/testcases.mjs" }), false);
  assert.equal(isHumanOnly(["sweep", "acme"], { script: "scripts/ledger.mjs" }), true);
  assert.equal(isHumanOnly(["status", "acme"], { script: "scripts/run.mjs" }), false);
  assert.equal(isHumanOnly(["node", path.join(FW, "scripts", "ledger.mjs"), "sweep", "acme"]), true, "the terminal's node form");
  assert.equal(isHumanOnly(["node", path.join(FW, "scripts", "report.mjs"), "render", "acme"]), false);
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

test("the terminal line: npx --no atf, npx.cmd on Windows PowerShell, and the node form", () => {
  const args = ["steps", "acme", "explore,testcases", "--env", "uat"];
  assert.equal(terminalLine(args, { kind: "posix", platform: "darwin" }), "npx --no atf steps acme explore,testcases --env uat");
  assert.equal(terminalLine(args, { kind: "powershell", platform: "win32" }), "npx.cmd --no atf steps acme 'explore,testcases' --env uat");
  assert.equal(terminalLine(args, { kind: "powershell", platform: "linux" }), "npx --no atf steps acme 'explore,testcases' --env uat");
  assert.equal(terminalLine(args, { kind: "cmd", platform: "win32" }), 'npx --no atf steps acme "explore,testcases" --env uat');
  const script = "C:\\w s\\node_modules\\@testagentic\\atf\\scripts\\report.mjs";
  assert.equal(terminalLine(["node", script, "render", "acme"], { kind: "powershell", platform: "win32", node: "C:\\Program Files\\nodejs\\node.exe" }), `& 'C:\\Program Files\\nodejs\\node.exe' '${script}' render acme`);
  assert.equal(terminalLine(["node", script, "render", "acme"], { kind: "cmd", platform: "win32" }), `node "${script}" render acme`);
  assert.equal(terminalLine(["node", "/w s/report.mjs", "render", "acme"], { kind: "posix", platform: "linux" }), "node '/w s/report.mjs' render acme");
  assert.throws(() => terminalLine(["run", "%x%"], { kind: "cmd", platform: "win32" }), /cmd\.exe/);
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
const setup = (script, { config = {}, workspace } = {}) => {
  const vscode = fakeVscode({ config });
  const output = vscode.window.createOutputChannel("atf");
  const s = fakeSpawn(script);
  const cli = createCli({ vscode, workspace: workspace ?? { root: path.join(path.sep, "ws"), framework: FW }, output, spawn: s.spawn, env: { PATH: "/bin", ATF_ENV: "inherited" } });
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

test("runJson refuses human-only commands without spawning, and works only with the framework installed", async () => {
  const { cli, calls } = setup(reply("{}"));
  for (const args of [["approve", "acme", "contacts"], ["sweep", "acme"], ["import", "acme", "contacts", "--approved"], ["init"], ["eject", "config"], ["migrate"], ["issues", "export"]])
    await assert.rejects(cli.runJson(args), /human-only, so it runs only in a terminal you see/, args.join(" "));
  await assert.rejects(cli.runJson(["approve", "acme", "contacts"], { script: "scripts/testcases.mjs" }), /human-only/);
  await assert.rejects(cli.runJson(["sweep", "acme"], { script: "scripts/ledger.mjs" }), /human-only/);
  assert.equal(calls.length, 0);
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

// ---- runInTerminal over a fake vscode --------------------------------------------------------------------------------

const terminalCli = ({ platform = "darwin", shell = "/bin/zsh", shellIntegration = false, noIntegrationEvent = false, config = {} } = {}) => {
  const vscode = fakeVscode({ shell, shellIntegration, config });
  if (noIntegrationEvent) delete vscode.window.onDidChangeTerminalShellIntegration;
  const output = vscode.window.createOutputChannel("atf");
  const cli = createCli({ vscode, workspace: { root: "/ws", framework: FW }, output, platform, spawn: () => assert.fail("a terminal command never spawns") });
  return { cli, vscode };
};

test("human-only commands go to a terminal the human sees, in the workspace, through shell integration", async () => {
  const { cli, vscode } = terminalCli({ shellIntegration: true });
  const t = await cli.runInTerminal(["approve", "acme", "contacts"], { name: "approve contacts" });
  assert.equal(t.opts.name, "atf: approve contacts");
  assert.equal(t.opts.cwd, "/ws");
  assert.equal(t.opts.shellPath, "/bin/zsh", "the shell quoted for is the shell that runs");
  assert.equal(t.shown, true);
  assert.deepEqual(t.executed, ["npx --no atf approve acme contacts"]);
  assert.deepEqual(t.sent, []);
  assert.equal(vscode.rec.terminals.length, 1);
});

test("without shell integration the line is sent as text; Windows shells get their own quoting", async () => {
  const posix = terminalCli({ noIntegrationEvent: true });
  const t1 = await posix.cli.runInTerminal(["sweep", "acme", "--dry-run"], { name: "sweep" });
  assert.deepEqual(t1.sent, [["npx --no atf sweep acme --dry-run", true]]);

  const ps = terminalCli({ platform: "win32", shell: "C:\\Program Files\\PowerShell\\7\\pwsh.exe", noIntegrationEvent: true });
  const t2 = await ps.cli.runInTerminal(["import", "acme", "contacts", "--file", "C:\\cases\\my cases.xlsx", "--approved"], { name: "import" });
  assert.deepEqual(t2.sent, [["npx.cmd --no atf import acme contacts --file 'C:\\cases\\my cases.xlsx' --approved", true]]);

  const cmd = terminalCli({ platform: "win32", shell: "C:\\Windows\\System32\\cmd.exe", noIntegrationEvent: true });
  const t3 = await cmd.cli.runInTerminal(["steps", "acme", "explore,testcases"], { name: "steps", env: { ATF_ENV: "uat" } });
  assert.deepEqual(t3.sent, [['npx --no atf steps acme "explore,testcases"', true]]);
  assert.deepEqual(t3.opts.env, { ATF_ENV: "uat" });
  await assert.rejects(cmd.cli.runInTerminal(["run", "%PATH%"]), /cmd\.exe/);
  assert.equal(cmd.vscode.rec.terminals.length, 1, "nothing is opened for a line that can't be quoted");
});

test("a node script runs in the terminal with the configured Node.js", async () => {
  const { cli } = terminalCli({ noIntegrationEvent: true, config: { nodePath: "/opt/my node/node" } });
  const t = await cli.runInTerminal(["node", "/ws/node_modules/@testagentic/atf/scripts/report.mjs", "render", "acme"], { name: "report", cwd: "/elsewhere" });
  assert.deepEqual(t.sent, [["'/opt/my node/node' /ws/node_modules/@testagentic/atf/scripts/report.mjs render acme", true]]);
  assert.equal(t.opts.cwd, "/elsewhere");
});
