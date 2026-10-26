// atf sync, atf check, the postinstall and the doctor's host-files check (docs/packaging.md §3.3, §3.6), on a client's
// workspace with the framework installed (test-helpers installedWorkspace()) and on a source checkout like the
// monorepo, whose generated files stay committed (D-018). Nothing here builds the monorepo's own host files.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { USAGE, main, plan, postinstall, run } from "./lib/cli.mjs";
import { runChecks } from "./lib/doctor.mjs";
import { frameworkRoot, workspaceRoot } from "./lib/roots.mjs";
import { BLOCK_END, BLOCK_START, CLIENT_IGNORED, generatedAgentFiles, gitignoreBlock, ignoredEntries, sync, withGitignoreBlock } from "./lib/sync.mjs";
import { INSTALLED_PACKAGE, installedWorkspace, put, tempRoot } from "./test-helpers.mjs";

const HOOKS = `${INSTALLED_PACKAGE}/scripts/hooks/`;
const read = (root, rel) => readFileSync(path.join(root, rel), "utf8");
const capture = () => {
  const lines = [];
  return { lines, out: { log: (m) => lines.push(m), error: (m) => lines.push(`stderr: ${m}`) } };
};
// atf <argv> in-process, against a given workspace and framework -> { code, lines }
const atf = (argv, { root, framework }) => {
  const { lines, out } = capture();
  return { code: run(plan(argv, { workspace: root, framework, env: {} }), { workspace: root, out }), lines };
};
// the real thing, as npm and a human start it: the installed copy's own bin, so its framework root is its own location
const bin = (framework, argv, { cwd, env = {} }) => {
  const r = spawnSync(process.execPath, [path.join(framework, "bin", "atf.mjs"), ...argv], { cwd, encoding: "utf8", env: { ...process.env, ATF_WORKSPACE: "", ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const listed = (root, dir) => (existsSync(path.join(root, dir)) ? readdirSync(path.join(root, dir)) : []);
// the block a sync writes for this workspace's roster
const blockOf = (ws) => gitignoreBlock(ignoredEntries(generatedAgentFiles({ workspace: ws.root, framework: ws.framework })));

test("atf sync renders the client's host files from the installed package, with the overlay and the .gitignore block", () => {
  const ws = installedWorkspace();
  const { code, lines } = atf(["sync"], ws);
  assert.equal(code, 0, lines.join("\n"));
  // every hook command runs the installed package's hook entry, by its path from the workspace
  const settings = JSON.parse(read(ws.root, ".claude/settings.json"));
  const commands = [
    ...settings.hooks.PreToolUse.flatMap((m) => m.hooks.map((h) => h.command)),
    ...settings.hooks.PostToolUse.flatMap((m) => m.hooks.map((h) => h.command)),
    ...[".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"].flatMap((f) => Object.values(JSON.parse(read(ws.root, f)).hooks).flat().map((h) => h.command)),
  ];
  assert.equal(commands.length, 6);
  for (const c of commands) assert.ok(c.includes(`${HOOKS}pretooluse.mjs`) || c.includes(`${HOOKS}posttooluse.mjs`), c);
  assert.match(read(ws.root, ".github/hooks/framework-guard.json"), /"node node_modules\/@testagentic\/atf\/scripts\/hooks\/pretooluse\.mjs --host copilot"/);
  // the agents, both hosts, with the overlay atf/models.yaml applied to one of them only
  assert.ok(listed(ws.root, ".claude/agents").length > 30);
  assert.equal(listed(ws.root, ".claude/agents").length, listed(ws.root, ".github/agents").length);
  assert.match(read(ws.root, ".claude/agents/report-generator.md"), /^model: haiku$/m);
  assert.doesNotMatch(read(ws.root, ".claude/agents/orchestrator-agent.md"), /^model: haiku$/m);
  assert.match(read(ws.root, ".claude/agents/orchestrator-agent.md"), /node node_modules\/@testagentic\/atf\/scripts\/run\.mjs/);
  assert.match(read(ws.root, ".mcp.json"), /node_modules\/@testagentic\/atf\/scripts\/browser\/init-page\.cjs/);
  assert.ok(existsSync(path.join(ws.root, ".vscode/mcp.json")));
  assert.equal(existsSync(path.join(ws.root, ".vscode/settings.json")), false, "the build never writes .vscode/settings.json");
  // the .gitignore block, created with the file
  assert.equal(read(ws.root, ".gitignore"), `${blockOf(ws).join("\n")}\n`);
  assert.deepEqual(CLIENT_IGNORED, [".mcp.json", ".vscode/mcp.json", ".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"]);
  assert.doesNotMatch(read(ws.root, ".gitignore"), /settings\.json/, ".claude/settings.json and .vscode/settings.json are the client's to commit");
  // what changed, one line each, then a count
  assert.ok(lines.includes("atf sync: updated: .claude/agents/report-generator.md"));
  assert.ok(lines.includes("atf sync: updated: .gitignore"));
  assert.match(lines.at(-1), /^atf sync: \d+ file\(s\) updated\.$/);
  // a second sync changes nothing
  assert.deepEqual(atf(["sync"], ws), { code: 0, lines: ["atf sync: the host files are up to date."] });
});

test("the .gitignore block is updated in place; the client's own lines, and their line endings, are never touched", () => {
  const ws = installedWorkspace();
  const mine = ["# my repo", "node_modules/", ".env", ""];
  put(ws.root, ".gitignore", `${mine[0]}\n${mine[1]}\n${mine[2]}`); // no final newline
  assert.equal(atf(["sync"], ws).code, 0);
  assert.equal(read(ws.root, ".gitignore"), `# my repo\nnode_modules/\n.env\n\n${blockOf(ws).join("\n")}\n`);
  // an older block (other wording, other entries) between the client's lines: replaced where it stands
  const old = ["# >>> atf sync: an older wording", "/.mcp.json", "/something-retired/", BLOCK_END];
  writeFileSync(path.join(ws.root, ".gitignore"), ["# top", ...old, "# after", "dist/", ""].join("\n"));
  const { code, lines } = atf(["sync"], ws);
  assert.equal(code, 0);
  assert.deepEqual(lines, ["atf sync: updated: .gitignore", "atf sync: 1 file(s) updated."]);
  assert.equal(read(ws.root, ".gitignore"), ["# top", ...blockOf(ws), "# after", "dist/", ""].join("\n"));
  // CRLF stays CRLF
  writeFileSync(path.join(ws.root, ".gitignore"), "# windows\r\nbin/\r\n");
  assert.equal(atf(["sync"], ws).code, 0);
  assert.equal(read(ws.root, ".gitignore"), `# windows\r\nbin/\r\n\r\n${blockOf(ws).join("\r\n")}\r\n`);
  assert.deepEqual(atf(["sync"], ws).lines, ["atf sync: the host files are up to date."]);
});

test("withGitignoreBlock: an empty file, an existing block, and a malformed block it refuses to guess about", () => {
  const E = ["a.json", "b/c.md"];
  assert.equal(withGitignoreBlock("", E).text, `${gitignoreBlock(E).join("\n")}\n`);
  assert.equal(withGitignoreBlock("a\n", E).text, `a\n\n${gitignoreBlock(E).join("\n")}\n`);
  assert.equal(withGitignoreBlock(withGitignoreBlock("a\n", E).text, E).text, withGitignoreBlock("a\n", E).text, "idempotent");
  assert.deepEqual(gitignoreBlock(["x.json"]), [BLOCK_START, "/x.json", BLOCK_END], "one list, filtered by phase 3c's opt-in");
  assert.deepEqual(gitignoreBlock(["a*b?[c]\\d.md"]), [BLOCK_START, "/a\\*b\\?\\[c]\\\\d.md", BLOCK_END], "a literal path, its glob characters escaped");
  assert.deepEqual(ignoredEntries(["z.md", ".mcp.json", ".claude/a.md"]), [".claude/a.md", ".github/hooks/framework-guard.json", ".mcp.json", ".vscode/hooks/framework-guard.json", ".vscode/mcp.json", "z.md"], "sorted, without duplicates");
  for (const bad of [`${BLOCK_START}\n/x\n`, `/x\n${BLOCK_END}\n`, `${BLOCK_END}\n${BLOCK_START}\n`, `${BLOCK_START}\n${BLOCK_END}\n${BLOCK_START}\n${BLOCK_END}\n`])
    assert.match(withGitignoreBlock(bad, E).error, /the atf sync block is malformed/, JSON.stringify(bad));
});

// The block's own patterns as git reads them: anchored at the workspace root, glob characters escaped, a trailing `/` a
// folder (none since phase 3b, but an old block had two)
const ignoredBy = (block, rel) =>
  block.slice(1, -1).some((p) => {
    const lit = p.slice(1).replace(/\\(.)/g, "$1");
    return lit.endsWith("/") ? rel.startsWith(lit) : rel === lit;
  });
// git with no system, global or XDG config of the machine's (a global excludesFile would change the answer)
const git = (args, cwd) =>
  spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(cwd, ".no-gitconfig"), XDG_CONFIG_HOME: path.join(cwd, ".no-xdg") } });

test("the .gitignore block lists each of the framework's agent files and no folder, so a client's own agents stay in git", (t) => {
  const ws = installedWorkspace();
  // a client's own agents, one per host, beside the framework's: the build leaves them alone (no GENERATED marker)
  const own = (name) => `---\nname: ${name}\ndescription: "The client's own agent."\n---\n\nYou do the client's own thing.\n`;
  const mine = { ".claude/agents/my-helper.md": own("my-helper"), ".github/agents/my-helper.agent.md": own("my-helper") };
  for (const [rel, text] of Object.entries(mine)) put(ws.root, rel, text);
  assert.equal(atf(["sync"], ws).code, 0);
  const lines = read(ws.root, ".gitignore").split("\n");
  const block = lines.slice(lines.indexOf(BLOCK_START), lines.indexOf(BLOCK_END) + 1);
  // every agent file the build wrote, each on its own line, with the other whole files as before, sorted
  const generated = [".claude/agents", ".github/agents"].flatMap((dir) => listed(ws.root, dir).map((f) => `${dir}/${f}`)).filter((rel) => !Object.hasOwn(mine, rel));
  assert.ok(generated.length > 60, `${generated.length} agent files`);
  assert.deepEqual(block.slice(1, -1), [...generated, ...CLIENT_IGNORED].map((e) => `/${e}`).sort());
  assert.deepEqual(block, blockOf(ws), "the roster's files, both hosts");
  assert.ok(block.slice(1, -1).every((e) => !e.endsWith("/")), "no folder");
  // the client's own agents: kept by the build, and not ignored
  for (const [rel, text] of Object.entries(mine)) {
    assert.equal(read(ws.root, rel), text);
    assert.equal(ignoredBy(block, rel), false, rel);
  }
  assert.ok(ignoredBy(block, ".claude/agents/report-generator.md") && ignoredBy(block, ".github/agents/report-generator.agent.md"));
  // and git agrees, where git is installed
  const init = git(["init", "-q"], ws.root);
  if (init.error || init.status !== 0) return t.skip(`git is not available: ${init.error?.message ?? init.stderr}`);
  const asked = [...Object.keys(mine), ".claude/agents/report-generator.md", ".github/agents/report-generator.agent.md", ".claude/settings.json"];
  const r = git(["check-ignore", "--", ...asked], ws.root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), [".claude/agents/report-generator.md", ".github/agents/report-generator.agent.md"]);
});

test("an older block that ignored the agent folders whole: atf check flags it, atf sync replaces it in place", () => {
  const ws = installedWorkspace();
  assert.equal(atf(["sync"], ws).code, 0);
  // phase 3a's block, between the client's own lines
  const old = [BLOCK_START, "/.claude/agents/", "/.github/agents/", "/.mcp.json", "/.vscode/mcp.json", "/.github/hooks/framework-guard.json", "/.vscode/hooks/framework-guard.json", BLOCK_END];
  writeFileSync(path.join(ws.root, ".gitignore"), ["node_modules/", ...old, ".env", ""].join("\n"));
  assert.deepEqual(atf(["check"], ws), { code: 1, lines: ["atf check: out of date: .gitignore", "stderr: 1 host file(s) out of date with the framework: run npx atf sync."] });
  assert.deepEqual(atf(["sync"], ws).lines, ["atf sync: updated: .gitignore", "atf sync: 1 file(s) updated."]);
  assert.equal(read(ws.root, ".gitignore"), ["node_modules/", ...blockOf(ws), ".env", ""].join("\n"));
  assert.doesNotMatch(read(ws.root, ".gitignore"), /agents\/$/m);
  assert.deepEqual(atf(["check"], ws), { code: 0, lines: ["atf check: the host files are in sync with the framework."] });
});

test("the block follows the roster: an agent the package adds or drops changes it on the next sync", () => {
  const ws = installedWorkspace();
  assert.equal(atf(["sync"], ws).code, 0);
  const files = [".claude/agents/extra-helper.md", ".github/agents/extra-helper.agent.md"];
  const entry = (rel) => new RegExp(`^/${rel.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m");
  // a package update that adds an agent: its source and its permissions row (agents: is the file's last mapping)
  const perms = path.join(ws.framework, "config", "permissions.yaml");
  const base = readFileSync(perms, "utf8");
  put(ws.framework, "agents/extra-helper.md", `---\nname: extra-helper\ndescription: "A test-only agent."\n---\n\nYou do one small thing.\n`);
  writeFileSync(perms, `${base.trimEnd()}\n\n  extra-helper:\n    layer: 1\n    spawns: []\n    filesystem: { read: [], write: [] }\n`);
  let r = atf(["check"], ws);
  assert.equal(r.code, 1, r.lines.join("\n"));
  for (const f of [".gitignore", ...files]) assert.ok(r.lines.includes(`atf check: out of date: ${f}`), f);
  assert.equal(atf(["sync"], ws).code, 0);
  for (const f of files) assert.match(read(ws.root, ".gitignore"), entry(f));
  // a later update drops it: its files go, and so do its lines
  writeFileSync(perms, base);
  rmSync(path.join(ws.framework, "agents", "extra-helper.md"));
  r = atf(["check"], ws);
  for (const f of [".gitignore", ...files]) assert.ok(r.lines.includes(`atf check: out of date: ${f}`), f);
  assert.equal(atf(["sync"], ws).code, 0);
  for (const f of files) {
    assert.doesNotMatch(read(ws.root, ".gitignore"), entry(f));
    assert.equal(existsSync(path.join(ws.root, f)), false, f);
  }
  assert.equal(read(ws.root, ".gitignore"), `${blockOf(ws).join("\n")}\n`);
});

test("sync writes nothing on an error: a bad overlay, a malformed block", () => {
  const ws = installedWorkspace();
  put(ws.root, "atf/models.yaml", "- not\n- a mapping\n");
  const { code, lines } = atf(["sync"], ws);
  assert.equal(code, 1);
  assert.ok(lines.some((l) => /^stderr: atf sync: error: .*atf\/models\.yaml/.test(l)), lines.join("\n"));
  assert.equal(lines.at(-1), "stderr: Nothing was written. Fix the error above, then run npx atf sync again.");
  for (const f of [".claude", ".github", ".vscode", ".mcp.json", ".gitignore"]) assert.equal(existsSync(path.join(ws.root, f)), false, f);

  const ok = installedWorkspace();
  put(ok.root, ".gitignore", `mine/\n${BLOCK_START}\n/.mcp.json\n`);
  const r = atf(["sync"], ok);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /^stderr: atf sync: error: \.gitignore: the atf sync block is malformed/);
  assert.equal(existsSync(path.join(ok.root, ".claude")), false);
  assert.equal(read(ok.root, ".gitignore"), `mine/\n${BLOCK_START}\n/.mcp.json\n`);
});

test("atf check: 0 when in sync; 1 with the fix after a hand edit, a changed overlay or a build error", () => {
  const ws = installedWorkspace();
  let r = atf(["check"], ws);
  assert.equal(r.code, 1, "nothing synced yet");
  assert.ok(r.lines.includes("atf check: out of date: .gitignore"));
  assert.equal(r.lines.at(-1), `stderr: ${r.lines.length - 1} host file(s) out of date with the framework: run npx atf sync.`);
  assert.equal(existsSync(path.join(ws.root, ".claude")), false, "check writes nothing");
  assert.equal(atf(["sync"], ws).code, 0);
  assert.deepEqual(atf(["check"], ws), { code: 0, lines: ["atf check: the host files are in sync with the framework."] });
  // a hand edit of a generated file
  const agent = path.join(ws.root, ".claude/agents/report-generator.md");
  writeFileSync(agent, `${readFileSync(agent, "utf8")}\nmy note\n`);
  assert.deepEqual(atf(["check"], ws), { code: 1, lines: ["atf check: out of date: .claude/agents/report-generator.md", "stderr: 1 host file(s) out of date with the framework: run npx atf sync."] });
  assert.equal(atf(["sync"], ws).code, 0);
  // the overlay changed after the last sync
  put(ws.root, "atf/models.yaml", "agents:\n  report-generator:\n    claude: sonnet\n");
  assert.deepEqual(atf(["check"], ws).lines, ["atf check: out of date: .claude/agents/report-generator.md", "stderr: 1 host file(s) out of date with the framework: run npx atf sync."]);
  // an overlay that can't be read: an error, not drift
  put(ws.root, "atf/models.yaml", "agents: [\n");
  r = atf(["check"], ws);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /^stderr: atf check: error: /);
  assert.equal(r.lines.at(-1), "stderr: Fix the error above, then run npx atf sync.");
});

test("in a source checkout (the monorepo) sync is the same build, without a .gitignore block (D-018)", () => {
  const root = tempRoot();
  put(root, "atf/atf.json", "{}\n");
  const ws = { root, framework: frameworkRoot };
  assert.equal(atf(["sync"], ws).code, 0);
  assert.ok(existsSync(path.join(root, ".claude/agents/report-generator.md")));
  assert.match(read(root, ".github/hooks/framework-guard.json"), /scripts\/hooks\/pretooluse\.mjs --host copilot/);
  assert.equal(existsSync(path.join(root, ".gitignore")), false);
  assert.deepEqual(atf(["check"], ws).code, 0);
  // the monorepo itself, checked only (never built here): never a .gitignore block, whatever else differs
  const mono = sync({ workspace: workspaceRoot, framework: frameworkRoot, check: true });
  assert.equal(mono.installed, false);
  assert.ok(!mono.changed.includes(".gitignore"));
});

test("atf sync and atf check parse strictly, and are in the usage", () => {
  const ws = installedWorkspace();
  const err = (...argv) => plan(argv, { workspace: ws.root, framework: ws.framework, env: {} }).error;
  assert.match(err("check", "--postinstall"), /Unknown option '--postinstall'/, "--postinstall is a flag of sync only");
  assert.match(err("sync", "extra"), /unexpected 'extra'/);
  assert.match(err("sync", "--check"), /Unknown option '--check'/);
  assert.deepEqual(plan(["check"], { workspace: ws.root, framework: ws.framework }).steps, [{ sync: { workspace: ws.root, framework: ws.framework, check: true } }]);
  assert.match(USAGE, /atf sync\b/);
  assert.match(USAGE, /atf check\b/);
});

test("the postinstall skips a framework that is not installed, silently, so npm ci never rebuilds the monorepo's files", () => {
  const root = tempRoot();
  put(root, "atf/atf.json", "{}\n");
  const { lines, out } = capture();
  assert.equal(postinstall(["sync", "--postinstall"], { ctx: { env: { INIT_CWD: root }, framework: frameworkRoot }, out }), 0);
  assert.deepEqual(lines, []);
  // the monorepo's own bin, as npm runs it from packages/core: nothing printed, nothing written anywhere
  const r = bin(frameworkRoot, ["sync", "--postinstall"], { cwd: frameworkRoot, env: { INIT_CWD: root } });
  assert.deepEqual(r, { code: 0, stdout: "", stderr: "" });
  assert.deepEqual(readdirSync(root).sort(), ["atf", "config"]);
});

test("the postinstall finds the workspace from INIT_CWD, also from a subfolder, and renders it", () => {
  const ws = installedWorkspace();
  mkdirSync(path.join(ws.root, "config", "deep"));
  // npm runs it in the package's own folder; INIT_CWD is where `npm install` was typed
  const r = bin(ws.framework, ["sync", "--postinstall"], { cwd: ws.framework, env: { INIT_CWD: path.join(ws.root, "config", "deep") } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /atf sync \(postinstall\): \d+ file\(s\) updated\./);
  assert.match(read(ws.root, ".claude/agents/report-generator.md"), /^model: haiku$/m);
  assert.ok(read(ws.root, ".gitignore").includes(BLOCK_START));
  // and a human's atf sync and atf check from a subfolder, with the installed bin: the same files
  assert.deepEqual(bin(ws.framework, ["sync"], { cwd: path.join(ws.root, "config") }), { code: 0, stdout: "atf sync: the host files are up to date.\n", stderr: "" });
  assert.equal(bin(ws.framework, ["check"], { cwd: ws.root }).code, 0);
});

test("the postinstall exits 0 whatever happens: no workspace yet, a framework from elsewhere, an error", () => {
  const ws = installedWorkspace();
  const nowhere = tempRoot();
  // before atf init: one hint
  let r = bin(ws.framework, ["sync", "--postinstall"], { cwd: ws.framework, env: { INIT_CWD: nowhere } });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `atf: no atf workspace at ${nowhere} (no atf/atf.json there or above): run npx atf init to create one; it renders the host files.\n`);
  // a package installed outside the workspace (say, globally) never writes its paths into it
  const other = installedWorkspace();
  const { lines, out } = capture();
  assert.equal(postinstall(["sync", "--postinstall"], { ctx: { env: { INIT_CWD: other.root }, framework: ws.framework }, out }), 0);
  assert.match(lines[0], /is not installed in .*run npx atf sync from the workspace\.$/);
  assert.equal(existsSync(path.join(other.root, ".claude")), false);
  // a build error: printed with the fix, the install still succeeds, nothing written
  put(ws.root, "atf/models.yaml", "agents: [\n");
  r = bin(ws.framework, ["sync", "--postinstall"], { cwd: ws.framework, env: { INIT_CWD: ws.root } });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /atf sync \(postinstall\): error: .*atf\/models\.yaml/);
  assert.match(r.stderr, /the host files were not updated; your install itself succeeded\. Fix the error above, then run npx atf sync\.\n$/);
  assert.equal(existsSync(path.join(ws.root, ".claude")), false);
  assert.equal(existsSync(path.join(ws.root, ".gitignore")), false);
  // an exception, and a usage error, are printed and still exit 0
  const thrown = capture();
  put(ws.root, "atf/models.yaml", "agents: {}\n");
  assert.equal(postinstall(["sync", "--postinstall"], { ctx: { env: { INIT_CWD: ws.root }, framework: ws.framework }, out: { log() { throw new Error("boom"); }, error: thrown.out.error } }), 0);
  assert.deepEqual(thrown.lines, ["stderr: atf sync (postinstall): boom. Your install itself succeeded; run npx atf sync from your workspace."]);
  const usage = capture();
  assert.equal(postinstall(["sync", "--postinstall", "--nope"], { out: usage.out }), 0);
  assert.match(usage.lines[0], /^stderr: atf sync \(postinstall\): .*Unknown option '--nope'.*Run npx atf sync from your workspace\.$/);
  assert.equal(main(["sync", "--postinstall", "--nope"], { out: usage.out }), 0, "main() takes the same path");
});

test("doctor: an installed framework's host files must be in sync with it (base group), with the fix npx atf sync", async () => {
  const ws = installedWorkspace();
  const hostCheck = async (opts) => (await runChecks({ product: "acme" }, ["base"], opts)).find((c) => c.id === "host-files");
  let c = await hostCheck({ root: ws.root, framework: ws.framework });
  assert.equal(c.ok, false, "never synced: npm install --ignore-scripts");
  assert.equal(c.level, "fail");
  assert.equal(c.group, "base");
  assert.match(c.detail, /^\d+ host file\(s\) out of date with the installed framework: .* and \d+ more$/);
  assert.equal(c.fix, "npx atf sync (in the workspace)");
  assert.equal(c.autofix, undefined, "a human runs the sync");
  assert.equal(atf(["sync"], ws).code, 0);
  c = await hostCheck({ root: ws.root, framework: ws.framework });
  assert.deepEqual({ ok: c.ok, detail: c.detail }, { ok: true, detail: "host files in sync with the installed framework" });
  put(ws.root, "atf/models.yaml", "agents: [\n");
  c = await hostCheck({ root: ws.root, framework: ws.framework });
  assert.equal(c.ok, false);
  assert.match(c.detail, /^the host files can't be rendered from the installed framework: .*atf\/models\.yaml/);
  // a source checkout's files are committed and checked by npm run check instead
  assert.equal(await hostCheck({ root: tempRoot(), framework: frameworkRoot }), undefined);
});

test("atf sync and atf check keep the client's own Claude hooks, and stop at an MCP server added by hand, pointing at atf/mcp.yaml", () => {
  const ws = installedWorkspace();
  const lint = { matcher: "Edit|Write", hooks: [{ type: "command", command: "npm run lint --silent" }] };
  put(ws.root, ".claude/settings.json", JSON.stringify({ hooks: { PostToolUse: [lint] } }));
  assert.equal(atf(["sync"], ws).code, 0);
  let { hooks } = JSON.parse(read(ws.root, ".claude/settings.json"));
  assert.match(hooks.PreToolUse[0].hooks[0].command, new RegExp(`${HOOKS}pretooluse\\.mjs" --host claude-code$`));
  assert.deepEqual(hooks.PostToolUse.slice(1), [lint]);
  assert.deepEqual(atf(["check"], ws), { code: 0, lines: ["atf check: the host files are in sync with the framework."] });
  // a server added to .mcp.json by hand: both commands stop, naming it, and nothing is written
  const mcp = JSON.parse(read(ws.root, ".mcp.json"));
  mcp.mcpServers.jira = { command: "npx", args: ["-y", "@acme/mcp-jira"] };
  put(ws.root, ".mcp.json", JSON.stringify(mcp));
  const settings = read(ws.root, ".claude/settings.json");
  for (const verb of ["sync", "check"]) {
    const r = atf([verb], ws);
    assert.equal(r.code, 1, verb);
    assert.ok(r.lines.some((l) => l.includes(`.mcp.json: MCP server 'jira' is yours`) && l.includes("add it under 'servers:' in atf/mcp.yaml")), r.lines.join("\n"));
  }
  assert.equal(read(ws.root, ".claude/settings.json"), settings);
  assert.ok(JSON.parse(read(ws.root, ".mcp.json")).mcpServers.jira, "the client's server is still there");
  // moved to the overlay: sync renders it and check passes
  put(ws.root, "atf/mcp.yaml", "servers:\n  jira:\n    command: npx\n    args: ['-y', '@acme/mcp-jira']\n");
  assert.equal(atf(["sync"], ws).code, 0);
  assert.deepEqual(Object.keys(JSON.parse(read(ws.root, ".vscode/mcp.json")).servers), ["playwright", "jira"]);
  assert.equal(atf(["check"], ws).code, 0);
  ({ hooks } = JSON.parse(read(ws.root, ".claude/settings.json")));
  assert.deepEqual(hooks.PostToolUse.slice(1), [lint]);
});
