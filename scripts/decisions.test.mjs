// docs/decisions.md stays consistent (and its Affects paths real), and the governance policy asks before a governed
// file changes.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { frameworkRoot } from "./lib/contract.mjs";
import { DECISIONS_FILE, checkDecisions, confirmedIn, entryText, parseDecisions, rememberConfirmed, shellWriteTargets } from "./lib/decisions.mjs";
import { main as decisionsCli } from "./decisions.mjs";
import { globToRegExp } from "./lib/permissions.mjs";
import { toolCall } from "./lib/tool-call.mjs";
import { tempRoot } from "./test-helpers.mjs";

const text = readFileSync(path.join(frameworkRoot, DECISIONS_FILE), "utf8");
const decisions = parseDecisions(text);
const index = new Map([...text.matchAll(/^\| (D-\d{3}) \| (.+?) \| (.+?) \| (\d{4}-\d{2}-\d{2}) \|$/gm)].map(([, id, title, status]) => [id, { title, status }]));
const repoFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: frameworkRoot, encoding: "utf8" }).split("\n").filter(Boolean);

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

test("the hook entry asks Claude Code to confirm a governed edit, and remembers it after the edit", () => {
  const root = tempRoot();
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, DECISIONS_FILE), LOG);
  const run = (script, payload) =>
    execFileSync(process.execPath, [path.join(frameworkRoot, "scripts", "hooks", script), "--host", "claude-code"], { input: JSON.stringify(payload), env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: root }, encoding: "utf8" });
  const payload = { session_id: `t-${process.pid}-${Date.now()}`, tool_name: "Edit", tool_input: { file_path: path.join(root, "config/permissions.yaml") } };
  assert.equal(JSON.parse(run("pretooluse.mjs", payload)).hookSpecificOutput.permissionDecision, "ask");
  run("posttooluse.mjs", payload);
  assert.equal(run("pretooluse.mjs", payload), "", "confirmed for this session: allowed silently");
});

test("the decision lookup (D-082): the decisions governing a file, the index, and full entries, from the log itself", () => {
  const text = readFileSync(path.join(frameworkRoot, DECISIONS_FILE), "utf8");
  const all = parseDecisions(text);
  const forRun = decisionsCli(["for", "scripts/run.mjs", "docs/nothing-here.md"]);
  assert.equal(forRun.code, 0);
  const ids = forRun.out.files[0].decisions.map((d) => d.id);
  assert.ok(ids.includes("D-071") && ids.includes("D-072"), "the hook's own matching on Affects");
  assert.ok(ids.every((id) => all.find((d) => d.id === id).accepted), "only Accepted decisions");
  assert.deepEqual(forRun.out.files[1], { path: "docs/nothing-here.md", decisions: [] });
  const full = decisionsCli(["for", "scripts/lib/files.mjs", "--full"]).out;
  assert.match(full, /^<!-- scripts\/lib\/files\.mjs: D-072 -->\n\n### D-072 · /);
  assert.equal(full.trimEnd(), `<!-- scripts/lib/files.mjs: D-072 -->\n\n${entryText(text, "D-072")}`);
  const index = decisionsCli(["index"]).out.accepted;
  assert.deepEqual(index.map((d) => d.id), all.filter((d) => d.accepted).map((d) => d.id));
  assert.ok(!index.some((d) => d.id === "D-047"), "a superseded decision is not in the index");
  assert.match(decisionsCli(["show", "D-047"]).out, /^### D-047 · .+\n- \*\*Status:\*\* Superseded by D-072/);
  assert.match(decisionsCli(["show", "D-999"]).out.errors[0], /D-999 is not in docs\/decisions\.md/);
  assert.equal(decisionsCli([]).code, 2);
});
