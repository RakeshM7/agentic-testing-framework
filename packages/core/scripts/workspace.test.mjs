// D-085: a workspace apart from its framework. The rest of the suite runs in one directory that is both
// (scripts/test-helpers.mjs); this file builds a workspace in a temp folder beside the framework and proves what
// resolves where, what `{fw}` becomes, and that no call writes an installed framework, while a source checkout apart
// from the workspace (the monorepo's packages/core) stays editable.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "./build-agents.mjs";
import { lintFwToken } from "./lib/agents/lint.mjs";
import { configPath, loadConfig } from "./lib/config.mjs";
import { paths, schemaDir, validateData } from "./lib/contract.mjs";
import { templatesOf } from "./lib/foundation.mjs";
import { checkTool } from "./lib/guard.mjs";
import { networkGuarded } from "./lib/browser-tools.mjs";
import { append } from "./lib/ledger.mjs";
import { resolvePermissions, shellAllowed } from "./lib/permissions.mjs";
import { collectProvenance, packageOf } from "./lib/provenance.mjs";
import { expandFw, findWorkspace, frameworkRel, frameworkRoot, hookWorkspaceRoot, isInstalled, resolveWorkspaceRoot, sameDir, workspaceRoot } from "./lib/roots.mjs";
import { normalize } from "./hooks/hosts/claude.mjs";
import { initRun } from "./run.mjs";
import { writeConfig } from "./test-helpers.mjs";

const real = (p) => realpathSync.native(p);
// A client's test repo: atf/atf.json marks it, config/ holds its run-configs. Nothing of the framework is in it.
function workspace() {
  const ws = real(mkdtempSync(path.join(tmpdir(), "atf-ws-")));
  mkdirSync(path.join(ws, "atf"));
  writeFileSync(path.join(ws, "atf", "atf.json"), "{}\n");
  mkdirSync(path.join(ws, "config"));
  return ws;
}
const call = (agent, tool_name, tool_input) => normalize({ agent_type: agent, tool_name, tool_input }, { env: { CLAUDE_PROJECT_DIR: "/repo" }, host: "claude-code" });
const sh = (agent, command) => call(agent, "Bash", { command });
const write = (agent, file) => call(agent, "Write", { file_path: file });

// ---- which root is which -----------------------------------------------------------------------------------------

test("the workspace root: ATF_WORKSPACE, then the nearest atf/atf.json above the working directory, else the framework", () => {
  const ws = workspace();
  const deep = path.join(ws, "playwright-tests", "acme", "tests");
  mkdirSync(deep, { recursive: true });
  const other = real(mkdtempSync(path.join(tmpdir(), "atf-other-")));
  assert.equal(resolveWorkspaceRoot({ env: {}, cwd: deep }), ws, "found from a subfolder");
  assert.equal(resolveWorkspaceRoot({ env: { ATF_WORKSPACE: other }, cwd: deep }), other, "ATF_WORKSPACE wins");
  assert.equal(resolveWorkspaceRoot({ env: {}, cwd: other }), frameworkRoot, "no marker: the framework is its own workspace");
  assert.equal(resolveWorkspaceRoot({ env: { CLAUDE_PROJECT_DIR: other }, cwd: deep }), ws, "a script ignores CLAUDE_PROJECT_DIR");
  assert.equal(findWorkspace(other), null);
  // this repository: one directory that is both, or the monorepo, whose root is the workspace and packages/core the
  // framework (docs/packaging.md §3.11)
  assert.ok(sameDir(workspaceRoot, frameworkRoot) || frameworkRel(workspaceRoot, frameworkRoot) === "packages/core", workspaceRoot);
  // a hook: the host's root (CLAUDE_PROJECT_DIR or the payload's cwd) and its marker; this repo, or anywhere else, as is
  assert.equal(hookWorkspaceRoot(deep, { env: {} }), ws);
  assert.equal(hookWorkspaceRoot(deep, { env: { ATF_WORKSPACE: other } }), other);
  assert.equal(hookWorkspaceRoot(other, { env: {} }), other, "outside any workspace: the host's root, as before");
  assert.equal(hookWorkspaceRoot(path.join(frameworkRoot, "scripts", "lib"), { env: {} }), findWorkspace(frameworkRoot) ?? frameworkRoot, "inside this repo: the repo");
});

test("a split workspace: run state, the ledger and artifacts land in the workspace; templates, schemas and config come from the framework", async () => {
  const ws = workspace();
  const r = initRun(writeConfig(ws), { root: ws, runId: "acme-run-1", env: { CLAUDECODE: "1" } });
  assert.deepEqual(r.errors, undefined);
  const p = paths("acme", ws);
  for (const f of [p.runFile, p.lockFile, p.permissionsFile, p.configFile]) assert.ok(f.startsWith(ws) && existsSync(f), f);
  append(p.ledgerFile, { runId: "acme-run-1", event: "created", type: "contact", ref: "c-1", module: "contacts", stage: "explore", agent: "module-explorer" });
  assert.ok(existsSync(path.join(ws, "artifacts", "acme", "state", "ledger.jsonl")));
  // what the run is made with is the framework's: its commit, browser server and models, as this workspace has them
  // (config files are recorded from the workspace, D-077)
  assert.deepEqual(r.run.provenance, collectProvenance(frameworkRoot, ws));
  // the release is the framework's own package.json, whichever workspace runs it (docs/packaging.md §3.10)
  assert.deepEqual(r.run.provenance.package, packageOf(frameworkRoot));
  assert.ok(r.run.provenance.package?.version, "a version is recorded");
  assert.match(r.run.permissionsPath, /config\/permissions\.yaml$/);
  assert.equal(path.resolve(ws, r.run.permissionsPath), configPath("permissions.yaml"), "the framework's own permissions, by default");
  // the frozen commands are the ones the agents run from the workspace
  const rel = frameworkRel(ws, frameworkRoot);
  // relative, with `/`, on the same drive; an absolute path across Windows drives (a temp workspace on C:, the checkout
  // on D:), where no relative one exists
  const sameDrive = path.parse(ws).root.toLowerCase() === path.parse(frameworkRoot).root.toLowerCase();
  assert.ok((sameDrive ? rel.startsWith("..") : path.isAbsolute(rel)) && !rel.includes("\\") && sameDir(path.resolve(ws, rel), frameworkRoot), rel);
  const perms = JSON.parse(readFileSync(p.permissionsFile, "utf8"));
  assert.ok(perms.agents["orchestrator-agent"].shell_allow.includes(`node ${rel}/scripts/run.mjs *`));
  assert.ok(perms.agents["testcase-reviewer"].shell_allow.includes(`node ${rel}/scripts/framework-issues.mjs add *`), "common_shell_allow too");
  assert.ok(!JSON.stringify(perms).includes("{fw}"));
  // framework files
  assert.equal(schemaDir, path.join(frameworkRoot, "schemas"));
  assert.deepEqual(await validateData("run", JSON.parse(readFileSync(p.runFile, "utf8"))), []);
  assert.ok(templatesOf("repo").managed.length > 0, "templates from the framework");
  assert.equal(configPath("mcp.yaml"), path.join(frameworkRoot, "config", "mcp.yaml"));
  assert.equal(loadConfig("models.yaml").default.claude, loadConfig("models.yaml", { framework: frameworkRoot }).default.claude);
  assert.throws(() => configPath("acme.yaml"), /not a framework config file/, "a run-config is the workspace's, not framework config");
  assert.equal(networkGuarded(), true, "the framework's mcp.yaml names its init page as {fw}/scripts/browser/init-page.cjs");
  // an explicit permissions_file is the workspace's
  const ws2 = workspace();
  writeFileSync(path.join(ws2, "config", "mine.yaml"), "agents:\n  a: {layer: 2, spawns: [b]}\n");
  assert.match(initRun(writeConfig(ws2, { extra: ["permissions_file: config/mine.yaml"] }), { root: ws2 }).errors.join("\n"), /cannot spawn|unknown agent/);
});

test("a script run from inside a workspace finds it by its marker, or by ATF_WORKSPACE", () => {
  const ws = workspace();
  const cfg = writeConfig(ws);
  const node = (args, opts) => spawnSync(process.execPath, [path.join(frameworkRoot, "scripts", "run.mjs"), ...args], { encoding: "utf8", ...opts, env: { PATH: process.env.PATH, ...opts.env } });
  const sub = path.join(ws, "config");
  const init = node(["init", cfg, "--run-id", "acme-run-1"], { cwd: sub, env: {} });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const out = JSON.parse(init.stdout);
  const rel = frameworkRel(ws, frameworkRoot);
  assert.deepEqual(out.next, [`node ${rel}/scripts/run.mjs guard-check acme`, `node ${rel}/scripts/run.mjs doctor acme`, `node ${rel}/scripts/run.mjs prereqs acme`]);
  assert.ok(existsSync(path.join(ws, "artifacts", "acme", "state", "run.json")));
  const other = real(mkdtempSync(path.join(tmpdir(), "atf-other-")));
  const status = node(["status", "acme"], { cwd: other, env: { ATF_WORKSPACE: ws } });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).runId, "acme-run-1");
});

// ---- the {fw} token -----------------------------------------------------------------------------------------------

test("{fw} expands to the framework's path from the workspace, and to today's text when they are one directory", () => {
  assert.equal(expandFw("node {fw}/scripts/run.mjs next acme", ""), "node scripts/run.mjs next acme");
  assert.equal(expandFw("see `{fw}/docs/agent-handoffs.md` §1", ""), "see `docs/agent-handoffs.md` §1");
  assert.equal(expandFw("node {fw}/scripts/run.mjs", "node_modules/@testagentic/atf"), "node node_modules/@testagentic/atf/scripts/run.mjs");
  assert.equal(frameworkRel(frameworkRoot, frameworkRoot), "");
  const ws = workspace();
  const nested = path.join(ws, "node_modules", "@testagentic", "atf");
  mkdirSync(nested, { recursive: true });
  assert.equal(frameworkRel(ws, nested), "node_modules/@testagentic/atf", "always `/`, on every OS");
  // the permissions file: shell allow-lists expanded, the common list must use the token
  const doc = { common_shell_allow: ["node {fw}/scripts/framework-issues.mjs add *"], agents: { w: { layer: 2, shell: "restricted", shell_allow: ["node {fw}/scripts/explore.mjs *"] } } };
  const same = resolvePermissions(doc).resolved.agents.w;
  assert.deepEqual(same.shell_allow, ["node scripts/explore.mjs *", "node scripts/framework-issues.mjs add *"]);
  const split = resolvePermissions(doc, { fw: "node_modules/@testagentic/atf" }).resolved.agents.w;
  assert.equal(shellAllowed(split, "node node_modules/@testagentic/atf/scripts/explore.mjs state acme contacts"), true);
  assert.equal(shellAllowed(split, "node scripts/explore.mjs state acme contacts"), false, "a workspace script of the same name is not the framework's");
  assert.match(resolvePermissions({ ...doc, common_shell_allow: ["node scripts/framework-issues.mjs add *"] }).errors.join(), /node \{fw\}\/scripts/);
});

test("the agent-body lint: `{fw}/` is the only template token", () => {
  assert.deepEqual(lintFwToken("x", "run `node {fw}/scripts/run.mjs next <p>` and read `{fw}/docs/conventions.md`"), []);
  for (const bad of ["node {FW}/scripts/run.mjs", "node { fw }/scripts/run.mjs", "the {fw} folder", "node {fw}scripts/run.mjs", "{{ product }}", "{% if x %}"])
    assert.equal(lintFwToken("x", bad).length, 1, bad);
  assert.deepEqual(lintFwToken("x", 'JSON: `{"a": {"b": 1}}`'), [], "a closing }} is JSON, not a template");
});

test("the build: this repo's layout renders exactly the committed files; a split workspace gets the framework's path in every command", () => {
  // this repo's layout (one directory, or the monorepo's packages/core under the workspace): a scratch copy of the
  // sources, placed the same way, renders byte for byte what this repo commits
  const same = real(mkdtempSync(path.join(tmpdir(), "atf-same-")));
  const sameFw = path.join(same, frameworkRel(workspaceRoot, frameworkRoot));
  for (const d of ["config", "agents"]) cpSync(path.join(frameworkRoot, d), path.join(sameFw, d), { recursive: true });
  assert.deepEqual(build({ root: same, framework: sameFw }).errors, []);
  for (const rel of [".claude/agents/orchestrator-agent.md", ".github/agents/module-explorer.agent.md", ".mcp.json", ".vscode/mcp.json", ".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json"])
    assert.equal(readFileSync(path.join(same, rel), "utf8"), readFileSync(path.join(workspaceRoot, rel), "utf8"), rel);
  // split: the framework's sources, rendered into the workspace only
  const ws = workspace();
  const r = build({ root: ws, framework: frameworkRoot });
  assert.deepEqual(r.errors, []);
  const rel = frameworkRel(ws, frameworkRoot);
  const read = (f) => readFileSync(path.join(ws, f), "utf8");
  const orchestrator = read(".claude/agents/orchestrator-agent.md");
  assert.ok(orchestrator.includes(`node ${rel}/scripts/run.mjs init <config>`));
  assert.ok(orchestrator.includes(`(${rel}/docs/platforms.md)`), "docs by their framework path");
  assert.ok(!orchestrator.includes("{fw}") && !read(".github/agents/pw-ui-fixer.agent.md").includes("{fw}"));
  assert.ok(read(".github/agents/pw-ui-fixer.agent.md").includes(`"node ${rel}/scripts/hooks/pretooluse.mjs --host vscode --agent pw-ui-fixer"`), "the identity hook");
  assert.ok(read(".github/hooks/framework-guard.json").includes(`node ${rel}/scripts/hooks/pretooluse.mjs --host copilot`));
  assert.ok(read(".claude/settings.json").includes(`$CLAUDE_PROJECT_DIR/}${rel}/scripts/hooks/pretooluse.mjs`));
  assert.ok(JSON.parse(read(".mcp.json")).mcpServers.playwright.args.includes(`${rel}/scripts/browser/init-page.cjs`));
  assert.deepEqual(build({ root: ws, framework: frameworkRoot, check: true }).changed, [], "and --check sees no drift");
});

// ---- an installed framework is read-only -------------------------------------------------------------------------

test("installed: no call writes the framework -- file tools, shell writes, `..`, symlinks, case and separators (D-085)", () => {
  const ws = workspace();
  // installed: the framework's real path is inside a node_modules folder (here a package store outside the workspace)
  const fw = path.join(real(mkdtempSync(path.join(tmpdir(), "atf-fw-"))), "node_modules", "@testagentic", "atf");
  mkdirSync(path.join(fw, "scripts", "lib"), { recursive: true });
  writeFileSync(path.join(fw, "scripts", "lib", "guard.mjs"), "// the framework\n");
  const check = (c) => checkTool(c, ws, {}, { framework: fw });
  const denied = (c, why) => {
    const v = check(c);
    assert.equal(v.allowed, false, why);
    assert.equal(v.rule, "framework-readonly", why);
  };
  const relFw = path.relative(ws, fw);
  for (const agent of [undefined, "orchestrator-agent", "pw-ui-fixer"]) {
    denied(write(agent, path.join(fw, "scripts", "lib", "guard.mjs")), `${agent}: absolute`);
    denied(write(agent, path.join(relFw, "scripts", "new.mjs")), `${agent}: relative from the workspace`);
    denied(write(agent, path.join(ws, "artifacts", "..", relFw, "scripts", "x.mjs")), `${agent}: through ..`);
    denied(write(agent, path.join(fw, "SCRIPTS", "Lib", "GUARD.MJS")), `${agent}: another case`);
    denied(write(agent, `${fw}${path.sep}scripts\\lib\\guard.mjs`), `${agent}: backslashes`);
    denied(write(agent, path.join(fw, "scripts", "lib", "guard.mjs.")), `${agent}: a trailing dot`);
    denied(write(agent, fw), `${agent}: the root itself`);
  }
  // a symlink in the workspace that points into the framework
  symlinkSync(path.join(fw, "scripts"), path.join(ws, "fwlink"), process.platform === "win32" ? "junction" : "dir");
  denied(write(undefined, path.join(ws, "fwlink", "lib", "guard.mjs")), "through a symlink");
  // the shell writes the hook can read
  for (const cmd of [`echo x > ${fw}/scripts/lib/guard.mjs`, `cp /etc/hosts ${relFw}/scripts/a.mjs`, `rm -rf ${fw}/scripts`, `sed -i '' 's/a/b/' ${fw}/scripts/lib/guard.mjs`, `cd ${fw} && rm scripts/lib/guard.mjs`, `cd "${fw}/scripts" ; echo y >> lib/guard.mjs`])
    denied(sh(undefined, cmd), cmd);
  denied({ ...write(undefined, "x"), paths: [] }, "a write whose target can't be told");
  // the workspace stays writable, and reading or running the framework is fine
  assert.equal(check(write(undefined, path.join(ws, "artifacts", "notes.md"))).allowed, true);
  assert.equal(check(write(undefined, path.join(ws, "playwright-tests", "acme", "x.spec.ts"))).allowed, true);
  assert.equal(check(sh(undefined, `node ${relFw}/scripts/run.mjs status acme`)).allowed, true);
  assert.equal(check(sh(undefined, `cat ${fw}/scripts/lib/guard.mjs > ${ws}/copy.mjs`)).allowed, true);
  assert.equal(check(call(undefined, "Read", { file_path: path.join(fw, "scripts", "lib", "guard.mjs") })).allowed, true);
  // a workspace that holds the framework (the installed package): only the package is read-only
  const nested = path.join(ws, "node_modules", "@testagentic", "atf");
  mkdirSync(nested, { recursive: true });
  assert.equal(checkTool(write(undefined, path.join(nested, "scripts", "run.mjs")), ws, {}, { framework: nested }).rule, "framework-readonly");
  assert.equal(checkTool(write(undefined, path.join(ws, "config", "acme.yaml")), ws, {}, { framework: nested }).allowed, true);
  // a refusal's hint names the framework's scripts from the workspace
  assert.match(check(write(undefined, path.join(fw, "x.mjs"))).reason, new RegExp(`node ${relFw.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/scripts/framework-issues\\.mjs add`));
});

test("installed or not is decided on the framework's real path: a node_modules segment, any case; fails closed", () => {
  const tmp = real(mkdtempSync(path.join(tmpdir(), "atf-inst-")));
  const dir = (...p) => {
    const d = path.join(tmp, ...p);
    mkdirSync(d, { recursive: true });
    return d;
  };
  assert.equal(isInstalled(dir("node_modules", "@testagentic", "atf")), true);
  assert.equal(isInstalled(dir("a", "NODE_MODULES", "atf")), true, "any case");
  assert.equal(isInstalled(`${dir("b", "node_modules", "atf").replaceAll("/", "\\")}`), true, "either separator (resolved or, when it can't be, fail closed)");
  assert.equal(isInstalled(dir("src", "packages", "core")), false, "a source checkout");
  assert.equal(isInstalled(dir("c", "node_modules_old", "atf")), false, "a whole segment, not a prefix");
  assert.equal(isInstalled(path.join(tmp, "missing", "atf")), true, "can't be resolved: installed (fails closed)");
  // a link from a node_modules folder to a source checkout is the source checkout (the npm workspace link) ...
  const linked = path.join(dir("ws", "node_modules", "@testagentic"), "atf");
  symlinkSync(path.join(tmp, "src", "packages", "core"), linked, process.platform === "win32" ? "junction" : "dir");
  assert.equal(isInstalled(linked), false);
  // ... and a link from elsewhere to an installed package is installed
  const vendor = path.join(dir("ws", "vendor"), "atf");
  symlinkSync(path.join(tmp, "node_modules", "@testagentic", "atf"), vendor, process.platform === "win32" ? "junction" : "dir");
  assert.equal(isInstalled(vendor), true);
});

test("a source checkout apart from the workspace (the monorepo's packages/core) stays editable", () => {
  const ws = workspace();
  const src = path.join(real(mkdtempSync(path.join(tmpdir(), "atf-src-"))), "packages", "core");
  mkdirSync(path.join(src, "scripts", "lib"), { recursive: true });
  writeFileSync(path.join(src, "scripts", "lib", "guard.mjs"), "// the framework's source\n");
  // reached as it is, or through the workspace's node_modules link, the way npm workspaces install it
  const link = path.join(ws, "node_modules", "@testagentic", "atf");
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(src, link, process.platform === "win32" ? "junction" : "dir");
  for (const framework of [src, link]) {
    const v = (c) => checkTool(c, ws, {}, { framework });
    assert.equal(v(write(undefined, path.join(src, "scripts", "lib", "guard.mjs"))).allowed, true, framework);
    assert.equal(v(write("orchestrator-agent", path.join(link, "scripts", "new.mjs"))).allowed, true, "no run: no per-agent rules");
    assert.equal(v(sh(undefined, `echo x > ${src}/scripts/lib/guard.mjs`)).allowed, true);
    assert.equal(v({ ...write(undefined, "x"), paths: [] }).allowed, true, "an unknown target outside a run: as in one directory");
  }
  // the other rules still hold there: approval stays human-only
  assert.equal(checkTool(sh(undefined, `node ${src}/scripts/testcases.mjs approve acme contacts`), ws, {}, { framework: src }).rule, "human-only");
});

test("one directory (this repo's layout): writes are exactly as before, the framework rule never applies", () => {
  const root = workspace();
  const v = (c) => checkTool(c, root, {}, { framework: root });
  assert.equal(v(write(undefined, path.join(root, "scripts", "lib", "guard.mjs"))).allowed, true, "a human's own session, no run: as before");
  assert.equal(v(sh(undefined, `echo x > ${root}/scripts/lib/guard.mjs`)).allowed, true);
  assert.equal(v({ ...write(undefined, "x"), paths: [] }).allowed, true, "an unknown target outside a run: as before");
  // and a symlinked spelling of the same directory is the same directory
  const link = path.join(real(mkdtempSync(path.join(tmpdir(), "atf-link-"))), "repo");
  symlinkSync(root, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(checkTool(write(undefined, path.join(link, "scripts", "x.mjs")), link, {}, { framework: root }).allowed, true);
});

test("the hook entry judges the workspace and refuses a write into its own installed framework", () => {
  const ws = workspace();
  // the package as a client installs it: the framework's scripts and config under the workspace's node_modules
  const pkg = path.join(ws, "node_modules", "@testagentic", "atf");
  for (const d of ["scripts", "config"]) cpSync(path.join(frameworkRoot, d), path.join(pkg, d), { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) && !/\.test\.mjs$/.test(src) });
  const hook = (entry, payload, env) => spawnSync(process.execPath, [path.join(entry, "scripts", "hooks", "pretooluse.mjs"), "--host", "copilot"], { input: JSON.stringify(payload), encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  const into = hook(pkg, { cwd: path.join(ws, "config"), toolName: "create", toolArgs: { path: path.join(pkg, "scripts", "zz-never-written.mjs") } }, {});
  assert.equal(into.status, 2, into.stderr);
  assert.match(into.stderr, /framework-readonly/);
  const own = hook(pkg, { cwd: path.join(ws, "config"), toolName: "create", toolArgs: { path: path.join(ws, "notes.md") } }, {});
  assert.equal(own.status, 0, own.stderr);
  const viaEnv = hook(pkg, { cwd: tmpdir(), toolName: "create", toolArgs: { path: path.join(pkg, "config", "x.yaml") } }, { ATF_WORKSPACE: ws });
  assert.equal(viaEnv.status, 2, "ATF_WORKSPACE names the workspace");
  // this repo's own framework is a source checkout: editable from a workspace apart from it
  const source = hook(frameworkRoot, { cwd: path.join(ws, "config"), toolName: "create", toolArgs: { path: path.join(frameworkRoot, "scripts", "zz-never-written.mjs") } }, {});
  assert.equal(source.status, 0, source.stderr);
  assert.ok(!existsSync(path.join(frameworkRoot, "scripts", "zz-never-written.mjs")), "the hook only judges");
});
