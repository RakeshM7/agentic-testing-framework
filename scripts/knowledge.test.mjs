import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadJson, paths, validateData } from "./lib/contract.mjs";
import {
  addSource, checkCited, checkModule, checkProduct, htmlToText, knowledgePaths, markInput, mergeGlossary, parseTable, plan, readRegistry, recordInputs,
  registerSource, render, runCheck, snapshot, storeSnapshot,
} from "./lib/knowledge.mjs";
import { main } from "./knowledge.mjs";
import { validateRunConfig } from "./run-config.mjs";
import { setStage } from "./run.mjs";
import { put, startRun, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";

const RUN = "acme-run-1";
// enough readable words for a fetched HTML page to count as text (MIN_FETCH_WORDS)
const FILLER = "Every record belongs to one account and is visible to the members of that account only, unless it is shared with a team.";
const html = (body) => new Response(`<html><body>${body}</body></html>`, { status: 200, headers: { "content-type": "text/html" } });
const ctx = (root) => {
  const p = paths("acme", root);
  return { p, kp: knowledgePaths(p.productDir), cfg: loadJson(p.configFile) };
};
const notesFile = (kp) => kp.module("contacts").notes;
const editNotes = (kp, fn) => writeFileSync(notesFile(kp), fn(readFileSync(notesFile(kp), "utf8")));
// re-render and re-check a module pass after an edit -> runCheck's result
const recheck = (kp, cfg, module = "contacts") => {
  render(kp, module, { runId: RUN });
  return runCheck(kp, cfg, { module, runId: RUN });
};

test("one product-wide ID per source; the same location (normalized) returns the same ID", () => {
  const { root } = startRun();
  const kp = knowledgePaths(paths("acme", root).productDir);
  const a = addSource(kp, { title: "Help", location: "https://Help.acme.test/guide/#intro", type: "vendor-doc", scope: "_product", runId: "r" });
  const b = addSource(kp, { title: "Help again", location: "https://help.acme.test/guide", type: "web", scope: "contacts", runId: "r" });
  const c = addSource(kp, { title: "PRD", location: ".\\docs\\prd.md", type: "requirement", scope: "_product", runId: "r" });
  assert.equal(a.id, "S1");
  assert.equal(b.id, "S1");
  assert.equal(b.existed, true);
  assert.equal(c.id, "S2");
  assert.equal(c.location, "docs/prd.md");
  assert.throws(() => addSource(kp, { title: "x", location: "y", type: "blog", scope: "_product", runId: "r" }), /source type/);
});

test("every content line must cite a registered source, except under Open points; quoted citations count", () => {
  const { root } = startRun();
  const f = path.join(root, "notes.md");
  writeFileSync(f, '# Notes\n\nCited fact [S1].\nUncited claim.\nUnknown source [S9].\nQuoted [S1 "some exact words"].\n\n| A | B |\n|---|---|\n| x | y [S1] |\n\n## Open points\n\n- Not documented anywhere.\n');
  const problems = checkCited(f, new Set(["S1"]));
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /line 4: no source citation/);
  assert.match(problems.join("\n"), /line 5: cites S9/);
});

test("loopholes: a code fence fails, and an open point is a single bullet line", () => {
  const { root } = startRun();
  const f = path.join(root, "notes.md");
  writeFileSync(f, "# Notes\n\nFact [S1].\n\n```\nanything in a fence used to be skipped\n```\n\n## Open points\n\n- One point.\n  continued on a second line\nA paragraph.\n");
  const problems = checkCited(f, new Set(["S1"])).join("\n");
  assert.match(problems, /line 5: code fences are not allowed/);
  assert.match(problems, /line 7: code fences are not allowed/);
  assert.match(problems, /line 6: no source citation/, "a fence no longer hides uncited prose");
  assert.match(problems, /line 12: an open point is a single bullet line/);
  assert.match(problems, /line 13: an open point is a single bullet line/);
});

test("a complete product and module pass validates; module glossary is merged and sources rendered", async () => {
  const { root } = startRun();
  const { kp, cfg } = writeProductKnowledge(root);
  assert.deepEqual(checkProduct(kp, cfg), []);
  writeModuleKnowledge(root, "contacts");
  assert.deepEqual(checkModule(kp, cfg, "contacts"), []);
  assert.deepEqual(checkProduct(kp, cfg), [], "a module pass (glossary merge, sources re-render) leaves the product stamp current");
  const glossary = parseTable(readFileSync(kp.product.glossary, "utf8"));
  assert.deepEqual(glossary.rows.map((r) => [r[0], r[2]]), [["Lead", "product"], ["Owner", "contacts"]]);
  assert.match(readFileSync(kp.module("contacts").sources, "utf8"), /\| S2 \| contacts guide/);
  assert.doesNotMatch(readFileSync(kp.module("contacts").sources, "utf8"), /\| S1 \|/, "module sources list only what the module cites");
  assert.match(readFileSync(kp.product.sources, "utf8"), /\| S1 [\s\S]*\| S2 /);
  for (const [schema, file] of [["knowledge-coverage", kp.coverage], ["knowledge-open-points", kp.openPoints], ["knowledge-coverage", kp.module("contacts").coverage], ["knowledge-open-points", kp.module("contacts").openPoints], ["knowledge-source-cache", kp.cacheIndex]])
    assert.deepEqual(await validateData(schema, loadJson(file)), [], `${path.basename(file)} matches ${schema}`);
});

test("merging a module again replaces its glossary rows instead of duplicating them", () => {
  const { root } = startRun();
  const { kp } = writeProductKnowledge(root);
  writeModuleKnowledge(root, "contacts");
  mergeGlossary(kp, "contacts");
  assert.equal(parseTable(readFileSync(kp.product.glossary, "utf8")).rows.filter((r) => r[2] === "contacts").length, 1);
});

test("module checks catch an unmerged glossary and a stale sources.md", () => {
  const { root } = startRun();
  const { kp, cfg } = writeProductKnowledge(root);
  const { sourceId } = writeModuleKnowledge(root, "contacts");
  const g = kp.module("contacts").glossary;
  writeFileSync(g, readFileSync(g, "utf8") + `| Stage | Lifecycle step [${sourceId}] | [${sourceId}] |\n`);
  const s3 = addSource(kp, { title: "New", location: "https://help.acme.test/new", type: "web", scope: "contacts", runId: "r" });
  editNotes(kp, (t) => t.replace("## Open points", `- New fact [${s3.id}].\n\n## Open points`));
  const problems = checkModule(kp, cfg, "contacts").join("\n");
  assert.match(problems, /not merged into the product glossary/);
  assert.match(problems, /sources.md is stale/);
});

test("input ledger: every configured input is read, failed or excluded; check fails while one is unaccounted for", async () => {
  const { root } = startRun({ extra: ["feature: {requirement_docs: [docs/prd.md]}", "knowledge: {references: ['https://help.acme.test/ref/']}"] });
  put(root, "docs/prd.md", "# PRD\n");
  const { kp, cfg } = ctx(root);
  // the helper registers only its own vendor doc: both configured inputs are still pending
  assert.throws(() => writeProductKnowledge(root), /input 'docs\/prd.md' \(requirement_doc\) is not accounted for[\s\S]*input 'https:\/\/help.acme.test\/ref' \(reference\)/);
  const read = registerSource(kp, cfg, { title: "Reference", location: "https://HELP.acme.test/ref#top", type: "knowledge-base", runId: RUN });
  assert.equal(read.kind, "reference", "a registered source with the input's normalized location reads it");
  assert.throws(() => markInput(kp, cfg, { location: "docs/prd.md", status: "failed", reason: " ", runId: RUN }), /--reason is required/);
  assert.throws(() => markInput(kp, cfg, { location: "docs/other.md", status: "failed", reason: "x", runId: RUN }), /not a configured input of this pass/);
  assert.throws(() => markInput(kp, cfg, { location: "docs/prd.md", status: "skipped", reason: "x", runId: RUN }), /--status must be one of/);
  const r = markInput(kp, cfg, { location: "./docs/prd.md", status: "failed", reason: "the file is a scanned image", runId: RUN });
  assert.deepEqual(r.summary.inputs, { total: 2, read: 1, failed: 1, excluded: 0, pending: 0 });
  const ok = runCheck(kp, cfg, { runId: RUN });
  assert.equal(ok.valid, true, ok.problems.join("\n"));
  assert.deepEqual(ok.inputs, { total: 2, read: 1, failed: 1, excluded: 0, pending: 0 });

  // a module pass accounts for the product inputs and the module's own references
  const mcfg = structuredClone(cfg);
  mcfg.modules[0].references = ["https://help.acme.test/contacts-api"];
  writeFileSync(paths("acme", root).configFile, JSON.stringify(mcfg));
  assert.throws(() => writeModuleKnowledge(root, "contacts"), /input 'docs\/prd.md'[\s\S]*input 'https:\/\/help.acme.test\/ref'[\s\S]*'https:\/\/help.acme.test\/contacts-api' \(module_reference\)/);
  for (const location of ["docs/prd.md", "https://help.acme.test/ref"]) markInput(kp, mcfg, { module: "contacts", location, status: "excluded", reason: "nothing specific to Contacts", runId: RUN });
  registerSource(kp, mcfg, { title: "Contacts API", location: "https://help.acme.test/contacts-api", type: "vendor-doc", module: "contacts", runId: RUN });
  const m = recheck(kp, mcfg);
  assert.equal(m.valid, true, m.problems.join("\n"));
  assert.deepEqual(m.inputs, { total: 3, read: 1, failed: 0, excluded: 2, pending: 0 });
  assert.deepEqual(await validateData("knowledge-coverage", loadJson(kp.module("contacts").coverage)), []);
});

test("budget: extra sources over knowledge.max_extra_sources are deferred, not registered; configured and live-product sources are free", () => {
  const { root } = startRun({ extra: ["knowledge: {references: ['https://help.acme.test/ref'], max_extra_sources: 1}"] });
  const { kp, cfg } = ctx(root);
  const add = (location, type = "web") => registerSource(kp, cfg, { title: location, location, type, module: "contacts", runId: RUN });
  assert.match(add("https://blog.example.test/a").id, /^S\d+$/);
  assert.match(add("https://blog.example.test/a").id, /^S\d+$/, "the same extra source again costs nothing");
  assert.match(add("https://help.acme.test/ref", "knowledge-base").id, /^S\d+$/, "a configured reference is never budgeted");
  assert.match(add("https://app.acme.test/contacts", "live-product").id, /^S\d+$/, "live-product sources don't count");
  const over = add("https://blog.example.test/b");
  assert.deepEqual(over, { deferred: true, location: "https://blog.example.test/b", reason: "budget", detail: "over knowledge.max_extra_sources (1)", note: over.note });
  assert.ok(!readRegistry(kp).some((s) => s.location === "https://blog.example.test/b"), "a deferred source gets no S id");
  const led = loadJson(kp.module("contacts").coverage);
  assert.deepEqual(led.items.find((i) => i.id === "https://blog.example.test/b"), { kind: "extra", title: "https://blog.example.test/b", type: "web", id: "https://blog.example.test/b", status: "deferred", reason: "budget", detail: "over knowledge.max_extra_sources (1)" });
  assert.deepEqual(led.summary.extra, { cap: 1, used: 1, deferred: 1 });
  assert.equal(led.summary.liveProduct, 1);
  assert.equal(registerSource(kp, cfg, { title: "b", location: "https://blog.example.test/b", type: "web", runId: RUN }).id, "S4", "the cap is per pass: the product pass has its own");

  assert.equal(validateRunConfig({ product: "a", target: { url: "https://a.test" }, modules: [{ slug: "m", name: "M", nav_path: ["M"] }] }).normalized.knowledge.max_extra_sources, 20);
  assert.match(validateRunConfig({ product: "a", target: { url: "https://a.test" }, knowledge: { max_extra_sources: -1 }, modules: [{ slug: "m", name: "M", nav_path: ["M"] }] }).errors.join(), /knowledge.max_extra_sources/);
});

test("quotes: rule facts need a quote found in the cached source text (whitespace, case and curly quotes normalized)", () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  const { kp, cfg, sourceId: s } = writeModuleKnowledge(root, "contacts");
  storeSnapshot(kp, "S1", "Plans:\n  The   Starter plan’s limit is 10   SEATS per account.", { captured_by: "script" });
  const limits = (line) => editNotes(kp, (t) => t.replace(/## Limits and constraints\n\n(- .*\n\n)?/, `## Limits and constraints\n\n${line}\n\n`));

  limits(`- The Starter plan has a seat limit [S1 "the starter plan's LIMIT is 10 seats"].`);
  assert.deepEqual(recheck(kp, cfg).problems, [], "case, whitespace and a curly apostrophe are normalized");
  limits(`- The Starter plan has a seat limit [S1 "limit is 20 seats"].`);
  assert.match(recheck(kp, cfg).problems.join("\n"), /the quote "limit is 20 seats" is not in the cached text of S1/);
  limits(`- The Starter plan has a seat limit [S1].`);
  assert.match(recheck(kp, cfg).problems.join("\n"), /a rule fact needs a verified quote/);
  limits(`- The Starter plan has a seat limit [S1 "limit"].`);
  assert.match(recheck(kp, cfg).problems.join("\n"), /needs at least 3 words/);
  const s9 = addSource(kp, { title: "Uncached", location: "https://help.acme.test/uncached", type: "web", scope: "contacts", runId: RUN });
  limits(`- The Starter plan has a seat limit [${s9.id} "limit is 10 seats"].`);
  assert.match(recheck(kp, cfg).problems.join("\n"), new RegExp(`${s9.id} has no cached text: run knowledge.mjs snapshot`));
  limits("");

  // under Key entities and fields, only a line that names a constraint needs a quote
  editNotes(kp, (t) => t.replace(/## Key entities and fields\n\n- .*\n/, `## Key entities and fields\n\n- A record has an owner [${s}].\n- The name field is required [${s}].\n`));
  const r = recheck(kp, cfg).problems;
  assert.equal(r.length, 1, r.join("\n"));
  assert.match(r[0], /a rule fact needs a verified quote, e\.g\. \[S<n> "exact words"\]: "- The name field is required/);
});

test("snapshot: a plain GET of a doc page (injected fetch), never the product's hosts; repo files read directly, never credentials; agent captures are counted", async () => {
  const { root } = startRun({ apiUrls: ["https://api.acme.test/v1"] });
  const { kp, cfg } = ctx(root);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push([url, init.method, init.redirect, init.headers?.authorization]);
    if (url === "https://docs.vendor.test/moved") return new Response("", { status: 301, headers: { location: "https://docs.vendor.test/guide" } });
    if (url === "https://docs.vendor.test/sneaky") return new Response("", { status: 302, headers: { location: "https://app.acme.test/admin" } });
    return new Response(`<html><head><title>x</title><script>var a=1</script></head><body><h1>Guide</h1><p>Names are&nbsp;<b>unique</b> &amp; required.</p><p>${FILLER}</p></body></html>`, { status: 200, headers: { "content-type": "text/html" } });
  };
  const reg = (location, type = "vendor-doc") => registerSource(kp, cfg, { title: location, location, type, runId: RUN }).id;
  const cli = (...args) => main(["snapshot", "acme", ...args], { root, fetchImpl });

  for (const loc of ["https://app.acme.test/contacts", "https://api.acme.test/v1/docs"]) {
    const id = reg(loc, "live-product");
    await assert.rejects(cli(id), /refused: S\d+ is on the product's own host/);
  }
  assert.equal(calls.length, 0, "the product is never fetched");

  const doc = reg("https://docs.vendor.test/moved");
  const r = (await cli(doc)).out;
  assert.equal(r.captured_by, "script");
  assert.equal(readFileSync(kp.cacheFile(doc), "utf8"), `Guide\nNames are unique & required.\n${FILLER}\n`);
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [["https://docs.vendor.test/moved", "GET", "manual"], ["https://docs.vendor.test/guide", "GET", "manual"]]);
  assert.equal(calls[0][3], undefined, "no credentials are sent");
  assert.equal((await cli(doc)).out.cached, true, "an already cached source is not fetched again");
  await assert.rejects(snapshot(kp, cfg, { id: reg("https://docs.vendor.test/sneaky"), root, fetchImpl }), /app.acme.test is the product's own host/, "a redirect to the product is refused");

  put(root, "docs/rules.md", "Names must be unique.\n");
  const file = reg("docs/rules.md", "requirement");
  assert.equal((await cli(file)).out.captured_by, "script");
  put(root, "secrets/.env", "TOKEN=x\n");
  await assert.rejects(cli(reg("secrets/.env", "requirement")), /credentials \(\.env\) file/);
  const c2 = structuredClone(cfg);
  c2.authorizations.credentials_file = "secrets/creds.json";
  put(root, "secrets/creds.json", "{}");
  await assert.rejects(snapshot(kp, c2, { id: reg("secrets/creds.json", "requirement"), root, fetchImpl }), /credentials or session file/);

  // a live-product page the script can't fetch: the agent's capture, from knowledge/captures/ only
  const live = reg("https://app.acme.test/contacts", "live-product");
  put(root, "artifacts/acme/knowledge/captures/contacts.txt", "Contacts\nOnly admins can delete contacts.\n");
  put(root, "notes-elsewhere.txt", "x");
  await assert.rejects(cli(live, "--from-file", "../../../notes-elsewhere.txt"), /a capture must be a file under/);
  const cap = (await cli(live, "--from-file", "captures/contacts.txt")).out;
  assert.deepEqual([cap.captured_by, cap.from], ["agent", "artifacts/acme/knowledge/captures/contacts.txt"]);

  writeProductKnowledge(root);
  put(root, "artifacts/acme/knowledge/overview.md", readFileSync(kp.product.overview, "utf8").replace("## Users and roles\n\n", `## Users and roles\n\n- Only admins delete contacts [${live} "only admins can delete contacts"].\n`));
  render(kp, undefined, { runId: RUN });
  const checked = runCheck(kp, cfg, { runId: RUN });
  assert.equal(checked.valid, true, checked.problems.join("\n"));
  assert.equal(checked.capturedByAgent, 1, "check reports the sources captured by the agent");
  assert.equal(htmlToText("a<br>b&#39;c&#x41;"), "a\nb'cA");
});

test("only the fixed headings: an extra ## or # section fails in notes.md and both overviews", () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  const { kp, cfg } = writeModuleKnowledge(root, "contacts");
  const base = readFileSync(notesFile(kp), "utf8");
  // an extra section would hold a rule fact outside the quote rule
  editNotes(kp, (t) => t.replace("## Open points", "## Validation details\n\n- Names are unique [S2].\n\n## Open points"));
  assert.match(recheck(kp, cfg).problems.join("\n"), /notes.md line \d+: "## Validation details" is not an allowed heading/);
  writeFileSync(notesFile(kp), `# Contacts notes\n\n- Names are unique [S2].\n\n${base}`);
  const p = recheck(kp, cfg).problems.join("\n");
  assert.match(p, /"# Contacts notes" is not allowed \(no # headings in this file\)/);
  assert.match(p, /content must be under one of the "## " headings: "- Names are unique/);
  writeFileSync(notesFile(kp), `${base}\n## Business rules and validations\n\n- More rules [S2].\n`);
  assert.match(recheck(kp, cfg).problems.join("\n"), /"## Business rules and validations" appears twice/);
  writeFileSync(notesFile(kp), base);
  assert.equal(recheck(kp, cfg).valid, true);

  const mo = kp.module("contacts").overview;
  writeFileSync(mo, readFileSync(mo, "utf8") + "\n## History\n\n- Added in 2020 [S2].\n");
  assert.match(recheck(kp, cfg).problems.join("\n"), /overview.md line \d+: "## History" is not an allowed heading/);
  writeFileSync(kp.product.overview, readFileSync(kp.product.overview, "utf8") + "\n# Appendix\n\n## Pricing\n\n- Plans [S1].\n");
  render(kp, undefined, { runId: RUN });
  const pp = runCheck(kp, cfg, { runId: RUN }).problems.join("\n");
  assert.match(pp, /"# Appendix" is not allowed \(one # title only\)/);
  assert.match(pp, /"## Pricing" is not an allowed heading/);
});

test("budget loophole closed: a live-product source must be a page on the product's own host", () => {
  const { root } = startRun({ apiUrls: ["https://api.acme.test/v1"] });
  const { kp, cfg } = ctx(root);
  const live = (location) => registerSource(kp, cfg, { title: "page", location, type: "live-product", module: "contacts", runId: RUN });
  for (const bad of ["https://blog.example.test/acme", "https://app.acme.test.example/x", "https://help.acme.test/x", "docs/notes.md"])
    assert.throws(() => live(bad), /a live-product source must be a page on the product's own host \[app.acme.test, api.acme.test\]/, bad);
  for (const ok of ["https://APP.acme.test./contacts", "https://app.acme.test:8443/x", "https://api.acme.test/v1/docs"]) assert.equal(live(ok).kind, "live-product", ok);
  assert.deepEqual(loadJson(kp.module("contacts").coverage).summary.extra, { cap: 20, used: 0, deferred: 0 });
  assert.equal(readRegistry(kp).length, 3, "a refused source is not registered");
});

test("agent captures: --from-file only for live-product, or after the script's own fetch failed in this run; the failure is recorded", async () => {
  const { root } = startRun();
  const { kp, cfg } = ctx(root);
  let mode = "js";
  const fetchImpl = async () => (mode === "js" ? html("<div id=app></div><script>render()</script>") : new Response("down", { status: 500 }));
  const cli = (...a) => main(["snapshot", "acme", ...a], { root, fetchImpl });
  const reg = (location) => registerSource(kp, cfg, { title: location, location, type: "vendor-doc", runId: RUN }).id;
  put(root, "artifacts/acme/knowledge/captures/spa.txt", "Only admins can export the contact list.\n");

  const spa = reg("https://docs.vendor.test/spa");
  await assert.rejects(cli(spa, "--from-file", "captures/spa.txt"), /--from-file is only for a live-product source, or after the script's own fetch of S\d+ failed in this run/);
  await assert.rejects(cli(spa), /could not read it \(GET https:\/\/docs.vendor.test\/spa: fewer than 20 words of readable text/);
  const failed = loadJson(kp.cacheIndex)[spa];
  assert.deepEqual([failed.status, failed.fetchError.runId], ["failed", RUN]);
  const cap = (await cli(spa, "--from-file", "captures/spa.txt")).out;
  assert.deepEqual([cap.status, cap.captured_by, cap.fetchError.runId], ["fresh", "agent", RUN], "the capture keeps the failure that allowed it");

  mode = "500";
  const down = reg("https://docs.vendor.test/down");
  await assert.rejects(cli(down), /HTTP 500/);
  const idx = loadJson(kp.cacheIndex);
  idx[down].fetchError.runId = "acme-run-0";
  writeFileSync(kp.cacheIndex, JSON.stringify(idx));
  await assert.rejects(cli(down, "--from-file", "captures/spa.txt"), /--from-file is only for/, "a failure in an earlier run unlocks nothing");

  writeProductKnowledge(root);
  writeFileSync(kp.product.overview, readFileSync(kp.product.overview, "utf8").replace("## Users and roles\n\n", `## Users and roles\n\n- Admins export contacts [${spa} "only admins can export the contact list"].\n`));
  render(kp, undefined, { runId: RUN });
  const checked = runCheck(kp, cfg, { runId: RUN });
  assert.equal(checked.valid, true, checked.problems.join("\n"));
  assert.equal(checked.capturedByAgent, 1);
});

test("rule facts: a quote on an agent capture or stale text is allowed but flagged as weaker evidence in check and rule-facts.json", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  const { kp, cfg, sourceId: s2 } = writeModuleKnowledge(root, "contacts");
  const facts = () => loadJson(kp.module("contacts").ruleFacts).facts;
  assert.deepEqual(facts().map((f) => [f.category, f.evidence]), [["rules", "script-fetched"], ["roles", "script-fetched"]], "only rule lines; a quoted descriptive line is not a rule fact");
  assert.deepEqual(await validateData("knowledge-rule-facts", loadJson(kp.module("contacts").ruleFacts)), []);

  // an agent capture of a live-product page
  const live = registerSource(kp, cfg, { title: "Contacts page", location: "https://app.acme.test/contacts", type: "live-product", module: "contacts", runId: RUN }).id;
  put(root, "artifacts/acme/knowledge/captures/contacts.txt", "Contacts\nA contact can have at most 5 tags.\nOnly admins can delete records.\n");
  await main(["snapshot", "acme", live, "--from-file", "captures/contacts.txt"], { root });
  editNotes(kp, (t) => t.replace("## Limits and constraints\n\n", `## Limits and constraints\n\n- At most five tags per contact [${live} "at most 5 tags"].\n- Admins delete records [${live} "Only admins can delete records"][${s2} "Only admins can delete records"].\n\n`));
  const r = recheck(kp, cfg);
  assert.equal(r.valid, true, "agent-captured quotes are allowed");
  const line = readFileSync(notesFile(kp), "utf8").split("\n").findIndex((l) => l.startsWith("- At most five tags")) + 1;
  assert.deepEqual(r.agentCapturedRuleFacts, [{ file: "modules/contacts/notes.md", line, sources: [live] }]);
  assert.deepEqual(r.ruleFacts, { total: 4, "script-fetched": 3, "agent-capture": 1, stale: 0 }, "a fact with a script-fetched quote too is not weaker");
  const tags = facts().find((f) => f.line === line);
  assert.deepEqual([tags.evidence, tags.category, tags.citations], ["agent-capture", "limits", [{ source: live, quote: "at most 5 tags", evidence: "agent-capture" }]]);

  // the module source goes stale: a re-fetch in a later run fails, the old text is kept
  await snapshot(kp, cfg, { id: s2, root, runId: "acme-run-2", fetchImpl: async () => new Response("down", { status: 503 }) });
  assert.match(checkModule(kp, cfg, "contacts").join("\n"), /rule-facts.json: stale/, "the stage notices the evidence changed");
  const s = recheck(kp, cfg);
  assert.equal(s.valid, true);
  assert.deepEqual(s.staleRuleFacts.map((f) => f.sources), [[s2], [s2]]);
  assert.deepEqual(facts().map((f) => f.evidence), ["stale", "stale", "agent-capture", "agent-capture"], "the agent capture now outranks stale text");
  assert.deepEqual(await validateData("knowledge-rule-facts", loadJson(kp.module("contacts").ruleFacts)), []);
});

test("snapshot host refusal: hosts normalized (case, trailing dot, any port), and subdomains of the product refused", async () => {
  const { root } = startRun({ apiUrls: ["https://api.acme.test/v1"] });
  const { kp, cfg } = ctx(root);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === "https://redirect.example.test/r") return new Response("", { status: 302, headers: { location: "https://x.APP.acme.test./" } });
    return html(`<p>${FILLER}</p>`);
  };
  const snap = (location) => snapshot(kp, cfg, { id: addSource(kp, { title: location, location, type: "web", scope: "_product", runId: RUN }).id, root, runId: RUN, fetchImpl });
  for (const loc of ["https://APP.ACME.TEST./x", "https://app.acme.test:443/x", "http://app.acme.test:8080/x", "https://docs.app.acme.test/guide", "https://v2.api.acme.test/spec"])
    await assert.rejects(snap(loc), /refused: S\d+ is on the product's own host/, loc);
  assert.deepEqual(calls, [], "the product is never fetched");
  await assert.rejects(snap("https://redirect.example.test/r"), /refused: x.app.acme.test. is the product's own host \(or under it\)/, "a redirect into a product subdomain is refused");
  for (const loc of ["https://acme.test/about", "https://notapp.acme.test/x", "https://app.acme.test.evil.example/x"]) assert.equal((await snap(loc)).status, "fresh", loc);
});

test("re-fetch: text cached in an earlier run is fetched again; if that fails the old text stays, marked stale, and check reports it", async () => {
  const { root } = startRun();
  const { kp: kp0 } = writeProductKnowledge(root);
  const { cfg } = ctx(root);
  let body = `<p>Seats are limited per plan. ${FILLER}</p>`;
  let fail = false;
  let n = 0;
  const fetchImpl = async () => {
    n++;
    return fail ? new Response("down", { status: 503 }) : html(body);
  };
  const snap = (runId) => snapshot(kp0, cfg, { id: "S1", root, runId, fetchImpl });
  assert.equal((await snap("acme-run-0")).status, "fresh");
  assert.equal((await snap("acme-run-0")).cached, true);
  assert.equal(n, 1, "the same run reuses its cache");
  body = `<p>Seats are limited per account. ${FILLER}</p>`;
  const again = await snap(RUN);
  assert.deepEqual([again.status, again.runId, n], ["fresh", RUN, 2], "a later run fetches again");
  assert.match(readFileSync(kp0.cacheFile("S1"), "utf8"), /per account/);
  fail = true;
  const stale = await snap("acme-run-2");
  assert.deepEqual([stale.status, stale.stale, stale.runId, stale.fetchError.runId], ["stale", true, RUN, "acme-run-2"]);
  assert.match(readFileSync(kp0.cacheFile("S1"), "utf8"), /per account/, "the old text is kept");
  assert.deepEqual(await validateData("knowledge-source-cache", loadJson(kp0.cacheIndex)), []);

  writeFileSync(kp0.product.overview, readFileSync(kp0.product.overview, "utf8").replace("## Constraints and limits\n\n", `## Constraints and limits\n\n- Seats are capped [S1 "seats are limited per account"].\n`));
  render(kp0, undefined, { runId: RUN });
  const checked = runCheck(kp0, cfg, { runId: RUN });
  assert.equal(checked.valid, true, checked.problems.join("\n"));
  assert.equal(checked.staleSources, 1, "check reports stale sources");
});

test("run-config: the module slug 'product' is reserved, so KQ-product-<n> can't collide", () => {
  const cfg = (slug) => validateRunConfig({ product: "a", target: { url: "https://a.test" }, modules: [{ slug, name: "M", nav_path: ["M"] }] });
  assert.match(cfg("product").errors.join(), /modules\[0\].slug: 'product' is reserved/);
  assert.deepEqual(cfg("products").errors, []);
});

test("fact checklist: every notes heading; each category needs a cited line or a tagged open point; product Main areas match the modules", () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  const { kp, cfg } = writeModuleKnowledge(root, "contacts");
  editNotes(kp, (t) => t.replace("- (limits) Whether there is a maximum number of records is not documented.\n", ""));
  assert.match(recheck(kp, cfg).problems.join("\n"), /notes.md: "## Limits and constraints" needs a cited fact, or an open point tagged "\(limits\)"/);
  editNotes(kp, (t) => t.replace("## Open points\n\n", "## Open points\n\n- (LIMITS) The maximum number of records is not documented.\n"));
  assert.deepEqual(recheck(kp, cfg).problems, [], "a category tag on an open point satisfies the category");
  editNotes(kp, (t) => t.replace("## Dependencies on other modules\n", ""));
  assert.match(recheck(kp, cfg).problems.join("\n"), /missing the heading "## Dependencies on other modules"/);

  const ov = readFileSync(kp.product.overview, "utf8");
  put(root, "artifacts/acme/knowledge/overview.md", ov.replace(/- \*\*Deals\*\*.*\n/, "- Reports: dashboards [S1].\n"));
  render(kp, undefined, { runId: RUN });
  const p = runCheck(kp, cfg, { runId: RUN }).problems.join("\n");
  assert.match(p, /"## Main areas" needs exactly one bullet for module 'Deals' \(found 0\)/);
  assert.match(p, /a "## Main areas" bullet must start with a configured module's name: "- Reports/);
  put(root, "artifacts/acme/knowledge/overview.md", ov.replace("## Integrations", "## Other"));
  assert.match(runCheck(kp, cfg, { runId: RUN }).problems.join("\n"), /overview.md: missing the heading "## Integrations"/);
});

test("open points: stable ids KQ-<m>-<n> / KQ-product-<n> across rebuilds; a removed point is kept as gone and its id never reused", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  const { kp, cfg } = writeModuleKnowledge(root, "contacts");
  const ids = () => Object.fromEntries(Object.values(loadJson(kp.module("contacts").openPoints).points).map((e) => [e.text, `${e.id}:${e.status}:${e.category}`]));
  assert.deepEqual(Object.values(loadJson(kp.openPoints).points).map((e) => e.id), ["KQ-product-1"]);
  const before = ids();
  assert.deepEqual(Object.values(before).sort(), ["KQ-contacts-1:active:flows", "KQ-contacts-2:active:dependencies", "KQ-contacts-3:active:limits"]);
  const notesBefore = readFileSync(notesFile(kp), "utf8");
  recheck(kp, cfg);
  assert.deepEqual(ids(), before, "a rebuild keeps every id");
  assert.equal(readFileSync(notesFile(kp), "utf8"), notesBefore, "the agent's markdown is never rewritten");

  editNotes(kp, (t) => t.replace("- (dependencies) Whether deals reference records is not documented.", "- (dependencies)   WHETHER deals reference records is not documented [S2]").replace("- (limits) Whether there is a maximum number of records is not documented.\n", "- (limits) The maximum import size is not documented.\n"));
  const r = recheck(kp, cfg);
  assert.equal(r.valid, true, r.problems.join("\n"));
  const after = ids();
  assert.equal(after["WHETHER deals reference records is not documented [S2]"], "KQ-contacts-2:active:dependencies", "the same normalized text keeps its id");
  assert.equal(after["Whether there is a maximum number of records is not documented."], "KQ-contacts-3:gone:limits", "a removed point is kept as gone");
  assert.equal(after["The maximum import size is not documented."], "KQ-contacts-4:active:limits", "a new point takes the next id; gone ids are never reused");
  assert.deepEqual(r.openPoints.sort(), ["KQ-contacts-1", "KQ-contacts-2", "KQ-contacts-4"]);
  assert.deepEqual(await validateData("knowledge-open-points", loadJson(kp.module("contacts").openPoints)), []);

  editNotes(kp, (t) => t.replace("## Open points\n\n", "## Open points\n\n- The maximum import size is not documented.\n"));
  render(kp, "contacts", { runId: RUN });
  assert.match(checkModule(kp, cfg, "contacts").join("\n"), /the same open point as line/);
});

test("verified stamp: the stage's done refuses knowledge changed after check; check again restamps", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  assert.equal((await setStage("acme", "knowledge", undefined, "done", undefined, { root })).status, "done");
  const { kp, cfg } = writeModuleKnowledge(root, "contacts");
  // below every rule fact, so rule-facts.json stays current and only the stamp is stale
  editNotes(kp, (t) => t.replace("## Dependencies on other modules\n", "## Dependencies on other modules\n\n- Records link to deals [S2].\n"));
  const refused = await setStage("acme", "module-knowledge", "contacts", "done", undefined, { root });
  assert.match(refused.errors.join("\n"), /the module contacts knowledge changed after knowledge.mjs check/);
  assert.equal(plan(kp, cfg, root).modules.contacts, "generate");
  assert.equal(recheck(kp, cfg).valid, true);
  assert.equal((await setStage("acme", "module-knowledge", "contacts", "done", undefined, { root })).status, "done");

  const fresh = startRun();
  const { kp: kp2 } = writeProductKnowledge(fresh.root);
  const cov = loadJson(kp2.coverage);
  delete cov.verified;
  writeFileSync(kp2.coverage, JSON.stringify(cov));
  assert.match((await setStage("acme", "knowledge", undefined, "done", undefined, { root: fresh.root })).errors.join("\n"), /did not pass knowledge.mjs check/);
});

test("knowledge is reused unless its inputs change; stage done records the inputs", async () => {
  const { root } = startRun();
  const p = paths("acme", root);
  const kp = knowledgePaths(p.productDir);
  const cfg = () => loadJson(p.configFile);
  assert.deepEqual(plan(kp, cfg(), root), { product: "generate", modules: { contacts: "generate", deals: "generate" } });

  writeProductKnowledge(root);
  await setStage("acme", "knowledge", undefined, "done", undefined, { root });
  for (const m of ["contacts", "deals"]) {
    writeModuleKnowledge(root, m);
    await setStage("acme", "module-knowledge", m, "done", undefined, { root });
  }
  assert.deepEqual(plan(kp, cfg(), root), { product: "reuse", modules: { contacts: "reuse", deals: "reuse" } });

  const changed = (mutate) => {
    const c = structuredClone(cfg());
    mutate(c);
    return plan(kp, c, root);
  };
  assert.deepEqual(changed((c) => (c.modules[1].nav_path = ["Sales", "Deals"])), { product: "reuse", modules: { contacts: "reuse", deals: "generate" } });
  assert.deepEqual(changed((c) => (c.modules[0].references = ["https://help.acme.test/contacts-api"])).modules, { contacts: "generate", deals: "reuse" });
  assert.deepEqual(changed((c) => (c.knowledge.references = ["https://help.acme.test/v2"])), { product: "generate", modules: { contacts: "generate", deals: "generate" } });

  put(root, "docs/prd.md", "v1");
  const withDoc = structuredClone(cfg());
  withDoc.feature.requirement_docs = ["docs/prd.md"];
  assert.equal(plan(kp, withDoc, root).product, "generate", "adding a requirement doc is an input change");
  recordInputs(kp, withDoc, root);
  for (const m of ["contacts", "deals"]) recordInputs(kp, withDoc, root, m);
  assert.equal(plan(kp, withDoc, root).product, "generate", "an input the product pass never accounted for is not reused");
  registerSource(kp, withDoc, { title: "PRD", location: "docs/prd.md", type: "requirement", runId: RUN });
  for (const m of ["contacts", "deals"]) registerSource(kp, withDoc, { title: "PRD", location: "docs/prd.md", type: "requirement", module: m, runId: RUN });
  assert.deepEqual(plan(kp, withDoc, root), { product: "reuse", modules: { contacts: "reuse", deals: "reuse" } });
  put(root, "docs/prd.md", "v2");
  assert.deepEqual(plan(kp, withDoc, root), { product: "generate", modules: { contacts: "generate", deals: "generate" } }, "a local doc's content change is detected");
  assert.throws(() => changed((c) => (c.feature.requirement_docs = ["docs/missing.md"])), /requirement doc not found/);
  put(root, "docs/prd.md", "v1");
  recordInputs(kp, cfg(), root);
  for (const m of ["contacts", "deals"]) recordInputs(kp, cfg(), root, m);

  put(root, "artifacts/acme/knowledge/modules/deals/notes.md", "");
  assert.equal(plan(kp, cfg(), root).modules.deals, "generate", "broken outputs are regenerated even if inputs match");
});

test("the knowledge stages refuse done when content is uncited", async () => {
  const { root } = startRun();
  writeProductKnowledge(root);
  put(root, "artifacts/acme/knowledge/overview.md", "# Acme\n\nUnsupported claim.\n");
  const r = await setStage("acme", "knowledge", undefined, "done", undefined, { root });
  assert.match(r.errors.join("\n"), /no source citation/);
});

test("CLI: add-source, input, render, check and paths go through main(); usage errors exit 2", async () => {
  const { root } = startRun({ extra: ["knowledge: {references: ['https://help.acme.test/ref']}"] });
  const run = (...a) => main(a, { root });
  assert.equal((await run("check", "acme")).code, 1);
  assert.equal((await run("add-source", "acme", "--title", "Ref", "--location", "https://help.acme.test/ref", "--type", "knowledge-base")).out.kind, "reference");
  const inp = await run("input", "acme", "--module", "contacts", "--location", "https://help.acme.test/ref", "--status", "excluded", "--reason", "product-wide only");
  assert.equal(inp.out.summary.inputs.excluded, 1);
  assert.equal((await run("paths", "acme", "--module", "contacts")).out.openPoints, "artifacts/acme/knowledge/modules/contacts/open-points.json");
  assert.equal((await run("snapshot", "acme", "nope")).code, 2);
  assert.equal((await run("bogus", "acme")).code, 2);
  assert.equal((await main([], { root })).code, 2);
  await assert.rejects(run("render", "acme", "--module", "nope"), /--module must be one of/);
  assert.ok(existsSync(knowledgePaths(paths("acme", root).productDir).coverage));
});
