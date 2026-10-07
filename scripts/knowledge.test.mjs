import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadJson, paths } from "./lib/contract.mjs";
import { addSource, checkCited, checkModule, checkProduct, knowledgePaths, mergeGlossary, parseTable, plan, recordInputs } from "./lib/knowledge.mjs";
import { setStage } from "./run.mjs";
import { put, startRun, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";

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

test("every content line must cite a registered source, except under Open points", () => {
  const { root } = startRun();
  const f = path.join(root, "notes.md");
  writeFileSync(f, "# Notes\n\nCited fact [S1].\nUncited claim.\nUnknown source [S9].\n\n| A | B |\n|---|---|\n| x | y [S1] |\n\n## Open points\n\n- Not documented anywhere.\n");
  const problems = checkCited(f, new Set(["S1"]));
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /line 4: no source citation/);
  assert.match(problems.join("\n"), /line 5: cites S9/);
});

test("a complete product and module pass validates; module glossary is merged and sources rendered", () => {
  const { root } = startRun();
  const { kp } = writeProductKnowledge(root);
  assert.deepEqual(checkProduct(kp), []);
  writeModuleKnowledge(root, "contacts");
  assert.deepEqual(checkModule(kp, "contacts"), []);
  const glossary = parseTable(readFileSync(kp.product.glossary, "utf8"));
  assert.deepEqual(glossary.rows.map((r) => [r[0], r[2]]), [["Lead", "product"], ["Owner", "contacts"]]);
  assert.match(readFileSync(kp.module("contacts").sources, "utf8"), /\| S2 \| contacts guide/);
  assert.doesNotMatch(readFileSync(kp.module("contacts").sources, "utf8"), /\| S1 \|/, "module sources list only what the module cites");
  assert.match(readFileSync(kp.product.sources, "utf8"), /\| S1 [\s\S]*\| S2 /);
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
  const { kp } = writeProductKnowledge(root);
  const { sourceId } = writeModuleKnowledge(root, "contacts");
  const g = kp.module("contacts").glossary;
  writeFileSync(g, readFileSync(g, "utf8") + `| Stage | Lifecycle step [${sourceId}] | [${sourceId}] |\n`);
  const s3 = addSource(kp, { title: "New", location: "https://help.acme.test/new", type: "web", scope: "contacts", runId: "r" });
  writeFileSync(kp.module("contacts").notes, readFileSync(kp.module("contacts").notes, "utf8").replace("## Open points", `- New fact [${s3.id}].\n\n## Open points`));
  const problems = checkModule(kp, "contacts").join("\n");
  assert.match(problems, /not merged into the product glossary/);
  assert.match(problems, /sources.md is stale/);
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
  assert.equal(plan(kp, withDoc, root).product, "reuse");
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
