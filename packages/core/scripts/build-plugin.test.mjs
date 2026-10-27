// The Claude Code plugin (scripts/build-plugin.mjs, docs/packaging.md §3.12, draft P-11): its file set and manifest, the
// agents rendered as atf sync renders them for an installed workspace (with the plugin's naming), the hooks file that
// never carries the guard, the MCP config reaching the workspace's package, the marketplace layout, the SessionStart
// script that records the plugin's version (scripts/hooks/plugin-session.mjs), and what the npm package must ship for
// the plugin to work. When the `claude` CLI is installed, `claude plugin validate --strict` checks the output too.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  INSTALLED_FW,
  MARKETPLACE_NAME,
  NAMESPACED_SUBAGENTS,
  PLUGIN_NAME,
  PROJECT_FW,
  buildPlugin,
  main,
  pluginBrowserTemplate,
  pluginPackageDir,
  renderPlugin,
  subagentName,
} from "./build-plugin.mjs";
import { build } from "./build-agents.mjs";
import { checkFiles, plannedFiles, readAllowList } from "./build-package.mjs";
import { loadConfig } from "./lib/config.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";
import { splitFrontmatter } from "./lib/agents/source.mjs";
import { PLUGIN, PLUGIN_RECORD } from "./lib/provenance.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { installedWorkspace } from "./test-helpers.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "atf-plugin-"));
const OUT = path.join(scratch(), "atf");
const BUILT = buildPlugin({ out: OUT });
const read = (rel, dir = OUT) => readFileSync(path.join(dir, ...rel.split("/")), "utf8");
const readJson = (rel, dir) => JSON.parse(read(rel, dir));
// every file below `dir`, dot-folders included (listFiles leaves them out, as npm does), as sorted `/` paths
const allFiles = (dir, rel = "") =>
  readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? allFiles(dir, rel ? `${rel}/${d.name}` : d.name) : [rel ? `${rel}/${d.name}` : d.name]))
    .sort();
const CORE_PKG = JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8"));
const fwOpts = { framework: frameworkRoot, workspace: frameworkRoot };
const PERMS = resolvePermissions(loadConfig("permissions.yaml", fwOpts), { fw: INSTALLED_FW }).resolved.agents;
const AGENTS = Object.keys(PERMS).sort();
const MCP = loadConfig("mcp.yaml", fwOpts);
// an agent file's frontmatter: the YAML (with the generated note, a comment) and the `tools:` list
const agent = (name, dir = OUT) => {
  const text = read(`agents/${name}.md`, dir);
  const { meta, body } = splitFrontmatter(text, name);
  return { text, meta, body, tools: String(meta.tools ?? "").split(/,\s*(?![^()]*\))/).map((t) => t.trim()).filter(Boolean) };
};
const spawnList = (tools) => {
  const m = tools.map((t) => /^Agent\((.*)\)$/.exec(t)).find(Boolean);
  return m ? m[1].split(",").map((s) => s.trim()) : [];
};

test("the plugin's file set: the manifest, one agent per framework agent, the MCP config, the hooks file and the README", () => {
  assert.deepEqual(BUILT.errors, []);
  assert.equal(AGENTS.length, 34, "every framework agent, and no dev-only one");
  assert.ok(!AGENTS.includes("framework-implementor-agent"), "the dev-only agent is the monorepo's, never the plugin's");
  const expected = [".claude-plugin/plugin.json", ".mcp.json", "README.md", "hooks/hooks.json", ...AGENTS.map((n) => `agents/${n}.md`)].sort();
  assert.deepEqual(allFiles(OUT), expected);
  assert.deepEqual(BUILT.files, expected);
  // the version lock: plugin.json carries exactly the package's version, and so does the plugin's own package.json
  const manifest = readJson(".claude-plugin/plugin.json");
  assert.equal(manifest.name, "atf");
  assert.equal(manifest.version, CORE_PKG.version);
  assert.equal(typeof manifest.description, "string");
  assert.equal(typeof manifest.author?.name, "string");
  const pluginPkg = JSON.parse(readFileSync(path.join(pluginPackageDir(), "package.json"), "utf8"));
  assert.deepEqual([pluginPkg.name, pluginPkg.private, pluginPkg.version], ["@testagentic/atf-claude-plugin", true, CORE_PKG.version]);
  // the names are the workspace side's (lib/provenance.mjs), as the shared spec fixes them
  assert.deepEqual([PLUGIN_NAME, MARKETPLACE_NAME], [PLUGIN.name, PLUGIN.marketplace]);
  assert.deepEqual([PLUGIN_NAME, MARKETPLACE_NAME], ["atf", "testagentic"]);
  assert.match(read("README.md"), new RegExp(`atf ${CORE_PKG.version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(read("README.md"), /\{\{version\}\}/);
});

test("plugin agents: bare name:, atf: subagents, the plugin's browser tools, no ignored frontmatter, no plugin-root paths", () => {
  for (const name of AGENTS) {
    const { text, meta, tools } = agent(name);
    assert.equal(meta.name, name, `${name}: the bare name (Claude Code namespaces it as ${PLUGIN_NAME}:${name})`);
    for (const k of ["hooks", "mcpServers", "permissionMode"]) assert.ok(!(k in meta), `${name}: ${k} is ignored in a plugin agent`);
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT/, name);
    assert.doesNotMatch(text, /\{fw\}|packages\/core/, `${name}: {fw} is the installed package's path`);
    assert.match(text, /^---\n# GENERATED for the atf Claude Code plugin from @testagentic\/atf /, name);
    // the spawn allow-list: exactly the permissions row's, each as the plugin addresses it
    assert.deepEqual(spawnList(tools), PERMS[name].spawns.map(subagentName), `${name}: subagents`);
    for (const s of spawnList(tools)) assert.ok(NAMESPACED_SUBAGENTS ? s.startsWith(`${PLUGIN_NAME}:`) : !s.includes(":"), `${name}: ${s}`);
    // browser tools are the plugin server's (mcp__plugin_<plugin>_<server>__…), never the project server's
    const browser = tools.filter((t) => t.startsWith("mcp__"));
    assert.equal(browser.length > 0, PERMS[name].live_target.browser !== "none", `${name}: browser tools`);
    for (const t of browser) assert.match(t, new RegExp(`^mcp__plugin_atf_${MCP.browser_server}__browser_\\w+$`), `${name}: ${t}`);
  }
  // a body calls the workspace's installed package, as a synced agent does
  assert.match(agent("orchestrator-agent").body, /node node_modules\/@testagentic\/atf\/scripts\/run\.mjs next/);
});

test("the subagent-name switch is pinned to atf:<name> until a live session settles it (docs/claude-plugin-verification.md check 2)", () => {
  assert.equal(NAMESPACED_SUBAGENTS, true, "flipped? record the live result in docs/claude-plugin-verification.md, then update this pin");
  assert.equal(subagentName("module-explorer"), "atf:module-explorer");
  const { tools } = agent("orchestrator-agent");
  assert.ok(tools.includes("Agent(atf:knowledge-generator, atf:module-explorer, atf:api-discoverer, atf:clarification-orchestrator, atf:testcase-orchestrator, atf:playwright-ui-orchestrator, atf:playwright-api-orchestrator, atf:k6-orchestrator, atf:report-generator, atf:pw-repo-owner)"), tools.join(" | "));
});

test("plugin agents are what atf sync renders for an installed workspace, apart from the plugin's naming and note", () => {
  const ws = installedWorkspace();
  const r = build({ root: ws.root, framework: ws.framework });
  assert.deepEqual(r.errors, []);
  const synced = path.join(ws.root, ".claude");
  for (const name of AGENTS) {
    const p = agent(name);
    const s = agent(name, synced);
    assert.equal(p.body, s.body, `${name}: body`);
    assert.deepEqual([p.meta.description, p.meta.color], [s.meta.description, s.meta.color], `${name}: identity`);
    // the same tools, but for the spawn names and the browser server's prefix
    const plain = (tools) => tools.map((t) => t.replace(/^mcp__plugin_atf_/, "mcp__").replace(/^Agent\((.*)\)$/, (_, xs) => `Agent(${xs.replaceAll("atf:", "")})`));
    assert.deepEqual(plain(p.tools), s.tools, `${name}: tools`);
    if (name !== "report-generator") assert.equal(p.meta.model, s.meta.model, `${name}: model`); // the fixture overlays report-generator's
  }
});

test("hooks.json holds only the SessionStart version record, never the guard", () => {
  const hooks = readJson("hooks/hooks.json");
  assert.deepEqual(Object.keys(hooks.hooks), ["SessionStart"]);
  for (const event of ["PreToolUse", "PostToolUse"]) assert.ok(!(event in hooks.hooks), event);
  assert.doesNotMatch(read("hooks/hooks.json"), /pretooluse|posttooluse|CLAUDE_PLUGIN_ROOT/);
  const commands = hooks.hooks.SessionStart.flatMap((g) => g.hooks);
  assert.deepEqual(commands, [{ type: "command", command: `node "\${CLAUDE_PROJECT_DIR}/node_modules/@testagentic/atf/scripts/hooks/plugin-session.mjs" --plugin-version ${CORE_PKG.version}` }]);
});

test(".mcp.json: the framework's servers, every framework path through ${CLAUDE_PROJECT_DIR}/node_modules/@testagentic/atf", () => {
  const mcp = readJson(".mcp.json");
  assert.deepEqual(Object.keys(mcp), ["mcpServers"]);
  assert.deepEqual(Object.keys(mcp.mcpServers), Object.keys(MCP.servers));
  assert.equal(PROJECT_FW, "${CLAUDE_PROJECT_DIR}/node_modules/@testagentic/atf");
  const strings = Object.values(mcp.mcpServers).flatMap((s) => [s.command, ...(s.args ?? [])]);
  assert.ok(strings.includes(`${PROJECT_FW}/scripts/browser/init-page.cjs`));
  for (const s of strings) {
    assert.doesNotMatch(s, /\{fw\}|CLAUDE_PLUGIN_ROOT|packages\/core/, s);
    if (/scripts\/|node_modules/.test(s)) assert.ok(s.startsWith(`${PROJECT_FW}/`), s);
  }
});

test("every framework file the plugin points at ships in the npm package, and the plugin's build never does", () => {
  const shipped = plannedFiles();
  for (const rel of ["scripts/hooks/plugin-session.mjs", "scripts/browser/init-page.cjs", "scripts/run.mjs"]) assert.ok(shipped.includes(rel), rel);
  assert.ok(!shipped.includes("scripts/build-plugin.mjs"), "maintainer-only");
  assert.deepEqual(checkFiles(shipped, readAllowList()), [], "the planned package matches package-files.txt");
  assert.ok(readAllowList().exclude.includes("scripts/build-plugin.mjs"));
});

test("--marketplace writes marketplace.json and replaces plugins/atf/, leaving the rest of the repository alone", () => {
  const repo = scratch();
  mkdirSync(path.join(repo, ".git"));
  writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(path.join(repo, "NOTES.md"), "ours\n");
  mkdirSync(path.join(repo, "plugins", "atf", "agents"), { recursive: true });
  writeFileSync(path.join(repo, "plugins", "atf", "agents", "stale.md"), "stale\n");
  const out = path.join(scratch(), "atf");
  assert.equal(main(["--out", out, "--marketplace", repo]), 0);
  assert.equal(read(".git/HEAD", repo), "ref: refs/heads/main\n");
  assert.equal(read("NOTES.md", repo), "ours\n");
  assert.ok(!existsSync(path.join(repo, "plugins", "atf", "agents", "stale.md")), "the old plugin is replaced whole");
  const copied = path.join(repo, "plugins", "atf");
  assert.deepEqual(allFiles(copied), allFiles(out));
  for (const rel of allFiles(out)) assert.equal(read(rel, copied), read(rel, out), rel);
  assert.deepEqual(allFiles(repo).filter((f) => !f.startsWith("plugins/atf/")), [".claude-plugin/marketplace.json", ".git/HEAD", "NOTES.md"]);
  const market = readJson(".claude-plugin/marketplace.json", repo);
  assert.equal(market.name, "testagentic");
  assert.equal(typeof market.owner?.name, "string");
  assert.equal(market.plugins.length, 1);
  const [entry] = market.plugins;
  assert.deepEqual([entry.name, entry.source, typeof entry.description], ["atf", "./plugins/atf", "string"]);
  assert.ok(!("version" in entry), "the version is plugin.json's only (set in both, plugin.json wins with a warning)");
});

test("a failed build writes nothing: a foreign output folder, a marketplace around the output, a version out of step", () => {
  const foreign = scratch();
  writeFileSync(path.join(foreign, "keep.txt"), "mine\n");
  const r = buildPlugin({ out: foreign });
  assert.match(r.errors.join("\n"), /holds no built plugin .*refusing to replace it/);
  assert.equal(read("keep.txt", foreign), "mine\n");
  const repo = scratch();
  const inside = buildPlugin({ out: path.join(repo, "plugins", "atf"), marketplace: repo });
  assert.match(inside.errors.join("\n"), /must be outside the plugin's build folder/);
  assert.ok(!existsSync(path.join(repo, ".claude-plugin")) && !existsSync(path.join(repo, "plugins")));
  // a framework whose plugin package.json lags its version (a release bumps both)
  const base = scratch();
  const core = path.join(base, "core");
  for (const d of ["agents", "config"]) cpSync(path.join(frameworkRoot, d), path.join(core, d), { recursive: true });
  cpSync(path.join(frameworkRoot, "package.json"), path.join(core, "package.json"));
  cpSync(pluginPackageDir(), path.join(base, "claude-plugin"), { recursive: true, filter: (src) => path.basename(src) !== "dist" });
  writeFileSync(path.join(base, "claude-plugin", "package.json"), JSON.stringify({ name: "@testagentic/atf-claude-plugin", version: "9.9.9", private: true }));
  const lag = buildPlugin({ core, out: path.join(base, "out") });
  assert.match(lag.errors.join("\n"), /version 9\.9\.9 must equal @testagentic\/atf's/);
  assert.ok(!existsSync(path.join(base, "out")));
  // and a platforms.yaml whose browser template the plugin can't rename
  assert.match(pluginBrowserTemplate("{server}/browser_{tool}").error, /must start with 'mcp__\{server\}__'/);
  assert.equal(pluginBrowserTemplate("mcp__{server}__browser_{tool}").template, "mcp__plugin_atf_{server}__browser_{tool}");
  // renderPlugin alone writes nothing at all
  assert.deepEqual(renderPlugin().errors, []);
});

// ---- the SessionStart script ---------------------------------------------------------------------------------------

const SESSION = path.join(frameworkRoot, "scripts", "hooks", "plugin-session.mjs");
const session = (args, { cwd, env = {}, script = SESSION } = {}) =>
  spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
const workspace = () => {
  const root = scratch();
  mkdirSync(path.join(root, "atf"));
  writeFileSync(path.join(root, "atf", "atf.json"), "{}\n");
  return root;
};

test("plugin-session: records the plugin's version in a workspace, quietly, from the project dir or the working directory", () => {
  const ws = workspace();
  const before = Date.now();
  const r = session(["--plugin-version", "0.1.0"], { cwd: scratch(), env: { CLAUDE_PROJECT_DIR: ws } });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], "a SessionStart hook's stdout would land in the session's context");
  const record = JSON.parse(read(PLUGIN_RECORD, ws));
  assert.deepEqual(Object.keys(record), ["plugin", "version", "at"]);
  assert.deepEqual([record.plugin, record.version], ["atf", "0.1.0"]);
  assert.equal(new Date(record.at).toISOString(), record.at);
  assert.ok(Date.parse(record.at) >= before - 1000);
  // no CLAUDE_PROJECT_DIR: the working directory, from a subfolder up to the marker; a newer session overwrites it
  mkdirSync(path.join(ws, "config"));
  assert.equal(session(["--plugin-version", "0.2.0-rc.1"], { cwd: path.join(ws, "config") }).status, 0);
  assert.equal(JSON.parse(read(PLUGIN_RECORD, ws)).version, "0.2.0-rc.1");
  assert.deepEqual(readdirSync(path.join(ws, "artifacts")), [".atf-plugin.json"], "only the record, no temp file left");
});

test("plugin-session: outside a workspace, or without a version, it records nothing and still exits 0", () => {
  const plain = scratch();
  const r = session(["--plugin-version", "0.1.0"], { cwd: plain, env: { CLAUDE_PROJECT_DIR: plain } });
  assert.deepEqual([r.status, r.stdout], [0, ""]);
  assert.match(r.stderr, /not in an atf workspace/);
  assert.ok(!existsSync(path.join(plain, "artifacts")), "nothing created outside a workspace");
  const ws = workspace();
  for (const args of [[], ["--plugin-version"], ["--plugin-version", "latest"], ["--bogus"]]) {
    const x = session(args, { env: { CLAUDE_PROJECT_DIR: ws } });
    assert.deepEqual([x.status, x.stdout], [0, ""], args.join(" "));
  }
  assert.ok(!existsSync(path.join(ws, "artifacts")));
});

test("plugin-session: exits 0 when it can't write, or can't even load its library", () => {
  const ws = workspace();
  writeFileSync(path.join(ws, "artifacts"), "a file where the folder should be\n");
  const r = session(["--plugin-version", "0.1.0"], { env: { CLAUDE_PROJECT_DIR: ws } });
  assert.deepEqual([r.status, r.stdout], [0, ""]);
  assert.match(r.stderr, /could not record the plugin version/);
  // a broken install: the script without scripts/lib/ beside it
  const lone = path.join(scratch(), "scripts", "hooks");
  mkdirSync(lone, { recursive: true });
  cpSync(SESSION, path.join(lone, "plugin-session.mjs"));
  const b = session(["--plugin-version", "0.1.0"], { env: { CLAUDE_PROJECT_DIR: workspace() }, script: path.join(lone, "plugin-session.mjs") });
  assert.deepEqual([b.status, b.stdout], [0, ""]);
  assert.match(b.stderr, /could not record the plugin version/);
});

// ---- Claude Code's own validator, when it is installed ---------------------------------------------------------------

const hasClaude = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 20000 }).status === 0;
test("claude plugin validate --strict accepts the plugin and the marketplace", { skip: hasClaude ? false : "the claude CLI is not installed" }, () => {
  const repo = scratch();
  assert.equal(main(["--out", path.join(scratch(), "atf"), "--marketplace", repo]), 0);
  for (const dir of [path.join(repo, "plugins", "atf"), repo]) {
    const r = spawnSync("claude", ["plugin", "validate", "--strict", dir], { encoding: "utf8", timeout: 120000 });
    assert.equal(r.status, 0, `${dir}\n${r.stdout}\n${r.stderr}`);
  }
});
