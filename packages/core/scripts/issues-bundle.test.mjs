import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main as issuesCli } from "./framework-issues.mjs";
import { FORMAT_VERSION, Redactor, buildBundle, clientName, collectRuns, evidenceRefs, exportIssues, importBundle, readBundle, sanitizeClient } from "./lib/issues-bundle.mjs";
import { parseFrontmatter } from "./lib/feedback.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { readZip, writeZip } from "./lib/zip.mjs";
import { endRun, initRun } from "./run.mjs";
import { installedWorkspace, put, tempRoot, writeConfig } from "./test-helpers.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const capture = () => {
  const lines = [];
  return { lines, text: () => lines.join("\n"), log: (m) => lines.push(String(m)), error: (m) => lines.push(`ERROR ${m}`) };
};

// A run of product acme in `root` that agents recorded issues in, then ended (as in the framework's source checkout:
// the root is its own framework, so end also writes feedback/run-*; the export reads only the JSON).
async function endedRun(root, runId, issues, framework = root) {
  const r = initRun(writeConfig(root), { root, framework, runId, env: { CLAUDECODE: "1" } });
  assert.equal(r.errors, undefined);
  for (const i of issues) {
    const res = issuesCli(["add", "acme", ...Object.entries(i).flatMap(([k, v]) => [`--${k}`, v])], { root });
    assert.equal(res.code, 0, JSON.stringify(res.out));
  }
  const end = await endRun("acme", { root, framework });
  assert.equal(end.errors, undefined);
  return end;
}

// Every original value the issues and evidence below carry, which the bundle must not hold anywhere.
const ORIGINALS = ["app.acme.test", "acme", "contacts", "deals", "jane.doe", "SuperSecretValue123", "10.1.2.3", "abcDEF123456789xyz", "hunter22", "crm.globex.io", "s3cr3t-cookie"];

// A workspace with two ended runs: the first with two issues and evidence files, the second with one.
async function workspace() {
  const root = tempRoot();
  put(root, "atf/atf.json", JSON.stringify({ client: "Globex Labs" }));
  put(root, "artifacts/acme/modules/contacts/explore/notes.txt", "jane.doe@acme.com signed in at https://app.acme.test/deals with Cookie: sid=s3cr3t-cookie\n");
  put(root, "artifacts/acme/modules/contacts/explore/shot.png", PNG);
  put(root, "artifacts/acme/modules/contacts/explore/network-inventory.json", '{"url":"https://app.acme.test/api/contacts"}');
  await endedRun(root, "acme-run-1", [
    {
      from: "module-explorer",
      kind: "prompt",
      target: "agents/module-explorer.md",
      summary: "Step 3 fails on https://app.acme.test/contacts/42 for jane.doe@acme.com",
      evidence: `token=SuperSecretValue123 from 10.1.2.3, Authorization: Bearer abcDEF123456789xyz; ContactsPage; see ${path.join(root, "artifacts/acme/modules/contacts/explore/notes.txt")}:3 and artifacts/acme/modules/contacts/explore/shot.png and artifacts/acme/modules/contacts/explore/network-inventory.json`,
      fix: "password=hunter22 should never be logged",
      severity: "high",
    },
    { from: "pw-ui-pom-writer", kind: "script", target: "scripts/lib/ui-code.mjs", summary: "check rejects a valid getByLabel on the deals page", evidence: "api at crm.globex.io returned 500" },
  ]);
  await endedRun(root, "acme-run-2", [{ from: "testcase-writer", kind: "doc", target: "docs/a-missing-doc.md", summary: "the contacts glossary contradicts the doc", evidence: "see the doc" }]);
  return root;
}

const unzip = (root, file) => {
  const z = readZip(readFileSync(path.join(root, file)));
  assert.equal(z.error, undefined);
  return new Map(z.entries.map((e) => [e.name, e.data]));
};
const zipsIn = (dir) => readdirSync(dir).filter((f) => f.endsWith(".zip"));

test("redaction: one placeholder per distinct value and kind, stable across texts; the summary never holds a value", () => {
  const r = new Redactor({ workspace: "/work/ws", home: "/Users/bob", hosts: ["app.acme.test"], products: ["acme-crm"], modules: ["contacts", "deals"] });
  const cases = [
    ["url", "open https://app.acme.test/contacts?id=5.", "open <url-1>."],
    ["host", "see app.acme.test and api.globex.com", "see <host-1> and <host-2>"],
    ["email", "mail Jane.Doe@Acme.com", "mail <email-1>"],
    ["ip", "from 10.1.2.3 and fe80::1ff:fe23:4567:890a", "from <ip-1> and <ip-2>"],
    ["secret", "Authorization: Bearer abcdef123456789", "Authorization: Bearer <secret-1>"],
    ["secret", "token=abc123 password: \"hunter2\" x-api-key: zzz", "token=<secret-2> password: \"<secret-3>\" x-api-key: <secret-4>"],
    ["secret", "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "jwt <secret-5>"],
    ["secret", "hex 0123456789abcdef0123456789abcdef and b64 QWxhZGRpbjpvcGVuIHNlc2FtZQ9xYzE4MjM0NTY3", "hex <secret-6> and b64 <secret-7>"],
    ["id", "entity 123e4567-e89b-12d3-a456-426614174000", "entity <id-1>"],
    ["path", "at /work/ws/artifacts/x.json, /Users/bob/notes and C:\\Users\\carol\\y", "at <workspace>/artifacts/x.json, <home>/notes and <path-1>\\y"],
    ["product", "run acme-crm-20261026-1230 of acme-crm, AcmeCrmPage", "run <product-1>-20261026-1230 of <product-1>, <product-1>Page"],
    ["module", "the contacts-list state, newDealsList and contactsTable", "the <module-1>-list state, new<module-2>List and <module-1>Table"],
  ];
  for (const [kind, input, want] of cases) assert.equal(r.text(input, `t/${kind}`), want, kind);
  // the same value again: the same placeholder; framework words stay
  assert.equal(r.text("again app.acme.test, jane.doe@acme.com and contacts", "t/again"), "again <host-1>, <email-1> and <module-1>");
  assert.equal(r.text("explore.mjs refuses --item in agents/module-explorer.md: page.goto( at 12:30:45 on v20.1.0", "t/plain"), "explore.mjs refuses --item in agents/module-explorer.md: page.goto( at 12:30:45 on v20.1.0");
  const s = r.summary();
  const host = s.values.find((v) => v.placeholder === "<host-1>");
  assert.deepEqual(host, { kind: "host", placeholder: "<host-1>", count: 2, where: ["t/again", "t/host"] });
  const text = JSON.stringify(s);
  for (const v of ["acme", "jane", "globex", "10.1.2.3", "hunter2", "abcdef123456789", "/work/ws", "bob", "carol", "contacts", "deals"]) assert.ok(!text.toLowerCase().includes(v), `summary holds ${v}`);
});

test("export: the whole bundle, evidence left out by default; no original value anywhere in the zip", async () => {
  const root = await workspace();
  const out = capture();
  const now = new Date("2026-10-27T09:00:00Z");
  assert.equal(await exportIssues({ workspace: root, framework: frameworkRoot, yes: true, log: out, now, home: "/nonexistent-home" }), 0, out.text());
  assert.deepEqual(zipsIn(root), ["atf-issues-globex-labs-2026-10-27.zip"]);
  const files = unzip(root, "atf-issues-globex-labs-2026-10-27.zip");
  const ids = JSON.parse(readFileSync(path.join(root, "artifacts/acme/results/acme-run-1/framework-issues.json"), "utf8")).issues.map((i) => i.id);
  const id2 = JSON.parse(readFileSync(path.join(root, "artifacts/acme/results/acme-run-2/framework-issues.json"), "utf8")).issues[0].id;
  assert.deepEqual([...files.keys()], ["manifest.json", "evidence/run-1/e1.txt", `issues/run-1/${ids[0]}.json`, `issues/run-1/${ids[1]}.json`, "runs/run-1.json", `issues/run-2/${id2}.json`, "runs/run-2.json"]);

  const m = JSON.parse(files.get("manifest.json"));
  assert.equal(m.format, "atf-issues");
  assert.equal(m.formatVersion, FORMAT_VERSION);
  assert.equal(m.client, "globex-labs");
  assert.deepEqual(m.tool.contract, 2);
  assert.deepEqual(m.runs.map((r) => [r.run, r.runId, r.issues.length]), [["run-1", "<product-1>-run-1", 2], ["run-2", "<product-1>-run-2", 1]]);
  assert.deepEqual(m.evidence.included.map((e) => [e.entry, e.name, e.redacted]), [["evidence/run-1/e1.txt", "artifacts/<product-1>/modules/<module-1>/explore/notes.txt", true]]);
  assert.deepEqual(m.evidence.leftOut.map((e) => [e.name, e.size, e.reason]), [
    ["artifacts/<product-1>/modules/<module-1>/explore/shot.png", PNG.length, "binary"],
    ["artifacts/<product-1>/modules/<module-1>/explore/network-inventory.json", 44, "network body"],
  ]);
  const kinds = m.redactions.values.map((v) => v.kind);
  for (const k of ["path", "secret", "url", "email", "ip", "host", "product", "module"]) assert.ok(kinds.includes(k), `a ${k} redaction`);
  assert.ok(m.redactions.values.every((v) => /^<[a-z]+(-\d+)?>$/.test(v.placeholder) && v.count > 0 && v.where.length), "kind, placeholder, count and where");

  const issue = JSON.parse(files.get(`issues/run-1/${ids[0]}.json`));
  assert.equal(issue.target, "agents/module-explorer.md", "the framework's own file is not client data");
  assert.match(issue.summary, /^Step 3 fails on <url-\d+> for <email-\d+>$/);
  assert.match(issue.evidence, /^token=<secret-\d+> from <ip-1>, Authorization: Bearer <secret-\d+>; <module-1>Page; see <workspace>\/artifacts\/<product-1>\/modules\/<module-1>\/explore\/notes\.txt:3/);
  assert.equal(issue.fix, `password=${issue.fix.match(/<secret-\d+>/)[0]} should never be logged`);
  assert.deepEqual(issue.evidenceFiles.map((e) => e.entry ?? e.leftOut), ["evidence/run-1/e1.txt", "binary", "network body"]);
  // a target the framework lacks goes through the redactor (nothing to replace in this one)
  assert.equal(JSON.parse(files.get(`issues/run-2/${id2}.json`)).target, "docs/a-missing-doc.md");
  assert.equal(JSON.parse(files.get(`issues/run-2/${id2}.json`)).summary, "the <module-1> glossary contradicts the doc");
  assert.match(files.get("evidence/run-1/e1.txt").toString(), /^<email-1> signed in at <url-\d+> with Cookie: <secret-\d+>\n$/);

  const run = JSON.parse(files.get("runs/run-1.json"));
  assert.deepEqual([run.product, run.environment, run.recorded, run.host, run.contract, run.node, run.issues], ["<product-1>", "default", true, "claude-code", 2, process.version, ids]);
  assert.deepEqual(run.config.map((c) => c.name), ["permissions.yaml", "models.yaml", "platforms.yaml", "mcp.yaml", "hooks.yaml"]);
  assert.ok(run.config.every((c) => ["framework", "overlay", "ejected"].includes(c.source) && "digest" in c && !("content" in c)));

  // the scan: every entry's name and text, and the archive's raw bytes
  const haystack = [readFileSync(path.join(root, "atf-issues-globex-labs-2026-10-27.zip")).toString("latin1"), ...[...files].flatMap(([n, d]) => [n, d.toString("utf8")])].join("\n").toLowerCase();
  for (const v of [...ORIGINALS, path.basename(root), root]) assert.ok(!haystack.includes(v.toLowerCase()), `the bundle holds '${v}'`);
});

test("export: --include-evidence adds binary as is and network bodies redacted, and the preview warns", async () => {
  const root = await workspace();
  const out = capture();
  assert.equal(await exportIssues({ workspace: root, framework: frameworkRoot, run: "acme-run-1", includeEvidence: true, yes: true, log: out, now: new Date("2026-10-27T09:00:00Z") }), 0, out.text());
  const files = unzip(root, zipsIn(root)[0]);
  const m = JSON.parse(files.get("manifest.json"));
  assert.deepEqual(m.evidence.leftOut, []);
  assert.deepEqual(m.evidence.included.map((e) => [e.entry, e.redacted]), [["evidence/run-1/e1.txt", true], ["evidence/run-1/e2.png", false], ["evidence/run-1/e3.json", true]]);
  assert.ok(files.get("evidence/run-1/e2.png").equals(PNG), "binary, byte for byte");
  assert.match(files.get("evidence/run-1/e3.json").toString(), /^\{"url":"<url-\d+>"\}$/);
  assert.ok(!files.get("evidence/run-1/e3.json").toString().includes("acme"));
  assert.match(out.text(), /WARNING: 1 binary evidence file\(s\) go in as they are, NOT redacted .*evidence\/run-1\/e2\.png \(artifacts\/<product-1>\/modules\/<module-1>\/explore\/shot\.png\)/);
  assert.deepEqual(m.runs.map((r) => r.run), ["run-1"], "--run: that run only");
  assert.equal(m.filter.run, "<product-1>-run-1", "the filter is redacted too");
});

test("export: --run and --since choose the runs; an active run is left out and named", async () => {
  const root = await workspace();
  const hist = (id) => path.join(root, "artifacts/acme/state/history", `${id}.json`);
  for (const [id, at] of [["acme-run-1", "2026-10-01T10:00:00.000Z"], ["acme-run-2", "2026-10-20T10:00:00.000Z"]]) writeFileSync(hist(id), JSON.stringify({ ...JSON.parse(readFileSync(hist(id), "utf8")), endedAt: at }));
  assert.deepEqual(collectRuns(root, { since: "2026-10-15" }).runs.map((r) => r.runId), ["acme-run-2"]);
  assert.deepEqual(collectRuns(root, { since: "2026-10-01" }).runs.map((r) => r.runId), ["acme-run-1", "acme-run-2"]);
  assert.deepEqual(collectRuns(root, { since: "2026-10-21" }).runs, []);
  assert.deepEqual(collectRuns(root, { run: "acme-run-1" }).runs.map((r) => r.runId), ["acme-run-1"]);
  assert.match(collectRuns(root, { run: "acme-run-9" }).error, /^no ended run acme-run-9 in /);
  initRun(writeConfig(root), { root, framework: root, runId: "acme-run-3", env: { CLAUDECODE: "1" } });
  assert.match(collectRuns(root, { run: "acme-run-3" }).error, /run acme-run-3 is still active: end it first/);
  const out = capture();
  assert.equal(await exportIssues({ workspace: root, framework: frameworkRoot, since: "2026-10-21", dryRun: true, log: out }), 0);
  assert.match(out.text(), /1 run\(s\) still active, left out until they end: acme-run-3\n[\s\S]*no framework issues in 0 ended run\(s\) since 2026-10-21: nothing to export\./);
});

test("export: the preview lists every entry, issue and redaction; --dry-run writes nothing; no terminal without --yes refuses; a typed yes writes; never overwrites", async () => {
  const root = await workspace();
  const now = new Date("2026-10-27T09:00:00Z");
  const run = async (opts) => {
    const out = capture();
    const code = await exportIssues({ workspace: root, framework: frameworkRoot, log: out, now, ...opts });
    return { code, text: out.text() };
  };
  const dry = await run({ dryRun: true });
  assert.equal(dry.code, 0);
  assert.deepEqual(zipsIn(root), [], "a dry run writes nothing");
  assert.match(dry.text, /^atf issues export: 3 framework issue\(s\) from 2 ended run\(s\), for client globex-labs$/m);
  assert.match(dry.text, /^ {2}run-1 {2}FI-[0-9a-f]{8} {2}\[high\] prompt agents\/module-explorer\.md: Step 3 fails on <url-\d+> for <email-\d+>$/m);
  for (const e of ["manifest.json", "runs/run-1.json", "runs/run-2.json", "evidence/run-1/e1.txt"]) assert.match(dry.text, new RegExp(`^ {2}${e.replaceAll(".", "\\.")} `, "m"));
  assert.match(dry.text, /^Redacted: \d+ occurrence\(s\) of \d+ value\(s\) \(path \d+, secret \d+, url \d+, email \d+, ip \d+, host \d+, product \d+, module \d+\); the original values are not in the bundle:$/m);
  assert.match(dry.text, /^ {2}host {5}<host-1> +x\d+ +issues\/run-1\//m);
  assert.match(dry.text, /^Left out of the bundle[\s\S]*shot\.png {2}16 B {2}binary\n[\s\S]*--include-evidence adds/m);
  assert.match(dry.text, /Dry run: nothing written \(it would go to .*atf-issues-globex-labs-2026-10-27\.zip\)\.$/);
  for (const v of ORIGINALS) assert.ok(!dry.text.toLowerCase().includes(v.toLowerCase()), `the preview shows '${v}'`);

  const refused = await run({});
  assert.equal(refused.code, 1);
  assert.match(refused.text, /ERROR atf issues export: not written: confirm on a terminal by typing yes, or pass --yes/);
  assert.deepEqual(zipsIn(root), []);
  const declined = await run({ interactive: true, ask: async () => "y" });
  assert.equal(declined.code, 1);
  assert.match(declined.text, /Not written\.$/);
  assert.deepEqual(zipsIn(root), []);
  let asked;
  const typed = await run({ interactive: true, ask: async (q) => ((asked = q), " yes\n") });
  assert.equal(typed.code, 0, typed.text);
  assert.match(asked, /^Type yes to write .*atf-issues-globex-labs-2026-10-27\.zip: $/);
  const again = await run({ yes: true });
  assert.equal(again.code, 0);
  assert.deepEqual(zipsIn(root).sort(), ["atf-issues-globex-labs-2026-10-27-2.zip", "atf-issues-globex-labs-2026-10-27.zip"], "a fresh name, never an overwrite");
  const elsewhere = path.join(tempRoot(), "out");
  assert.equal((await run({ yes: true, out: elsewhere })).code, 0);
  assert.deepEqual(zipsIn(elsewhere), ["atf-issues-globex-labs-2026-10-27.zip"]);
});

test("the client name: --client, else atf/atf.json client, else the workspace package.json name, sanitized", async () => {
  const { root, framework } = installedWorkspace(); // package.json "acme-tests", atf/atf.json {}
  assert.deepEqual(clientName(root), { name: "acme-tests", from: "package.json name" });
  assert.deepEqual(clientName(root, "Initech Corp."), { name: "initech-corp", from: "--client" });
  assert.match(clientName(root, "!!!").error, /--client '!!!' has no letter or digit/);
  put(root, "atf/atf.json", JSON.stringify({ client: "Globex Labs" }));
  assert.deepEqual(clientName(root), { name: "globex-labs", from: 'atf/atf.json "client"' });
  put(root, "atf/atf.json", JSON.stringify({ client: 7 }));
  assert.match(clientName(root).error, /"client" must be a name/);
  assert.equal(sanitizeClient("@Acme/Tests..v2"), "acme-tests-v2");
  const bare = tempRoot();
  assert.match(clientName(bare).error, /^no client name: set "client" in atf\/atf\.json, or pass --client <name>$/);
  // through an export, in the client's own workspace with the framework installed
  put(root, "atf/atf.json", "{}");
  await endedRun(root, "acme-run-1", [{ from: "module-explorer", kind: "doc", target: "docs/conventions.md", summary: "s", evidence: "e" }], framework);
  assert.equal(existsSync(path.join(root, "feedback")), false, "installed: end wrote no feedback");
  const out = capture();
  assert.equal(await exportIssues({ workspace: root, framework, yes: true, log: out, now: new Date("2026-10-27T00:00:00Z") }), 0, out.text());
  assert.ok(existsSync(path.join(root, "atf-issues-acme-tests-2026-10-27.zip")));
  assert.equal((await exportIssues({ workspace: root, framework: frameworkRoot, client: "Initech", yes: true, log: capture(), now: new Date("2026-10-27T00:00:00Z") })), 0);
  assert.ok(existsSync(path.join(root, "atf-issues-initech-2026-10-27.zip")));
});

test("evidence references: inside the workspace and its output areas only, never secrets", () => {
  const root = tempRoot();
  put(root, "artifacts/acme/x.txt", "x");
  put(root, "artifacts/acme/.auth/state.json", "{}");
  put(root, "playwright-tests/acme/.env.local", "A=1");
  put(root, "config/acme.yaml", "x");
  put(root, "k6-tests/acme/out.json", "{}");
  assert.deepEqual(evidenceRefs(root, [`see artifacts/acme/x.txt:3, ${path.join(root, "k6-tests/acme/out.json")}, artifacts/acme/.auth/state.json, playwright-tests/acme/.env.local, config/acme.yaml, ../etc/passwd.txt, artifacts/acme/missing.txt`]), ["artifacts/acme/x.txt", "k6-tests/acme/out.json"]);
  // a `~` in a path (Windows 8.3 short names such as C:\Users\RUNNER~1\...) stays part of it
  put(root, "artifacts/RUN~1/y.txt", "y");
  assert.deepEqual(evidenceRefs(root, [`${path.join(root, "artifacts", "RUN~1", "y.txt")} and artifacts/RUN~1/y.txt`]), ["artifacts/RUN~1/y.txt"]);
});

test("import: in the framework's source checkout, one feedback file per issue in today's format, marked as a redacted client bundle", async () => {
  const root = await workspace();
  assert.equal(await exportIssues({ workspace: root, framework: frameworkRoot, yes: true, includeEvidence: true, log: capture(), now: new Date("2026-10-27T09:00:00Z") }), 0);
  const zip = path.join(root, "atf-issues-globex-labs-2026-10-27.zip");
  const maintainers = tempRoot();
  const out = capture();
  assert.equal(importBundle({ workspace: maintainers, framework: frameworkRoot, zip, log: out }), 0, out.text());
  const dir = path.join(maintainers, "feedback/client-globex-labs-2026-10-27");
  const md = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  assert.equal(md.length, 3);
  assert.match(out.text(), /^atf issues import: 3 feedback file\(s\) from client globex-labs's bundle \(2 run\(s\), created 2026-10-27T09:00:00\.000Z\) in feedback\/client-globex-labs-2026-10-27, with 3 evidence file\(s\):$/m);
  for (const f of md) assert.match(out.text(), new RegExp(`^ {2}feedback/client-globex-labs-2026-10-27/${f}$`, "m"));
  assert.match(out.text(), /Give these paths to framework-implementor-agent\./);
  const explorer = md.map((f) => readFileSync(path.join(dir, f), "utf8")).find((t) => /source_agent: module-explorer/.test(t));
  const doc = parseFrontmatter(explorer);
  assert.deepEqual(doc.problems, [], "a valid feedback file");
  assert.deepEqual([doc.front.target, doc.front.related_files, doc.front.severity], ["framework", ["agents/module-explorer.md"], "high"]);
  assert.match(explorer, /<!-- Imported by atf issues import from atf-issues-globex-labs-2026-10-27\.zip, a redacted bundle from client globex-labs .*Placeholders such as <host-1> stand for values that stayed in the client's workspace/);
  assert.match(explorer, /^## Finding 1: Step 3 fails on <url-\d+> for <email-\d+>$/m);
  assert.match(explorer, /\*\*Evidence:\*\* token=<secret-\d+> .* Evidence file: feedback\/client-globex-labs-2026-10-27\/evidence\/run-1\/e1\.txt \(artifacts\/<product-1>\/modules\/<module-1>\/explore\/notes\.txt, redacted\)\. Evidence file: .*e2\.png \(.*shot\.png, binary as the client sent it\)/);
  assert.match(explorer, /^\*\*Context:\*\* client globex-labs, run <product-1>-run-1 \(default, ended .*\); .* contract 2, Node v[\d.]+, host claude-code; config: the package's own$/m);
  assert.ok(existsSync(path.join(dir, "evidence/run-1/e2.png")));

  // never overwrites: the same bundle again is refused, with nothing written; --out picks another folder
  const again = capture();
  assert.equal(importBundle({ workspace: maintainers, framework: frameworkRoot, zip, log: again }), 1);
  assert.match(again.text(), /feedback\/client-globex-labs-2026-10-27 exists: nothing written \(was this bundle imported already\? pass --out <new folder>/);
  assert.equal(importBundle({ workspace: maintainers, framework: frameworkRoot, zip, out: path.join(maintainers, "feedback/second"), log: capture() }), 0);
  assert.equal(readdirSync(path.join(maintainers, "feedback/second")).filter((f) => f.endsWith(".md")).length, 3);
});

test("import: refused in a client's workspace, and for a damaged, foreign or newer bundle", async () => {
  const root = await workspace();
  assert.equal(await exportIssues({ workspace: root, framework: frameworkRoot, yes: true, log: capture(), now: new Date("2026-10-27T09:00:00Z") }), 0);
  const zip = path.join(root, "atf-issues-globex-labs-2026-10-27.zip");
  const client = installedWorkspace();
  const refused = capture();
  assert.equal(importBundle({ workspace: client.root, framework: client.framework, zip, log: refused }), 1);
  assert.match(refused.text(), /atf issues import: it runs only in the framework's own source checkout/);
  assert.equal(existsSync(path.join(client.root, "feedback")), false);

  const maintainers = tempRoot();
  const tryImport = (buf) => {
    const f = path.join(tempRoot(), "b.zip");
    writeFileSync(f, buf);
    const out = capture();
    return [importBundle({ workspace: maintainers, framework: frameworkRoot, zip: f, log: out }), out.text()];
  };
  const good = readFileSync(zip);
  const damaged = Buffer.from(good);
  damaged[60] ^= 0xff;
  const [code, text] = tryImport(damaged);
  assert.equal(code, 1);
  assert.match(text, /not a valid bundle: .*; nothing written/);
  const entries = readZip(good).entries;
  const withManifest = (edit) => writeZip(entries.map((e) => (e.name === "manifest.json" ? { name: e.name, data: JSON.stringify(edit(JSON.parse(e.data))) } : e)));
  assert.match(tryImport(withManifest((m) => ({ ...m, formatVersion: FORMAT_VERSION + 1 })))[1], /bundle format version 2, this framework reads 1: update this checkout/);
  assert.match(tryImport(withManifest((m) => ({ ...m, format: "other" })))[1], /is not an atf-issues manifest/);
  assert.match(tryImport(withManifest((m) => ({ ...m, client: "../x" })))[1], /names no valid client/);
  assert.match(tryImport(writeZip([...entries, { name: "extra.sh", data: "x" }]))[1], /entries the manifest doesn't list: extra\.sh/);
  assert.match(tryImport(writeZip(entries.map((e) => (e.name.startsWith("issues/") ? { name: e.name, data: JSON.stringify({ ...JSON.parse(e.data), kind: "bug" }) } : e))))[1], /kind is missing or invalid/);
  assert.match(tryImport(Buffer.from("not a zip"))[1], /not a valid bundle: not a zip file/);
  assert.equal(existsSync(path.join(maintainers, "feedback")), false, "nothing written by any refusal");
  assert.equal(readBundle(good).issues.length, 3);
});

test("buildBundle numbers runs in the bundle and skips an issue whose id isn't one", () => {
  const root = tempRoot();
  const runs = [{ product: "acme", environment: "default", runId: "acme-x", createdAt: null, endedAt: null, outcome: null, data: { issues: [{ id: "../../evil", kind: "doc", target: "t", summary: "s", evidence: "e" }, { id: "FI-0000abcd", kind: "doc", target: "t", summary: "s", evidence: "e", from: "Not A Slug" }] } }];
  const b = buildBundle({ workspace: root, framework: frameworkRoot, runs, client: "c" });
  assert.deepEqual(b.entries.map((e) => e.name), ["manifest.json", "issues/run-1/FI-0000abcd.json", "runs/run-1.json"]);
  assert.equal(JSON.parse(b.entries[1].data).from, "unnamed");
  assert.equal(JSON.parse(b.entries[2].data).recorded, false, "a run ended before end stamped it");
});
