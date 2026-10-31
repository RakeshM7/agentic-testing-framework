// The published package (scripts/build-package.mjs, docs/packaging.md §2, §3.11): the bundled dist, its allow-list
// (package-files.txt), its package.json, the release gate, and the built package installed in a client workspace,
// hooks included. The build takes a few seconds, so it runs once, into a temp folder, for the whole file.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CORE,
  DRAFT_MARKER,
  buildPackage,
  checkDist,
  checkFiles,
  distPackageJson,
  entryPoints,
  globRegex,
  inlinedSource,
  licenseIsDraft,
  listFiles,
  main,
  parseAllowList,
  plannedFiles,
  readAllowList,
  releaseErrors,
} from "./build-package.mjs";
import { installedWorkspace, startRun } from "./test-helpers.mjs";

const scratch = () => mkdtempSync(path.join(tmpdir(), "atf-pkg-"));
const DIST = path.join(scratch(), "dist");
const BUILT = await buildPackage({ out: DIST });
const FILES = listFiles(DIST);
const SOURCE_PKG = JSON.parse(readFileSync(path.join(CORE, "package.json"), "utf8"));
const read = (rel, dir = DIST) => readFileSync(path.join(dir, ...rel.split("/")), "utf8");
// a copy of dist to break on purpose
const copyOfDist = () => {
  const dir = path.join(scratch(), "dist");
  cpSync(DIST, dir, { recursive: true });
  return dir;
};
// the PreToolUse hook entry of a framework copy, as Claude Code runs it
const hook = (framework, payload, env = {}) =>
  spawnSync(process.execPath, [path.join(framework, "scripts", "hooks", "pretooluse.mjs"), "--host", "claude-code"], { input: JSON.stringify(payload), encoding: "utf8", env: { PATH: process.env.PATH, ...env } });

test("the build writes dist: every client-side module bundled at its source path, the runtime files copied, and nothing else", () => {
  assert.deepEqual(BUILT.errors, []);
  assert.deepEqual(FILES, plannedFiles());
  assert.deepEqual(checkDist(DIST), []);
  assert.equal(BUILT.bundled, entryPoints().length);
  for (const must of ["bin/atf.mjs", "scripts/hooks/pretooluse.mjs", "scripts/hooks/posttooluse.mjs", "scripts/hooks/plugin-session.mjs", "scripts/hooks/hosts/claude.mjs", "scripts/lib/guard.mjs", "scripts/run.mjs", "scripts/browser/init-page.cjs", "agents/orchestrator-agent.md", "config/permissions.yaml", "templates/workspace/_npmrc", "schemas/run.schema.json", "docs/platforms.md", "LICENSE.md", "package.json"])
    assert.ok(FILES.includes(must), must);
  // copied files are byte for byte the source
  for (const rel of ["agents/orchestrator-agent.md", "config/permissions.yaml", "docs/artifact-contract.md", "LICENSE.md", "scripts/browser/init-page.cjs"]) assert.equal(read(rel), read(rel, CORE), rel);
  // bundles: ESM, unminified, the hashbang kept, and only node: built-ins and the declared packages imported statically
  const deps = new Set([...Object.keys(SOURCE_PKG.dependencies), ...Object.keys(SOURCE_PKG.peerDependencies)]);
  for (const rel of entryPoints()) {
    const text = read(rel);
    if (read(rel, CORE).startsWith("#!")) assert.ok(text.startsWith("#!/usr/bin/env node\n"), `${rel}: hashbang`);
    assert.match(text, /All rights reserved: see LICENSE\.md/, rel);
    for (const [, spec] of text.matchAll(/^import .* from "([^"]+)";$/gm)) assert.ok(spec.startsWith("node:") || deps.has(spec.split("/")[0]), `${rel}: static import of ${spec}`);
    // every relative import() reaches a bundled sibling
    for (const [, spec] of text.matchAll(/\bimport\("(\.{1,2}\/[^"]+)"\)/g)) assert.ok(existsSync(path.resolve(path.dirname(path.join(DIST, rel)), spec)), `${rel}: import("${spec}")`);
  }
  assert.ok(read("scripts/lib/guard.mjs").split("\n").length > 500, "not minified");
});

test("nothing maintainer-only ships: tests, test helpers, fixtures, the e2e harness, the build itself, the decision log", () => {
  for (const f of FILES) {
    assert.doesNotMatch(f, /\.test\.mjs$|^scripts\/fixtures\/|(^|\/)node_modules\/|(^|\/)\./, f);
    assert.ok(!["scripts/test-helpers.mjs", "scripts/e2e.mjs", "scripts/build-package.mjs", "scripts/build-plugin.mjs", "docs/decisions.md", "docs/packaging.md", "docs/agent-architecture.md", "package-files.txt"].includes(f), f);
  }
  assert.ok(!FILES.some((f) => f.startsWith("feedback/") || f.startsWith("dist/")));
  // and the allow-list itself refuses them, whatever its include lines say
  const list = readAllowList();
  assert.deepEqual(checkFiles(["scripts/run.test.mjs", "scripts/test-helpers.mjs", "scripts/fixtures/e2e/x.json", "docs/decisions.md", "templates/.DS_Store"], { include: ["**"], exclude: list.exclude }).length, 5);
});

test("the allow-list: a stray file or a missing required one fails the check, in dist and as the release runs it", () => {
  const list = readAllowList();
  assert.deepEqual(checkFiles(FILES, list), []);
  assert.deepEqual(checkFiles([...FILES, "scripts/notes.txt"], list), ["scripts/notes.txt: not in package-files.txt"]);
  assert.deepEqual(checkFiles([...FILES, "scripts/lib/guard.test.mjs"], list), ["scripts/lib/guard.test.mjs: never shipped (!**/*.test.mjs in package-files.txt)"]);
  assert.deepEqual(checkFiles(FILES.filter((f) => f !== "scripts/hooks/pretooluse.mjs"), list), ["scripts/hooks/pretooluse.mjs: required by package-files.txt, missing from dist"]);
  assert.deepEqual(checkFiles(FILES.filter((f) => !f.startsWith("schemas/")), list), ["schemas/*.schema.json: matches no file in dist (package-files.txt)"]);
  // on disk: a stray file, a deleted module the source still builds, and the CLI that runs in the release workflow
  const dist = copyOfDist();
  writeFileSync(path.join(dist, "docs", "decisions.md"), "# log\n");
  rmSync(path.join(dist, "scripts", "lib", "telemetry.mjs"));
  writeFileSync(path.join(dist, "scripts", "lib", "extra.mjs"), "export {};\n");
  assert.deepEqual(checkDist(dist).sort(), [
    "docs/decisions.md: in dist, but nothing in the source builds it",
    "docs/decisions.md: never shipped (!docs/decisions.md in package-files.txt)",
    "scripts/lib/extra.mjs: in dist, but nothing in the source builds it",
    "scripts/lib/telemetry.mjs: missing from dist (the source has it)",
    "scripts/lib/telemetry.mjs: required by package-files.txt, missing from dist",
  ]);
  const r = spawnSync(process.execPath, [path.join(CORE, "scripts", "build-package.mjs"), "--check", "--out", dist], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^build-package: docs\/decisions\.md: never shipped/m);
  assert.equal(spawnSync(process.execPath, [path.join(CORE, "scripts", "build-package.mjs"), "--check", "--out", DIST], { encoding: "utf8" }).status, 0);
});

test("allow-list globs: * stays in one folder, **/ spans any, ! lines and comments parse", () => {
  assert.equal(globRegex("scripts/*.mjs").test("scripts/run.mjs"), true);
  assert.equal(globRegex("scripts/*.mjs").test("scripts/lib/guard.mjs"), false);
  assert.equal(globRegex("**/*.test.mjs").test("run.test.mjs"), true);
  assert.equal(globRegex("**/*.test.mjs").test("scripts/lib/x.test.mjs"), true);
  assert.equal(globRegex("templates/**").test("templates/a/b/c.tpl"), true);
  assert.equal(globRegex("docs/a.md").test("docs/aXmd"), false);
  assert.deepEqual(parseAllowList("# c\n\npackage.json\r\n  !**/x  \n"), { include: ["package.json"], exclude: ["**/x"] });
});

test("dist's package.json: what an install needs, publishable, and nothing from the monorepo", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.deepEqual(pkg, distPackageJson(SOURCE_PKG));
  assert.deepEqual(Object.keys(pkg), ["name", "version", "description", "license", "type", "bin", "scripts", "dependencies", "peerDependencies", "publishConfig"]);
  assert.equal(pkg.name, "@testagentic/atf");
  assert.equal(pkg.version, SOURCE_PKG.version);
  assert.equal(pkg.version, "0.1.2");
  assert.equal(pkg.license, "UNLICENSED");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.bin, { atf: "bin/atf.mjs" });
  assert.deepEqual(pkg.scripts, { postinstall: "node bin/atf.mjs sync --postinstall" });
  assert.deepEqual(pkg.dependencies, SOURCE_PKG.dependencies);
  assert.deepEqual(pkg.peerDependencies, { playwright: "1.64.1" });
  assert.deepEqual(pkg.publishConfig, { registry: "https://npm.pkg.github.com" });
  for (const k of ["private", "devDependencies", "files", "workspaces"]) assert.equal(k in pkg, false, k);
  // the source can't be published by accident, and esbuild is build-time only
  assert.equal(SOURCE_PKG.private, true);
  assert.ok(SOURCE_PKG.devDependencies.esbuild);
  assert.equal(JSON.stringify(pkg).includes("esbuild"), false);
});

test("the built package installed in a client workspace: atf sync and atf check pass, and its hook guards", () => {
  const ws = installedWorkspace({ from: DIST });
  assert.equal(existsSync(path.join(ws.framework, "scripts", "run.test.mjs")), false, "the installed copy is dist");
  const atf = (...argv) => spawnSync(process.execPath, [path.join(ws.framework, "bin", "atf.mjs"), ...argv], { cwd: ws.root, encoding: "utf8", env: { ...process.env, ATF_WORKSPACE: "" } });
  const sync = atf("sync");
  assert.equal(sync.status, 0, sync.stdout + sync.stderr);
  assert.match(read(".claude/agents/orchestrator-agent.md", ws.root), /node node_modules\/@testagentic\/atf\/scripts\/run\.mjs/);
  const check = atf("check");
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // the hook the sync registered, from the installed dist: a framework agent may not write under atf/ or into the
  // installed package; reading is fine
  const env = { CLAUDE_PROJECT_DIR: ws.root };
  const write = (file) => hook(ws.framework, { agent_type: "pw-ui-fixer", session_id: "s1", cwd: ws.root, tool_name: "Write", tool_input: { file_path: path.join(ws.root, file), content: "x" } }, env);
  const settings = write("atf/models.yaml");
  assert.equal(settings.status, 2, settings.stderr);
  assert.match(settings.stderr, /workspace-settings/);
  const framework = write("node_modules/@testagentic/atf/config/permissions.yaml");
  assert.equal(framework.status, 2, framework.stderr);
  assert.match(framework.stderr, /framework-readonly/);
  const ok = hook(ws.framework, { agent_type: "pw-ui-fixer", session_id: "s1", cwd: ws.root, tool_name: "Read", tool_input: { file_path: path.join(ws.root, "config", "acme.yaml") } }, env);
  assert.equal(ok.status, 0, ok.stderr);
});

test("the bundled hook still fails closed when a lib, or a package a lib needs, does not load", () => {
  // the hook entries import nothing but node: built-ins statically: every lib, and with it every package, loads
  // inside their try (an inlined lib's js-yaml would be hoisted above it)
  for (const rel of ["scripts/hooks/pretooluse.mjs", "scripts/hooks/posttooluse.mjs", "scripts/hooks/plugin-session.mjs", "bin/atf.mjs"]) {
    const statics = [...read(rel).matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    assert.ok(statics.every((s) => s.startsWith("node:")), `${rel}: ${statics}`);
  }
  assert.match(read("scripts/lib/cli.mjs"), /^import \w+ from "js-yaml";$/m, "a lib that needs a package imports it itself");
  const { root } = startRun(); // a product run is active
  const idle = scratch();
  const payload = { tool_name: "Read", tool_input: { file_path: "README.md" } };
  // a broken lib
  const broken = copyOfDist();
  writeFileSync(path.join(broken, "scripts", "lib", "guard.mjs"), 'throw new Error("broken guard");\n');
  const r = hook(broken, payload, { CLAUDE_PROJECT_DIR: root });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /the framework guard failed \(broken guard\) while a run is active; failing closed/);
  assert.equal(hook(broken, payload, { CLAUDE_PROJECT_DIR: idle }).status, 0, "no run: allowed, as from the source");
  // no js-yaml, ajv or acorn anywhere above the package: the hook still runs (it guards, or fails closed), never crashes
  const bare = path.join(scratch(), "node_modules", "@testagentic", "atf");
  mkdirSync(path.dirname(bare), { recursive: true });
  cpSync(DIST, bare, { recursive: true });
  const m = hook(bare, { agent_type: "pw-ui-fixer", tool_name: "Write", tool_input: { file_path: path.join(root, "atf", "models.yaml"), content: "x" } }, { CLAUDE_PROJECT_DIR: root });
  assert.equal(m.status, 2, m.stderr);
  // the CLI's postinstall catch: cli.mjs can't load without js-yaml, and the install still succeeds
  const post = spawnSync(process.execPath, [path.join(bare, "bin", "atf.mjs"), "sync", "--postinstall"], { cwd: idle, encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(post.status, 0, post.stderr);
  assert.match(post.stderr, /^atf sync \(postinstall\): Cannot find package 'js-yaml'.*Your install itself succeeded/);
  assert.notEqual(spawnSync(process.execPath, [path.join(bare, "bin", "atf.mjs"), "help"], { cwd: idle, encoding: "utf8", env: { PATH: process.env.PATH } }).status, 0, "any other command fails as usual");
});

test("inlining: import.meta.url becomes the module's own path; other import.meta and computed import() are refused", () => {
  const src = '// import.meta.dirname in a comment\nconst a = "import(x)";\nexport const u = import.meta.url;\nexport const r = () => import("./b.mjs");\n';
  const r = inlinedSource(src, "./lib/roots.mjs");
  assert.equal(r.contents, src.replace("import.meta.url;", 'new URL("./lib/roots.mjs", import.meta.url).href;'));
  assert.match(inlinedSource("export const d = import.meta.dirname;\n", "./x.mjs").error, /only import\.meta\.url/);
  assert.match(inlinedSource("const m = './a.mjs';\nexport const f = () => import(m);\n", "./x.mjs").error, /computed specifier \(line 2\)/);
  // in dist: a script inlined into another keeps its own location, so its main-module check doesn't fire there
  assert.match(read("scripts/run.mjs"), /fileURLToPath\d*\(new URL\("\.\/lib\/roots\.mjs", import\.meta\.url\)\.href\)/);
  assert.match(read("scripts/run.mjs"), /process\.argv\[1\] === fileURLToPath\d*\(new URL\("\.\/run-config\.mjs", import\.meta\.url\)\.href\)/);
});

test("the release gate: refuses the DRAFT licence and a tag that doesn't match the version", async () => {
  const TAG = `core-v${SOURCE_PKG.version}`;
  // the framework's own licence is the interim evaluation licence (D-104), which the gate accepts
  assert.equal(licenseIsDraft(read("LICENSE.md", CORE)), false);
  assert.equal(licenseIsDraft("DRAFT\n# EULA\n"), true);
  assert.equal(licenseIsDraft("# End-user licence agreement\nThis agreement replaces any earlier draft.\n"), false);
  assert.deepEqual(releaseErrors(DIST, TAG), []);
  // a placeholder with the marker is refused
  const draft = copyOfDist();
  writeFileSync(path.join(draft, "LICENSE.md"), `${DRAFT_MARKER}\n\n# placeholder\n`);
  assert.deepEqual(releaseErrors(draft, TAG), [`LICENSE.md is still the placeholder (${DRAFT_MARKER}): legal's EULA must replace it before a release`]);
  const dist = copyOfDist();
  writeFileSync(path.join(dist, "LICENSE.md"), "# End-user licence agreement\nAll rights reserved.\n");
  assert.deepEqual(releaseErrors(dist, TAG), []);
  assert.deepEqual(releaseErrors(dist, "core-v99.0.0"), [`tag core-v99.0.0 does not match the package version ${SOURCE_PKG.version} (packages/core/package.json)`]);
  assert.deepEqual(releaseErrors(dist, "v0.1.0"), ["tag 'v0.1.0' is not core-v<semver>"]);
  // the command the release workflow runs
  const gate = (out, tag) => spawnSync(process.execPath, [path.join(CORE, "scripts", "build-package.mjs"), "--release", tag, "--out", out], { encoding: "utf8" });
  assert.equal(gate(draft, TAG).status, 1);
  assert.equal(gate(dist, TAG).status, 0);
  assert.equal(await main(["--release", TAG, "--out", path.join(scratch(), "none")]), 1);
});
