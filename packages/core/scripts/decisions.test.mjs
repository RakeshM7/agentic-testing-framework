// docs/decisions.md stays consistent (and its Affects paths real), and the governance policy asks before a governed
// file changes. The log, and the paths its Affects name, are the workspace's: this repo's root, where a framework file
// is named by its path from there (`packages/core/scripts/...` in the monorepo). Each workspace has its own log
// (docs/packaging.md §3.7): atf/atf.json names it, else atf/decisions.md, a client's, which starts from
// templates/workspace/decisions.md; the monorepo's atf.json names docs/decisions.md.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { frameworkRoot, workspaceRoot } from "./lib/contract.mjs";
import { DECISIONS_FILE, checkDecisions, confirmedIn, decisionsFile, entryText, loadDecisions, parseDecisions, rememberConfirmed, shellWriteTargets } from "./lib/decisions.mjs";
import { main as cli } from "./decisions.mjs";
import { globToRegExp } from "./lib/permissions.mjs";
import { toolCall } from "./lib/tool-call.mjs";
import { expandFw, frameworkRel } from "./lib/roots.mjs";
import { put, tempRoot } from "./test-helpers.mjs";

const fwPath = (rel) => expandFw(`{fw}/${rel}`, frameworkRel(workspaceRoot, frameworkRoot));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const LOG_PATH = decisionsFile(workspaceRoot).path;
const text = readFileSync(LOG_PATH, "utf8");
const decisions = parseDecisions(text);
const index = new Map([...text.matchAll(/^\| (D-\d{3}) \| (.+?) \| (.+?) \| (\d{4}-\d{2}-\d{2}) \|$/gm)].map(([, id, title, status]) => [id, { title, status }]));
const repoFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: workspaceRoot, encoding: "utf8" }).split("\n").filter(Boolean);

test("decision IDs are unique and sequential", () => {
  assert.ok(decisions.length > 0);
  decisions.forEach((d, i) => assert.equal(d.id, `D-${String(i + 1).padStart(3, "0")}`));
});

test("every decision has a matching index row, and the index has no extra rows", () => {
  for (const d of decisions) {
    const row = index.get(d.id);
    assert.ok(row, `${d.id} is missing from the index`);
    assert.equal(row.title, d.title, `${d.id}: index title differs from the heading`);
    assert.equal(row.status.split(/[\s(]/)[0], d.status.split(/[\s(]/)[0], `${d.id}: index status differs from the entry`);
  }
  assert.equal(index.size, decisions.length);
});

test("statuses are Accepted or Superseded, and every referenced decision exists", () => {
  const ids = new Set(decisions.map((d) => d.id));
  for (const d of decisions) assert.match(d.status, /^(Accepted|Superseded by D-\d{3})/, `${d.id}: unknown status`);
  for (const [ref] of text.matchAll(/\bD-\d{3}\b/g)) assert.ok(ids.has(ref), `reference to unknown decision ${ref}`);
});

test("every Affects path matches a file in the repo, so governance never silently goes stale", () => {
  for (const d of decisions) {
    assert.ok(d.affects.length, `${d.id}: Affects lists no path`);
    for (const g of d.affects) assert.ok(repoFiles.some((f) => globToRegExp(g).test(f)), `${d.id}: Affects \`${g}\` matches no file`);
  }
});

// The entries recorded before the framework moved to packages/core are frozen (docs/packaging.md §3.11, phase 2a). Only
// two edits may touch them: a Status value (a later decision supersedes one) and the mechanical re-rooting of an Affects
// path: `packages/core/` before a framework path, and `packages/core/bin/atf.mjs` for `Makefile` (phase 2b). Their
// normalized texts are hashed in scripts/fixtures/decisions-frozen.json; any other rewrite changes a hash.
const frozenForm = (entry) =>
  entry
    .replace(/\r\n/g, "\n")
    .replace(/^(- \*\*Status:\*\* )[^·\n]*/m, "$1")
    .replace(/^- \*\*Affects:\*\* .*$/m, (line) => line.replaceAll("`packages/core/bin/atf.mjs`", "`Makefile`").replaceAll("`packages/core/", "`"));
const frozenHash = (entry) => createHash("sha256").update(frozenForm(entry)).digest("hex");

test("the entries recorded before the move are frozen: only a Status or a mechanical Affects re-rooting may change", () => {
  const frozen = JSON.parse(readFileSync(path.join(frameworkRoot, "scripts", "fixtures", "decisions-frozen.json"), "utf8"));
  assert.equal(Object.keys(frozen).length, 85, "D-001 to D-085");
  for (const [id, hash] of Object.entries(frozen)) {
    const entry = entryText(text, id);
    assert.ok(entry, `${id} is missing`);
    assert.equal(frozenHash(entry), hash, `${id} was rewritten: only its Status, or a packages/core/ prefix on an Affects path, may change`);
  }
  // the normalization forgives exactly those two edits, and nothing else
  const entry = entryText(text, "D-002");
  const moved = entry.replace(/^(- \*\*Status:\*\* )[^·\n]*/m, "$1Superseded by D-999 (2099-01-01) ").replace(/^- \*\*Affects:\*\* .*$/m, (l) => l.replace(/`(?!packages\/core\/)([^`]+)`/g, "`packages/core/$1`"));
  assert.equal(frozenHash(moved), frozenHash(entry));
  assert.notEqual(frozenHash(entry.replace(/^- \*\*Affects:\*\* `/m, "- **Affects:** `lib/")), frozenHash(entry), "another prefix is a rewrite");
  assert.notEqual(frozenHash(entry.replace("scripts", "Scripts")), frozenHash(entry), "a text edit is a rewrite");
});

// ---- the policy ----------------------------------------------------------------------------------------------------
const LOG = `### D-001 · Keep the guard
- **Status:** Accepted · **Date:** 2026-01-01 · **Source:** x
- **Affects:** \`scripts/lib/guard.mjs\`, \`config/*.yaml\`

### D-002 · Old idea
- **Status:** Superseded by D-001 (2026-01-02) · **Date:** 2026-01-01 · **Source:** x
- **Affects:** \`docs/old.md\`
`;
const parsed = { decisions: parseDecisions(LOG) };
const write = (file, sessionId) => toolCall({ kind: "write", tool: "Edit", paths: [file], sessionId });
const sh = (command) => toolCall({ kind: "shell", tool: "Bash", command });

test("a write to a path an Accepted decision governs asks, naming the decision; anything else is allowed", () => {
  const root = tempRoot();
  const v = checkDecisions(write(path.join(root, "config/permissions.yaml")), root, parsed);
  assert.equal(v.decision, "ask");
  assert.deepEqual(v.ids, ["D-001"]);
  assert.match(v.reason, /D-001 "Keep the guard" \(config\/permissions\.yaml\)/);
  assert.equal(checkDecisions(write("docs/old.md"), root, parsed).decision, "allow", "superseded decisions govern nothing");
  assert.equal(checkDecisions(write("agents/x.md"), root, parsed).decision, "allow");
  assert.equal(checkDecisions(write("artifacts/acme/config/a.yaml"), root, parsed).decision, "allow", "run output is never governed");
  assert.equal(checkDecisions(toolCall({ kind: "read", tool: "Read", paths: ["config/a.yaml"] }), root, parsed).decision, "allow");
});

test("shell commands ask only when they write a governed path, not when they merely mention one", () => {
  const root = tempRoot();
  const ask = (cmd) => checkDecisions(sh(cmd), root, parsed).decision;
  for (const cmd of ["echo x > config/models.yaml", "sed -i '' 's/a/b/' scripts/lib/guard.mjs", "rm -f scripts/lib/guard.mjs", "git restore config/permissions.yaml", "cat a | tee config/x.yaml", "cp /tmp/g.mjs scripts/lib/guard.mjs"])
    assert.equal(ask(cmd), "ask", cmd);
  for (const cmd of ["node scripts/lib/guard.mjs", "cat config/models.yaml", "npm test 2>&1 | tail", "cp scripts/lib/guard.mjs /tmp/g.mjs", "git checkout main"])
    assert.equal(ask(cmd), "allow", cmd);
  assert.deepEqual(shellWriteTargets("A=1 sed -i.bak -e s/x/y/ f1 f2 && echo ok >> log.txt"), ["s/x/y/", "f1", "f2", "log.txt"]);
});

test("after the user confirms an edit under a decision, the rest of the session does not ask again", () => {
  const root = tempRoot();
  const file = path.join(root, "scripts/lib/guard.mjs");
  assert.equal(checkDecisions(write(file, "s1"), root, { ...parsed, confirmed: confirmedIn(root, "s1") }).decision, "ask");
  rememberConfirmed(root, "s1", ["D-001"]);
  assert.equal(checkDecisions(write(file, "s1"), root, { ...parsed, confirmed: confirmedIn(root, "s1") }).decision, "allow");
  assert.equal(checkDecisions(write(file, "s2"), root, { ...parsed, confirmed: confirmedIn(root, "s2") }).decision, "ask", "another session asks");
  assert.equal(confirmedIn(root, undefined).size, 0, "no session id, no memory");
});

test("an unreadable log makes every framework write ask; a missing log governs nothing", () => {
  const root = tempRoot();
  assert.equal(checkDecisions(write("scripts/x.mjs"), root, { error: "bad entry" }).decision, "ask");
  assert.equal(checkDecisions(write("artifacts/acme/x.md"), root, { error: "bad entry" }).decision, "allow");
  assert.throws(() => parseDecisions("### D-001 · No status\n"), /needs a Status and an Affects line/);
});

// The hook entries as a host runs them: a bare environment, plus the temp dir variables so the session memo lands where
// this suite may write.
const TMP_ENV = Object.fromEntries(["TMPDIR", "TEMP", "TMP"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
const hook = (root) => (script, payload) =>
  execFileSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", script), "--host", "claude-code"], { input: JSON.stringify(payload), env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: root, ...TMP_ENV }, encoding: "utf8" });
const editPayload = (root, rel) => ({ session_id: `t-${process.pid}-${Date.now()}-${Math.random()}`, tool_name: "Edit", tool_input: { file_path: path.join(root, rel) } });

test("the hook entry asks Claude Code to confirm a governed edit, and remembers it after the edit", () => {
  // the monorepo's shape: atf.json names docs/decisions.md
  const root = tempRoot();
  put(root, "atf/atf.json", JSON.stringify({ decisions: "docs/decisions.md" }));
  put(root, "docs/decisions.md", LOG);
  const run = hook(root);
  const payload = editPayload(root, "config/permissions.yaml");
  const asked = JSON.parse(run("pretooluse.mjs", payload)).hookSpecificOutput;
  assert.equal(asked.permissionDecision, "ask");
  assert.match(asked.permissionDecisionReason, /See docs\/decisions\.md\./);
  run("posttooluse.mjs", payload);
  assert.equal(run("pretooluse.mjs", payload), "", "confirmed for this session: allowed silently");
});

test("the decision lookup (D-082): the decisions governing a file, the index, and full entries, from the log itself", () => {
  const LOG_PATH = decisionsFile(workspaceRoot).path;
const text = readFileSync(LOG_PATH, "utf8");
  const all = parseDecisions(text);
  const decisionsCli = (argv) => cli(argv, { root: workspaceRoot, cwd: workspaceRoot });
  const forRun = decisionsCli(["for", fwPath("scripts/run.mjs"), "docs/nothing-here.md"]);
  assert.equal(forRun.code, 0);
  const ids = forRun.out.files[0].decisions.map((d) => d.id);
  assert.ok(ids.includes("D-071") && ids.includes("D-072"), "the hook's own matching on Affects");
  assert.ok(ids.every((id) => all.find((d) => d.id === id).accepted), "only Accepted decisions");
  assert.deepEqual(forRun.out.files[1], { path: "docs/nothing-here.md", decisions: [] });
  const files = fwPath("scripts/lib/files.mjs");
  const full = decisionsCli(["for", files, "--full"]).out;
  assert.match(full, new RegExp(`^<!-- ${escapeRe(files)}: D-072 -->\n\n### D-072 · `));
  assert.equal(full.trimEnd(), `<!-- ${files}: D-072 -->\n\n${entryText(text, "D-072")}`);
  const index = decisionsCli(["index"]).out.accepted;
  assert.deepEqual(index.map((d) => d.id), all.filter((d) => d.accepted).map((d) => d.id));
  assert.ok(!index.some((d) => d.id === "D-047"), "a superseded decision is not in the index");
  assert.match(decisionsCli(["show", "D-047"]).out, /^### D-047 · .+\n- \*\*Status:\*\* Superseded by D-072/);
  assert.match(decisionsCli(["show", "D-999"]).out.errors[0], /D-999 is not in docs\/decisions\.md/);
  assert.equal(decisionsCli([]).code, 2);
});

test("the decision lookup reads a relative path from a working directory inside the workspace, else from its root", () => {
  // from the framework's own folder, `scripts/run.mjs` is the framework's (packages/core/scripts/run.mjs in the monorepo)
  const fromFw = cli(["for", "scripts/run.mjs"], { root: workspaceRoot, cwd: frameworkRoot }).out.files[0];
  assert.equal(fromFw.path, fwPath("scripts/run.mjs"));
  assert.ok(fromFw.decisions.some((d) => d.id === "D-071"), "governed by its decisions");
  // from outside the workspace, a relative path is the workspace root's
  assert.equal(cli(["for", "docs/decisions.md"], { root: workspaceRoot, cwd: tmpdir() }).out.files[0].path, "docs/decisions.md");
  assert.equal(cli(["for", path.join(workspaceRoot, "AGENTS.md")], { root: workspaceRoot, cwd: tmpdir() }).out.files[0].path, "AGENTS.md");
});

// ---- each workspace's own log (docs/packaging.md §3.7) ---------------------------------------------------------------
const CLIENT_LOG = `# Design decisions

## Index

| ID | Decision | Status | Date |
|---|---|---|---|
| D-001 | Locators are roles first | Accepted | 2026-10-26 |

## Decisions

### D-001 · Locators are roles first
- **Status:** Accepted · **Date:** 2026-10-26 · **Source:** team review
- **Decision:** page objects use getByRole before any CSS.
- **Why:** stable across restyles.
- **Affects:** \`atf/agents/pw-ui-pom-writer.extra.md\`, \`config/acme.yaml\`
`;
// a client-style workspace: the marker atf.json (`{}` unless given) and, when given, the log at atf/decisions.md
const clientRoot = ({ atf = "{}", log } = {}) => {
  const root = tempRoot();
  put(root, "atf/atf.json", atf);
  if (log !== undefined) put(root, "atf/decisions.md", log);
  return root;
};

test("the log is atf/decisions.md by default: a client's entries govern its files, and the messages name that file", () => {
  assert.equal(DECISIONS_FILE, "atf/decisions.md");
  const root = clientRoot({ log: CLIENT_LOG });
  assert.deepEqual(decisionsFile(root), { file: "atf/decisions.md", path: path.join(root, "atf", "decisions.md") });
  const loaded = loadDecisions(root);
  assert.equal(loaded.file, "atf/decisions.md");
  assert.deepEqual(loaded.decisions.map((d) => d.id), ["D-001"]);
  const v = checkDecisions(write(path.join(root, "config/acme.yaml")), root, loaded);
  assert.equal(v.decision, "ask");
  assert.deepEqual(v.ids, ["D-001"]);
  assert.match(v.reason, /D-001 "Locators are roles first" \(config\/acme\.yaml\)\. See atf\/decisions\.md\. .* goes into atf\/decisions\.md in the same change/);
  // a docs/decisions.md the workspace doesn't name is no log of it
  const other = clientRoot();
  put(other, "docs/decisions.md", CLIENT_LOG);
  assert.deepEqual(loadDecisions(other), { decisions: [], file: "atf/decisions.md" }, "a missing log governs nothing");
  assert.equal(checkDecisions(write("config/acme.yaml"), other, loadDecisions(other)).decision, "allow");
  // no marker at all (a hook outside any workspace): the default too
  assert.equal(decisionsFile(tempRoot()).file, "atf/decisions.md");
  // a malformed client entry fails closed, naming the client's file
  const bad = clientRoot({ log: "### D-001 · No status\n" });
  const broken = loadDecisions(bad);
  assert.match(broken.error, /^atf\/decisions\.md: D-001 needs a Status and an Affects line/);
  assert.match(checkDecisions(write("config/acme.yaml"), bad, broken).reason, /^atf\/decisions\.md could not be read/);
});

test("the monorepo's atf.json names docs/decisions.md, the maintainers' log", () => {
  // (and its dev-only agents' folder, docs/packaging.md §3.8)
  assert.deepEqual(JSON.parse(readFileSync(path.join(workspaceRoot, "atf", "atf.json"), "utf8")), { decisions: "docs/decisions.md", dev_agents: "dev/agents" });
  assert.deepEqual(decisionsFile(workspaceRoot), { file: "docs/decisions.md", path: path.join(workspaceRoot, "docs", "decisions.md") });
  assert.equal(loadDecisions(workspaceRoot).decisions.length, decisions.length);
  // a named path is the workspace's, whatever separator it is written with, and normalized
  for (const [named, file] of [["docs\\decisions.md", "docs/decisions.md"], ["docs/../atf/log.md", "atf/log.md"], ["  ./x/log.md ", "x/log.md"]])
    assert.equal(decisionsFile(clientRoot({ atf: JSON.stringify({ decisions: named }) })).file, file, named);
});

test("an invalid atf.json fails closed: every governed-area write asks, naming atf/atf.json", () => {
  for (const atf of ["{ not json", "[]", "null", "42", JSON.stringify({ decisions: 7 }), JSON.stringify({ decisions: "" }), JSON.stringify({ decisions: null })]) {
    const root = clientRoot({ atf, log: CLIENT_LOG });
    const loaded = loadDecisions(root);
    assert.match(loaded.error, /^atf\/atf\.json /, atf);
    const v = checkDecisions(write("scripts/anything.mjs"), root, loaded);
    assert.equal(v.decision, "ask", atf);
    assert.match(v.reason, /^the workspace's decision log could not be read \(atf\/atf\.json /, atf);
    assert.equal(checkDecisions(write("artifacts/acme/x.md"), root, loaded).decision, "allow", "run output stays ungoverned");
  }
  // an editor's byte-order mark is not a broken file
  assert.equal(decisionsFile(clientRoot({ atf: `\uFEFF${JSON.stringify({ decisions: "docs/log.md" })}` })).file, "docs/log.md");
});

test("a log path outside the workspace fails closed", () => {
  for (const named of ["../decisions.md", "docs/../../decisions.md", "..\\decisions.md", "/etc/decisions.md", "C:/decisions.md", "C:decisions.md", "c:\\decisions.md", "\\\\server\\share\\decisions.md", ".", "docs/.."]) {
    const root = clientRoot({ atf: JSON.stringify({ decisions: named }) });
    const loaded = loadDecisions(root);
    assert.match(loaded.error ?? "", /^atf\/atf\.json "decisions" \(.+\) must name a file inside the workspace/, named);
    assert.equal(checkDecisions(write("config/acme.yaml"), root, loaded).decision, "ask", named);
  }
  const cli_ = cli(["index"], { root: clientRoot({ atf: JSON.stringify({ decisions: "../x.md" }) }) });
  assert.equal(cli_.code, 1);
  assert.match(cli_.out.errors[0], /must name a file inside the workspace/);
});

test("a confirmation is remembered per log: once atf.json names another log, its decisions ask again", () => {
  const root = clientRoot({ log: CLIENT_LOG });
  rememberConfirmed(root, "s-log", ["D-001"]);
  assert.ok(confirmedIn(root, "s-log").has("D-001"));
  put(root, "atf/atf.json", JSON.stringify({ decisions: "docs/other.md" }));
  assert.equal(confirmedIn(root, "s-log").size, 0);
});

test("the hook entry asks to confirm an edit a client's entry governs, naming atf/decisions.md, and remembers it", () => {
  const root = clientRoot({ log: CLIENT_LOG });
  const run = hook(root);
  const payload = editPayload(root, "atf/agents/pw-ui-pom-writer.extra.md");
  const asked = JSON.parse(run("pretooluse.mjs", payload)).hookSpecificOutput;
  assert.equal(asked.permissionDecision, "ask");
  assert.match(asked.permissionDecisionReason, /D-001 "Locators are roles first" \(atf\/agents\/pw-ui-pom-writer\.extra\.md\)\. See atf\/decisions\.md\./);
  run("posttooluse.mjs", payload);
  assert.equal(run("pretooluse.mjs", payload), "", "confirmed for this session: allowed silently");
  assert.equal(run("pretooluse.mjs", editPayload(root, "README.md")), "", "an ungoverned file is not held");
  // a broken atf.json: the hook asks, naming it
  put(root, "atf/atf.json", "{ not json");
  assert.match(JSON.parse(run("pretooluse.mjs", editPayload(root, "README.md"))).hookSpecificOutput.permissionDecisionReason, /atf\/atf\.json could not be read as JSON/);
});

test("the decision lookup reads a client's log: for, index and show", () => {
  const root = clientRoot({ log: CLIENT_LOG });
  const run = (argv) => cli(argv, { root, cwd: root });
  const forRun = run(["for", "config/acme.yaml", "playwright-tests/acme/x.spec.ts"]);
  assert.equal(forRun.code, 0);
  assert.equal(forRun.out.log, "atf/decisions.md");
  assert.deepEqual(forRun.out.files, [
    { path: "config/acme.yaml", decisions: [{ id: "D-001", title: "Locators are roles first" }] },
    { path: "playwright-tests/acme/x.spec.ts", decisions: [] },
  ]);
  assert.equal(forRun.out.warning, undefined);
  assert.equal(run(["for", "config/acme.yaml", "--full"]).out.trimEnd(), `<!-- config/acme.yaml: D-001 -->\n\n${entryText(CLIENT_LOG, "D-001")}`);
  assert.deepEqual(run(["index"]).out, { log: "atf/decisions.md", accepted: [{ id: "D-001", title: "Locators are roles first" }] });
  assert.equal(run(["show", "D-001"]).out, `${entryText(CLIENT_LOG, "D-001")}\n`);
  assert.deepEqual(run(["show", "D-002"]).out.errors, ["D-002 is not in atf/decisions.md"]);
  // no log yet: nothing is governed, and the lookup says so instead of looking like a check that passed
  const none = cli(["index"], { root: clientRoot(), cwd: tmpdir() });
  assert.equal(none.code, 0);
  assert.deepEqual(none.out.accepted, []);
  assert.match(none.out.warning, /^atf\/decisions\.md does not exist/);
});

test("the client log template parses with zero entries, and its lookup commands name the framework by {fw}", () => {
  const template = readFileSync(path.join(frameworkRoot, "templates", "workspace", "decisions.md"), "utf8");
  assert.deepEqual(parseDecisions(template), []);
  assert.equal([...template.matchAll(/^\| D-\d{3} \|/gm)].length, 0, "an empty index");
  assert.match(template, /^## Index\n\n\| ID \| Decision \| Status \| Date \|\n\|---\|---\|---\|---\|\n/m);
  for (const cmd of ["for <every file you will change> --full", "index", "show <D-NNN>"]) assert.ok(template.includes(`\`node {fw}/scripts/decisions.mjs ${cmd}\``), cmd);
  assert.doesNotMatch(template, /packages\/core|docs\/decisions\.md|scripts\/lib\//, "no maintainer paths");
  // installed as a client's log, the lookup and the hook read it as an empty log
  const root = clientRoot({ log: template });
  assert.deepEqual(loadDecisions(root), { decisions: [], file: "atf/decisions.md" });
  assert.deepEqual(cli(["index"], { root }).out, { log: "atf/decisions.md", accepted: [] });
  assert.equal(checkDecisions(write("config/acme.yaml"), root, loadDecisions(root)).decision, "allow");
});
