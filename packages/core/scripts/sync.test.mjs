// atf sync, atf check, the postinstall and the doctor's host-files check (docs/packaging.md §3.3, §3.6), on a client's
// workspace with the framework installed (test-helpers installedWorkspace()) and on a source checkout like the
// monorepo, whose generated files stay committed (D-018). Nothing here builds the monorepo's own host files.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { USAGE, main, plan, postinstall, run, versionInfo, versionText } from "./lib/cli.mjs";
import { runChecks } from "./lib/doctor.mjs";
import { frameworkRoot, workspaceRoot } from "./lib/roots.mjs";
import yaml from "js-yaml";
import { BLOCK_END, BLOCK_START, CLIENT_IGNORED, SETUP_TEMPLATE, SETUP_WORKFLOW, claudeModeLine, cloudAgentFiles, cloudAgentOf, generatedAgentFiles, gitignoreBlock, ignoredEntries, pluginSuppliedFiles, setupWorkflowProblem, sync, withGitignoreBlock } from "./lib/sync.mjs";
import { build, pluginSettings } from "./build-agents.mjs";
import { PLUGIN_RECORD, claudeCustomizations, claudeMode, claudePluginOf, marketplaceSource } from "./lib/provenance.mjs";
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
  assert.deepEqual(CLIENT_IGNORED, [".mcp.json", ".vscode/mcp.json", ".agents/mcp_config.json", ".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"]);
  assert.match(read(ws.root, ".gitignore"), /^\/\.agents\/mcp_config\.json$/m, "Antigravity's MCP config is the build's whole file");
  assert.doesNotMatch(read(ws.root, ".gitignore"), /settings\.json/, ".claude/settings.json and .vscode/settings.json are the client's to commit");
  assert.doesNotMatch(read(ws.root, ".gitignore"), /hooks\.json/, ".agents/hooks.json holds the client's own hook sets too: theirs to commit");
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
  assert.deepEqual(ignoredEntries(["z.md", ".mcp.json", ".claude/a.md"]), [".agents/mcp_config.json", ".claude/a.md", ".github/hooks/framework-guard.json", ".mcp.json", ".vscode/hooks/framework-guard.json", ".vscode/mcp.json", "z.md"], "sorted, without duplicates");
  // the cloud-agent opt-in commits only what is under .github/: Antigravity's files stay in the block
  assert.deepEqual(ignoredEntries([".agents/agents/a.md", ".github/agents/a.agent.md"], { cloudAgent: true }), [".agents/agents/a.md", ".agents/mcp_config.json", ".mcp.json", ".vscode/hooks/framework-guard.json", ".vscode/mcp.json"]);
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
  const generated = [".claude/agents", ".github/agents", ".agents/agents"].flatMap((dir) => listed(ws.root, dir).map((f) => `${dir}/${f}`)).filter((rel) => !Object.hasOwn(mine, rel));
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

test("generatedAgentFiles follows each platform's output template, Antigravity's .agents/agents/ included", () => {
  const framework = tempRoot();
  const workspace = tempRoot();
  put(framework, "config/platforms.yaml", 'platforms:\n  claude:\n    output: ".claude/agents/{name}.md"\n  antigravity:\n    output: ".agents/agents/{name}.md"\n    mcp_config: { path: ".agents/mcp_config.json", key: mcpServers }\n');
  const files = generatedAgentFiles({ workspace, framework });
  assert.ok(files.includes(".agents/agents/orchestrator-agent.md") && files.includes(".claude/agents/orchestrator-agent.md"), files.join("\n"));
  assert.equal(files.filter((f) => f.startsWith(".agents/agents/")).length, files.filter((f) => f.startsWith(".claude/agents/")).length);
  const entries = ignoredEntries(files);
  assert.ok(entries.includes(".agents/mcp_config.json") && !entries.includes(".agents/hooks.json"));
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

// ---- the cloud-agent opt-in (atf/atf.json "cloud_agent": true) ---------------------------------------------------

const TEMPLATE = readFileSync(path.join(frameworkRoot, ...SETUP_TEMPLATE.split("/")), "utf8");
const optIn = (root, value = true) => put(root, "atf/atf.json", `${JSON.stringify({ cloud_agent: value })}\n`);
const agentFilesOf = (ws) => generatedAgentFiles({ workspace: ws.root, framework: ws.framework });
const CREATED = `atf sync: created: ${SETUP_WORKFLOW}: the Copilot cloud agent's setup steps, yours from now on. Commit it, merge it to the default branch, and add the Agents secret ATF_NPM_TOKEN.`;
const IN_SYNC = { code: 0, lines: ["atf check: the host files are in sync with the framework."] };

test("the cloud-agent opt-in: the block leaves the Copilot files to git, the setup workflow is written once, and turning it off restores the block", (t) => {
  const ws = installedWorkspace();
  assert.equal(atf(["sync"], ws).code, 0);
  assert.equal(existsSync(path.join(ws.root, SETUP_WORKFLOW)), false, "no opt-in, no workflow");
  optIn(ws.root);
  // check: the block and the missing workflow, nothing written
  assert.deepEqual(atf(["check"], ws), { code: 1, lines: ["atf check: out of date: .gitignore", `atf check: missing: ${SETUP_WORKFLOW} (npx atf sync creates it)`, "stderr: 2 host file(s) out of date with the framework: run npx atf sync."] });
  assert.equal(existsSync(path.join(ws.root, SETUP_WORKFLOW)), false);
  assert.deepEqual(atf(["sync"], ws).lines, ["atf sync: updated: .gitignore", CREATED, "atf sync: 2 file(s) updated."]);
  assert.equal(read(ws.root, SETUP_WORKFLOW), TEMPLATE, "the template as it is");
  // the block: every .github/ entry out, the Claude Code and VS Code files still in
  const block = read(ws.root, ".gitignore").trimEnd().split("\n");
  assert.deepEqual(block, gitignoreBlock(ignoredEntries(agentFilesOf(ws), { cloudAgent: true })));
  assert.ok(!block.some((l) => l.startsWith("/.github/")), block.join("\n"));
  for (const kept of ["/.claude/agents/report-generator.md", "/.mcp.json", "/.vscode/mcp.json", "/.vscode/hooks/framework-guard.json"]) assert.ok(block.includes(kept), kept);
  // what the client commits: the framework's Copilot agents one by one, the guard's registration, the workflow
  const committed = cloudAgentFiles(agentFilesOf(ws));
  assert.deepEqual(committed, [...listed(ws.root, ".github/agents").map((f) => `.github/agents/${f}`).sort(), ".github/hooks/framework-guard.json", SETUP_WORKFLOW]);
  assert.equal(block.length + committed.length - 1, blockOf(ws).length, "the opt-in moves entries out of the block, nothing else");
  assert.deepEqual(atf(["check"], ws), IN_SYNC);
  // the workflow is the client's from now on: their own step stays, sync never writes it again
  const mine = `${TEMPLATE}      - run: echo my own step\n`;
  writeFileSync(path.join(ws.root, SETUP_WORKFLOW), mine);
  assert.deepEqual(atf(["sync"], ws).lines, ["atf sync: the host files are up to date."]);
  assert.equal(read(ws.root, SETUP_WORKFLOW), mine);
  assert.deepEqual(atf(["check"], ws), IN_SYNC);
  // off again (false, or the key gone): the whole block is back; the workflow is left alone and no longer checked
  optIn(ws.root, false);
  assert.deepEqual(atf(["check"], ws), { code: 1, lines: ["atf check: out of date: .gitignore", "stderr: 1 host file(s) out of date with the framework: run npx atf sync."] });
  assert.equal(atf(["sync"], ws).code, 0);
  assert.equal(read(ws.root, ".gitignore"), `${blockOf(ws).join("\n")}\n`);
  assert.equal(read(ws.root, SETUP_WORKFLOW), mine);
  writeFileSync(path.join(ws.root, SETUP_WORKFLOW), "not: [valid\n");
  put(ws.root, "atf/atf.json", "{}\n");
  assert.deepEqual(atf(["check"], ws), IN_SYNC);
  // on again with the workflow deleted: written again, since it is missing
  rmSync(path.join(ws.root, SETUP_WORKFLOW));
  optIn(ws.root);
  assert.ok(atf(["sync"], ws).lines.includes(CREATED));
  assert.equal(read(ws.root, SETUP_WORKFLOW), TEMPLATE);
  // and git agrees with the block, where git is installed
  const init = git(["init", "-q"], ws.root);
  if (init.error || init.status !== 0) return t.skip(`git is not available: ${init.error?.message ?? init.stderr}`);
  const asked = [".github/agents/report-generator.agent.md", ".github/hooks/framework-guard.json", SETUP_WORKFLOW, ".claude/agents/report-generator.md", ".mcp.json", ".vscode/mcp.json", ".vscode/hooks/framework-guard.json"];
  const r = git(["check-ignore", "--", ...asked], ws.root);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), asked.slice(3));
});

test("a cloud_agent that isn't true or false: sync and check stop, naming atf/atf.json, and nothing is written", () => {
  const ws = installedWorkspace();
  for (const bad of ["yes", "true", 1, null, {}]) {
    put(ws.root, "atf/atf.json", JSON.stringify({ cloud_agent: bad }));
    for (const verb of ["sync", "check"]) {
      const r = atf([verb], ws);
      assert.equal(r.code, 1, `${verb} ${JSON.stringify(bad)}`);
      assert.equal(r.lines[0], `stderr: atf ${verb}: error: atf/atf.json "cloud_agent" must be true or false, not ${JSON.stringify(bad)}`);
    }
  }
  for (const f of [".claude", ".github", ".vscode", ".mcp.json", ".gitignore"]) assert.equal(existsSync(path.join(ws.root, f)), false, f);
  assert.deepEqual([cloudAgentOf(null), cloudAgentOf({}), cloudAgentOf({ cloud_agent: true }), cloudAgentOf({ cloud_agent: false })], [{ on: false }, { on: false }, { on: true }, { on: false }]);
});

test("the setup workflow is checked, never rewritten: check fails and sync warns when no step installs the framework with ATF_NPM_TOKEN", () => {
  const ws = installedWorkspace();
  optIn(ws.root);
  assert.equal(atf(["sync"], ws).code, 0);
  const noToken = TEMPLATE.replace(/\n {8}env:\n {10}ATF_NPM_TOKEN: .*\n/, "\n");
  assert.notEqual(noToken, TEMPLATE);
  writeFileSync(path.join(ws.root, SETUP_WORKFLOW), noToken);
  const detail = `${SETUP_WORKFLOW} runs npm ci (or npm install) without ATF_NPM_TOKEN in its env, the registry token the committed .npmrc reads: without the framework installed, the cloud agent's guard denies every tool call`;
  const fix = `add a step to the copilot-setup-steps job that runs npm ci with \`env: { ATF_NPM_TOKEN: \${{ secrets.ATF_NPM_TOKEN }} }\` (the repository's Agents secret), as ${INSTALLED_PACKAGE}/${SETUP_TEMPLATE} does; atf never rewrites this file`;
  assert.deepEqual(atf(["check"], ws), { code: 1, lines: [`stderr: atf check: error: ${detail}. Fix: ${fix}.`, `stderr: Fix ${SETUP_WORKFLOW} as above: atf sync never rewrites it.`] });
  assert.deepEqual(atf(["sync"], ws), { code: 0, lines: [`stderr: atf sync: warning: ${detail}. Fix: ${fix}.`, "atf sync: the host files are up to date."] });
  assert.equal(read(ws.root, SETUP_WORKFLOW), noToken, "never rewritten");
  // a client may restructure it: a workflow-level env and a multi-line run that installs pass
  const restructured = "name: setup\non: workflow_dispatch\nenv:\n  ATF_NPM_TOKEN: ${{ secrets.ATF_NPM_TOKEN }}\njobs:\n  copilot-setup-steps:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - name: deps\n        run: |\n          npm config get registry\n          npm install --no-audit\n";
  writeFileSync(path.join(ws.root, SETUP_WORKFLOW), restructured);
  assert.deepEqual(atf(["check"], ws), IN_SYNC);
});

test("setupWorkflowProblem: tolerant of layout, strict about the job, the install step and the token", () => {
  const job = (steps) => `jobs:\n  copilot-setup-steps:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  assert.equal(setupWorkflowProblem(TEMPLATE), null);
  assert.equal(setupWorkflowProblem(job("      - run: npm i\n        env: { ATF_NPM_TOKEN: x }\n")), null, "npm i, the step's env");
  assert.equal(setupWorkflowProblem(`${job("      - run: npm ci\n")}    env:\n      ATF_NPM_TOKEN: x\n`), null, "the job's env");
  assert.match(setupWorkflowProblem("jobs: [\n"), /^is not valid YAML \(/);
  assert.match(setupWorkflowProblem(""), /^has no job named copilot-setup-steps, the one GitHub runs/);
  assert.match(setupWorkflowProblem("jobs:\n  setup:\n    steps:\n      - run: npm ci\n"), /^has no job named copilot-setup-steps/);
  assert.match(setupWorkflowProblem(job("      - run: echo hi\n      - uses: actions/setup-node@v4\n")), /^has no step in its copilot-setup-steps job that runs npm ci \(or npm install\)$/);
  assert.match(setupWorkflowProblem(job("      - run: npm ci\n      - run: echo\n        env: { ATF_NPM_TOKEN: x }\n")), /without ATF_NPM_TOKEN in its env/, "the token on another step");
});

test("the setup workflow template: valid YAML, the job GitHub runs, CI's Node, npm ci with the Agents secret, a last atf check that never stops the job, no browsers", () => {
  const doc = yaml.load(TEMPLATE);
  assert.deepEqual(Object.keys(doc.jobs), ["copilot-setup-steps"]);
  const { steps } = doc.jobs["copilot-setup-steps"];
  assert.equal(steps.length, 5);
  assert.equal(steps[0].uses, "actions/checkout@v4");
  assert.equal(steps[1].uses, "actions/setup-node@v4");
  // the Node version CI tests the package on (this repository's CI; the package declares only its minimum, engines.node)
  const ci = path.join(frameworkRoot, "..", "..", ".github", "workflows", "ci.yml");
  if (existsSync(ci)) assert.equal(steps[1].with["node-version"], yaml.load(readFileSync(ci, "utf8")).jobs.check.steps.find((s) => s.uses?.startsWith("actions/setup-node")).with["node-version"]);
  assert.deepEqual({ run: steps[2].run, env: steps[2].env }, { run: "npm ci", env: { ATF_NPM_TOKEN: "${{ secrets.ATF_NPM_TOKEN }}" } });
  // npm ci's postinstall re-renders the committed Copilot files: report a difference (stale files), then restore them
  // so the agent's pull request never carries agent or hook changes (D-093)
  assert.deepEqual({ run: steps[3].run, coe: steps[3]["continue-on-error"] }, { run: "git diff --exit-code --stat -- .github/agents .github/hooks", coe: true });
  assert.deepEqual({ run: steps[4].run, coe: steps[4]["continue-on-error"] }, { run: "git checkout -- .github/agents .github/hooks", coe: undefined });
  assert.doesNotMatch(TEMPLATE, /playwright install|setup-k6/);
  for (const said of [/merge it\s+(?:#\s+)?there/, /Add your own steps/, /If npm ci fails, .*\n# .*denies every tool call/]) assert.match(TEMPLATE, said);
  assert.equal(setupWorkflowProblem(TEMPLATE), null);
});

test("a source checkout never gets the setup workflow, whatever atf.json says (D-018: all of .github/ is committed there)", () => {
  const root = tempRoot();
  put(root, "atf/atf.json", '{ "cloud_agent": true }\n');
  const ws = { root, framework: frameworkRoot };
  assert.equal(atf(["sync"], ws).code, 0);
  assert.equal(existsSync(path.join(root, SETUP_WORKFLOW)), false);
  assert.equal(existsSync(path.join(root, ".gitignore")), false);
  assert.equal(atf(["check"], ws).code, 0);
});

// ---- the Claude Code plugin opt-in (atf/atf.json "claude_plugin": true, docs/packaging.md §3.12) -------------------

const MARKET = "acme-corp/atf-marketplace";
const MARKET_SOURCE = { source: "github", repo: MARKET };
const pluginOptIn = (root, extra = {}) => put(root, "atf/atf.json", `${JSON.stringify({ claude_plugin: true, plugin_marketplace: MARKET, ...extra })}\n`);
// a client workspace with no Claude-affecting customization: the fixture's atf/models.yaml overlay is one
const plainWorkspace = () => {
  const ws = installedWorkspace();
  rmSync(path.join(ws.root, "atf", "models.yaml"));
  return ws;
};
const settingsOf = (root) => JSON.parse(read(root, ".claude/settings.json"));
const PLUGIN_LINE = 'Claude Code plugin mode (atf/atf.json "claude_plugin"): the atf@testagentic plugin supplies the Claude Code agents and MCP servers, so .claude/agents/ and .mcp.json are not rendered; sessions open atf:orchestrator-agent. The guard\'s hooks stay in .claude/settings.json.';
// the session `atf run` opens: the host CLI and its agent
const launch = (ws, ...flags) => {
  const s = plan(["run", "acme", ...flags], { workspace: ws.root, framework: ws.framework, env: {} }).steps.at(-1);
  return [s.cmd, ...s.args.slice(0, -1)];
};

test("plugin mode without a customization: no .claude/agents/ or .mcp.json (an earlier sync's removed, the client's own agent kept), the hooks and Copilot files as ever, the plugin keys in settings, the block without them", () => {
  const ws = plainWorkspace();
  put(ws.root, ".claude/settings.json", `${JSON.stringify({ permissions: { allow: ["Bash(ls)"] }, enabledPlugins: { "other@elsewhere": true } }, null, 2)}\n`);
  const mine = "---\nname: my-helper\ndescription: ours\n---\nHelp.\n";
  put(ws.root, ".claude/agents/my-helper.md", mine);
  assert.equal(atf(["sync"], ws).code, 0);
  const copilot = listed(ws.root, ".github/agents");
  assert.equal(listed(ws.root, ".claude/agents").length, copilot.length + 1, "without the opt-in: every agent, and the client's");
  assert.deepEqual(launch(ws), ["claude", "--agent", "orchestrator-agent"]);

  pluginOptIn(ws.root);
  const check = atf(["check"], ws);
  assert.equal(check.code, 1);
  assert.equal(check.lines[0], `atf check: ${PLUGIN_LINE}`);
  for (const f of [".claude/agents/orchestrator-agent.md", ".mcp.json", ".claude/settings.json", ".gitignore"]) assert.ok(check.lines.includes(`atf check: out of date: ${f}`), f);
  assert.ok(existsSync(path.join(ws.root, ".mcp.json")), "check writes nothing");

  const r = atf(["sync"], ws);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(r.lines[0], `atf sync: ${PLUGIN_LINE}`, "the mode, and why");
  assert.deepEqual(listed(ws.root, ".claude/agents"), ["my-helper.md"], "ours removed, the client's own kept");
  assert.equal(read(ws.root, ".claude/agents/my-helper.md"), mine);
  assert.equal(existsSync(path.join(ws.root, ".mcp.json")), false, "the plugin supplies the MCP servers");
  // what Copilot and VS Code use is rendered as ever
  assert.deepEqual(listed(ws.root, ".github/agents"), copilot);
  for (const f of [".vscode/mcp.json", ".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"]) assert.ok(existsSync(path.join(ws.root, f)), f);
  // the guard stays the project's: both hooks registered; the team's plugin keys added, every other key kept
  const settings = settingsOf(ws.root);
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /node_modules\/@testagentic\/atf\/scripts\/hooks\/pretooluse\.mjs/);
  assert.match(settings.hooks.PostToolUse[0].hooks[0].command, /posttooluse\.mjs/);
  assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
  assert.deepEqual(settings.enabledPlugins, { "other@elsewhere": true, "atf@testagentic": true });
  assert.deepEqual(settings.extraKnownMarketplaces, { testagentic: { source: MARKET_SOURCE } });
  // the block follows what is rendered: no Claude Code agent and no .mcp.json, the rest as ever
  const block = read(ws.root, ".gitignore").trimEnd().split("\n");
  const supplied = pluginSuppliedFiles({ workspace: ws.root, framework: ws.framework });
  assert.equal(supplied.length, copilot.length + 1);
  assert.ok(supplied.includes(".mcp.json") && supplied.includes(".claude/agents/orchestrator-agent.md"));
  assert.deepEqual(block, gitignoreBlock(ignoredEntries(agentFilesOf(ws), { supplied })));
  assert.ok(!block.some((l) => l.startsWith("/.claude/") || l === "/.mcp.json"), block.join("\n"));
  for (const kept of ["/.github/agents/orchestrator-agent.agent.md", "/.vscode/mcp.json", "/.github/hooks/framework-guard.json"]) assert.ok(block.includes(kept), kept);
  assert.equal(block.length + supplied.length, blockOf(ws).length);
  // in sync, and said so every time
  assert.deepEqual(atf(["check"], ws), { code: 0, lines: [`atf check: ${PLUGIN_LINE}`, "atf check: the host files are in sync with the framework."] });
  assert.deepEqual(atf(["sync"], ws).lines, [`atf sync: ${PLUGIN_LINE}`, "atf sync: the host files are up to date."]);
  // the session opens the plugin's agent on Claude Code; Copilot and ATF_AGENT as ever
  assert.deepEqual(launch(ws), ["claude", "--agent", "atf:orchestrator-agent"]);
  assert.deepEqual(launch(ws, "--host", "copilot"), ["copilot", "--agent", "orchestrator-agent", "-i"]);
  const custom = plan(["run", "acme"], { workspace: ws.root, framework: ws.framework, env: { ATF_AGENT: "my-cli --agent x" } }).steps.at(-1);
  assert.deepEqual([custom.cmd, ...custom.args.slice(0, -1)], ["my-cli", "--agent", "x"]);
  // a server the client put back in .mcp.json by hand is the usual error (D-092), pointing at the overlay
  put(ws.root, ".mcp.json", `${JSON.stringify({ mcpServers: { mine: { command: "x" } } })}\n`);
  const foreign = atf(["sync"], ws);
  assert.equal(foreign.code, 1);
  assert.match(foreign.lines.join("\n"), /\.mcp\.json.*mine.*atf\/mcp\.yaml/s);
  rmSync(path.join(ws.root, ".mcp.json"));

  // off again: everything rendered as without the plugin, and exactly the two plugin entries gone
  put(ws.root, "atf/atf.json", "{}\n");
  const off = atf(["sync"], ws);
  assert.equal(off.code, 0);
  assert.ok(!off.lines.some((l) => /plugin mode/.test(l)), "no mode line without the opt-in");
  assert.equal(listed(ws.root, ".claude/agents").length, copilot.length + 1);
  assert.ok(existsSync(path.join(ws.root, ".mcp.json")));
  const after = settingsOf(ws.root);
  assert.deepEqual(after.enabledPlugins, { "other@elsewhere": true });
  assert.equal(Object.hasOwn(after, "extraKnownMarketplaces"), false, "an object only the plugin's entry filled goes with it");
  assert.deepEqual(after.permissions, { allow: ["Bash(ls)"] });
  assert.equal(read(ws.root, ".gitignore"), `${blockOf(ws).join("\n")}\n`);
  assert.deepEqual(launch(ws), ["claude", "--agent", "orchestrator-agent"]);
});

test("plugin mode with a Claude-affecting customization: the project's agents and .mcp.json are rendered (bare names), sync names the customization, the plugin keys are still written", () => {
  const ws = installedWorkspace(); // its atf/models.yaml overlay is one
  pluginOptIn(ws.root);
  put(ws.root, "atf/agents/report-generator.extra.md", "Use the house style.\n");
  const r = atf(["sync"], ws);
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.equal(
    r.lines[0],
    'atf sync: Claude Code plugin mode (atf/atf.json "claude_plugin"), with the project\'s agents: this workspace customizes the Claude Code agents (atf/models.yaml (an overlay), atf/agents/report-generator.extra.md (an add-on fragment)), which the atf plugin can\'t carry, so .claude/agents/ and .mcp.json are rendered as without the plugin and sessions open orchestrator-agent; the plugin\'s atf: agents stay installed but unused.'
  );
  assert.equal(listed(ws.root, ".claude/agents").length, listed(ws.root, ".github/agents").length);
  assert.match(read(ws.root, ".claude/agents/report-generator.md"), /^name: report-generator$/m);
  assert.match(read(ws.root, ".claude/agents/report-generator.md"), /Use the house style\./);
  assert.ok(existsSync(path.join(ws.root, ".mcp.json")));
  assert.equal(read(ws.root, ".gitignore"), `${blockOf(ws).join("\n")}\n`, "the full block");
  assert.deepEqual(settingsOf(ws.root).enabledPlugins, { "atf@testagentic": true });
  assert.deepEqual(launch(ws), ["claude", "--agent", "orchestrator-agent"]);
  // the customizations gone: plugin mode, and the project's agents removed
  rmSync(path.join(ws.root, "atf", "models.yaml"));
  rmSync(path.join(ws.root, "atf", "agents"), { recursive: true });
  assert.equal(atf(["sync"], ws).lines[0], `atf sync: ${PLUGIN_LINE}`);
  assert.deepEqual(listed(ws.root, ".claude/agents"), []);
  assert.equal(existsSync(path.join(ws.root, ".mcp.json")), false);
  // which overrides count: every config file a Claude Code agent is rendered from, ejected or overlaid; not hooks.yaml
  const opts = { workspace: ws.root, framework: ws.framework };
  put(ws.root, "atf/hooks.yaml", "post_tool_use: sync\n");
  assert.deepEqual(claudeCustomizations(opts), []);
  put(ws.root, "atf/config/mcp.yaml", readFileSync(path.join(ws.framework, "config", "mcp.yaml"), "utf8"));
  put(ws.root, "atf/permissions.yaml", "agents: {}\n");
  put(ws.root, "atf/platforms.yaml", "{}\n");
  assert.deepEqual(claudeCustomizations(opts), ["atf/permissions.yaml (an overlay)", "atf/platforms.yaml (an overlay)", "atf/config/mcp.yaml (ejected)"]);
  assert.equal(claudeMode(opts).agents, "project");
  assert.deepEqual(launch(ws), ["claude", "--agent", "orchestrator-agent"]);
});

test("the plugin opt-in is validated: a non-boolean, a missing or bad plugin_marketplace, or a source checkout stop sync and check, naming atf/atf.json, and nothing is written", () => {
  const ws = plainWorkspace();
  const cases = [
    ...["yes", "true", 1, null, {}].map((bad) => [{ claude_plugin: bad, plugin_marketplace: MARKET }, `atf/atf.json "claude_plugin" must be true or false, not ${JSON.stringify(bad)}`]),
    [{ claude_plugin: true }, 'atf/atf.json "plugin_marketplace" is required with "claude_plugin": true: the plugin marketplace\'s repository you were given access to, as a git URL or GitHub\'s owner/repo'],
    ...["acme", "", "acme/x y", "ftp://host/x", 42].map((bad) => [{ claude_plugin: true, plugin_marketplace: bad }, `atf/atf.json "plugin_marketplace" must be a git URL (https://…, ssh://…, git@host:path) or GitHub's owner/repo, not ${JSON.stringify(bad)}`]),
  ];
  for (const [cfg, message] of cases) {
    put(ws.root, "atf/atf.json", JSON.stringify(cfg));
    for (const verb of ["sync", "check"]) {
      const r = atf([verb], ws);
      assert.equal(r.code, 1, `${verb} ${JSON.stringify(cfg)}`);
      assert.equal(r.lines[0], `stderr: atf ${verb}: error: ${message}`);
    }
    assert.match(plan(["run", "acme"], { workspace: ws.root, framework: ws.framework, env: {} }).error, new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Fix it, then run npx atf sync$`));
  }
  for (const f of [".claude", ".github", ".vscode", ".mcp.json", ".gitignore"]) assert.equal(existsSync(path.join(ws.root, f)), false, f);
  // off, or absent: no plugin; the marketplace is read only with the opt-in
  assert.deepEqual([claudePluginOf(null), claudePluginOf({}), claudePluginOf({ claude_plugin: false, plugin_marketplace: 7 })], [{ on: false }, { on: false }, { on: false }]);
  assert.deepEqual(claudePluginOf({ claude_plugin: true, plugin_marketplace: ` ${MARKET} ` }), { on: true, marketplace: MARKET_SOURCE });
  for (const [v, source] of [
    ["acme-corp/atf-marketplace", MARKET_SOURCE],
    ["https://git.example.com/qa/atf-marketplace.git", { source: "git", url: "https://git.example.com/qa/atf-marketplace.git" }],
    ["git@github.com:acme-corp/atf-marketplace.git", { source: "git", url: "git@github.com:acme-corp/atf-marketplace.git" }],
    ["ssh://git@git.example.com/qa/m.git", { source: "git", url: "ssh://git@git.example.com/qa/m.git" }],
  ])
    assert.deepEqual(marketplaceSource(v), source, v);
  for (const v of ["", "acme", "/abs/path", "acme/x/y", "https://", "ftp://h/x", null, ["a/b"]]) assert.equal(marketplaceSource(v), null, String(v));
  // a source checkout: the opt-in is an error, for sync and for the framework's own build alike
  const root = tempRoot();
  pluginOptIn(root);
  const src = { root, framework: frameworkRoot };
  const message = 'atf/atf.json "claude_plugin": the Claude Code plugin serves a workspace with @testagentic/atf installed, while this is the framework\'s source checkout, whose Claude Code agents are its committed files (D-018); remove the key';
  assert.deepEqual(atf(["sync"], src).lines[0], `stderr: atf sync: error: ${message}`);
  assert.deepEqual(build({ root, framework: frameworkRoot, check: true }), { errors: [message], changed: [] });
  assert.equal(existsSync(path.join(root, ".claude")), false);
  put(root, "atf/atf.json", '{ "claude_plugin": false }\n');
  assert.equal(atf(["check"], src).code, 1, "off: the scratch checkout just has no host files yet");
  assert.doesNotMatch(atf(["check"], src).lines.join("\n"), /claude_plugin/);
});

test("pluginSettings: the opt-in adds the marketplace and the enabled plugin, keeping every other key and entry; off removes exactly those two", () => {
  const on = { on: true, marketplace: MARKET_SOURCE };
  const added = { extraKnownMarketplaces: { testagentic: { source: MARKET_SOURCE } }, enabledPlugins: { "atf@testagentic": true } };
  assert.deepEqual(pluginSettings({}, on), added);
  assert.deepEqual(pluginSettings({ model: "x" }, on), { model: "x", ...added });
  // an entry's own fields (autoUpdate) are the client's; the source is replaced by atf.json's
  const old = { extraKnownMarketplaces: { testagentic: { autoUpdate: true, source: { source: "git", url: "https://old/x.git" } }, other: { source: { source: "github", repo: "o/r" } } }, enabledPlugins: { "atf@testagentic": false, "x@other": true } };
  const merged = pluginSettings(old, on);
  assert.deepEqual(merged, { extraKnownMarketplaces: { testagentic: { autoUpdate: true, source: MARKET_SOURCE }, other: old.extraKnownMarketplaces.other }, enabledPlugins: { "atf@testagentic": true, "x@other": true } });
  assert.deepEqual(old.enabledPlugins["atf@testagentic"], false, "a new object: the input is untouched");
  assert.deepEqual(pluginSettings(merged, { on: false }), { extraKnownMarketplaces: { other: old.extraKnownMarketplaces.other }, enabledPlugins: { "x@other": true } });
  assert.deepEqual(pluginSettings({ model: "x", ...added }, { on: false }), { model: "x" });
  assert.deepEqual(pluginSettings({ model: "x" }, { on: false }), { model: "x" });
  for (const bad of [[], "x", 1]) {
    assert.throws(() => pluginSettings({ enabledPlugins: bad }, on), /'enabledPlugins' must be an object/);
    assert.throws(() => pluginSettings({ extraKnownMarketplaces: bad }, { on: false }), /'extraKnownMarketplaces' must be an object/);
  }
  // in the build: a malformed key names the file, and nothing is written
  const ws = plainWorkspace();
  pluginOptIn(ws.root);
  put(ws.root, ".claude/settings.json", '{ "enabledPlugins": [] }\n');
  const r = atf(["sync"], ws);
  assert.equal(r.code, 1);
  assert.ok(r.lines.some((l) => /\.claude\/settings\.json: 'enabledPlugins' must be an object/.test(l)), r.lines.join("\n"));
  assert.equal(existsSync(path.join(ws.root, ".github")), false);
});

test("doctor, in plugin mode: the plugin's recorded version must be the package's (missing warns), and .claude/settings.json should enable it", async () => {
  const ws = plainWorkspace();
  const version = JSON.parse(read(ws.framework, "package.json")).version;
  const pluginChecks = async () => Object.fromEntries((await runChecks({ product: "acme" }, ["base"], { root: ws.root, framework: ws.framework })).filter((c) => c.id.startsWith("plugin-")).map((c) => [c.id, c]));
  assert.equal(atf(["sync"], ws).code, 0);
  assert.deepEqual(await pluginChecks(), {}, "no opt-in: nothing to say");
  pluginOptIn(ws.root);
  // before the sync: no plugin entry in settings, and no session has recorded a version
  let c = await pluginChecks();
  assert.deepEqual([c["plugin-enabled"].ok, c["plugin-enabled"].level, c["plugin-enabled"].fix], [true, "warn", "npx atf sync (in the workspace) writes it"]);
  assert.match(c["plugin-enabled"].detail, /does not enable the atf@testagentic plugin \(enabledPlugins\["atf@testagentic"\]\)/);
  assert.deepEqual([c["plugin-version"].ok, c["plugin-version"].level, c["plugin-version"].group], [true, "warn", "base"]);
  assert.equal(c["plugin-version"].detail, `the atf@testagentic plugin has recorded no version in this workspace yet (${PLUGIN_RECORD}): no Claude Code session has started here with it enabled`);
  assert.match(c["plugin-version"].fix, /^start a Claude Code session in the workspace .*; if Claude Code says the plugin is not installed, claude plugin install atf@testagentic --scope project$/);
  assert.equal(atf(["sync"], ws).code, 0);
  // the same version: passes
  const record = (v, at = "2026-10-27T09:00:00.000Z") => put(ws.root, PLUGIN_RECORD, `${JSON.stringify({ plugin: "atf", version: v, at })}\n`);
  record(version);
  c = await pluginChecks();
  assert.deepEqual(c["plugin-enabled"], { group: "base", id: "plugin-enabled", ok: true, level: undefined, detail: ".claude/settings.json enables the atf@testagentic plugin for the project" });
  assert.deepEqual(c["plugin-version"], { group: "base", id: "plugin-version", ok: true, level: undefined, detail: `the atf@testagentic plugin is ${version}, the installed @testagentic/atf's version` });
  // atf version reports it
  const info = versionInfo({ workspace: ws.root, framework: ws.framework });
  assert.deepEqual(info.plugin, { name: "atf", version });
  assert.match(versionText(info), new RegExp(`\nplugin: atf ${version.replace(/\./g, "\\.")}$`));
  // another version: fails, with both ways out
  record("9.9.9");
  c = await pluginChecks();
  assert.deepEqual([c["plugin-version"].ok, c["plugin-version"].level], [false, "fail"]);
  assert.equal(c["plugin-version"].detail, `the atf@testagentic plugin is 9.9.9 (${PLUGIN_RECORD}, recorded 2026-10-27T09:00:00.000Z) and the installed @testagentic/atf is ${version}: the two are released together and must be the same version`);
  assert.equal(c["plugin-version"].fix, "update whichever is behind: claude plugin update atf@testagentic, then start a new Claude Code session (it records the plugin's version); or npm install --save-dev @testagentic/atf@9.9.9 (in the workspace)");
  // a record the plugin didn't write: fails too
  for (const bad of ["{ nope", '{ "plugin": "other", "version": "1.0.0" }', '{ "plugin": "atf" }', "[]"]) {
    put(ws.root, PLUGIN_RECORD, bad);
    c = await pluginChecks();
    assert.deepEqual([c["plugin-version"].ok, c["plugin-version"].level], [false, "fail"], bad);
    assert.match(c["plugin-version"].detail, /^artifacts\/\.atf-plugin\.json (could not be read as JSON|must hold)/, bad);
  }
});
