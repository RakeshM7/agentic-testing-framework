// End to end, offline (D-084): the main orchestrator's loop over `run.mjs next`, from `init` to an ended run, with a
// stand-in for each agent `next` names. A stand-in reads only the prompt it is given and does what its agent must,
// through the same scripts (knowledge.mjs, explore.mjs, report-data.mjs, report.mjs), so the stage graph, the prompts,
// every stage's output verification, the report and the end of the run are exercised together on every `npm test`,
// with no model, browser or network. The live half is `atf e2e` (scripts/e2e.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { endRun, nextStep, setStage } from "./run.mjs";
import { loadJson, paths } from "./lib/contract.mjs";
import { reportPaths, reportUnverified } from "./lib/report.mjs";
import { collect } from "./report-data.mjs";
import { main as report } from "./report.mjs";
import { writeJson } from "./lib/files.mjs";
import { exploreFixture, exploreSession, finishExploration, startRun, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";

// product=acme module=contacts mode=readonly -> {product, module, mode}
const promptArgs = (prompt) => Object.fromEntries(prompt.split(" ").map((kv) => kv.split("=")));

function standIns(root) {
  return {
    "knowledge-generator": ({ pass, module }) => (pass === "product" ? writeProductKnowledge(root) : writeModuleKnowledge(root, module)),
    "module-explorer": async ({ module }) => {
      assert.equal(module, "contacts", "the fixture module");
      const s = exploreSession(root);
      finishExploration(s, await exploreFixture(s));
      await s.ex("ingest-network", "acme", module, "--file", s.cap("network-requests.txt"));
      const c = await s.ex("check", "acme", module);
      assert.deepEqual(c.out.problems, []);
    },
    "report-generator": async ({ product, run }) => {
      const rp = reportPaths(paths(product, root).productDir, run);
      writeJson(rp.report, await collect(product, { root }));
      writeJson(rp.narrative, { executiveSummary: [{ text: "The run explored the contacts module.", cites: ["modules[module=contacts].explored"] }], risks: [], recommendations: [] });
      assert.equal((await report(["render", product], { root })).code, 0);
      const checked = await report(["check", product], { root });
      assert.equal(checked.code, 0, JSON.stringify(checked.out));
    },
  };
}

test("a run goes from init to a completed, verified report through run.mjs next alone, each stage verified on done (D-084)", async () => {
  const { root, run } = startRun({ extra: ["steps: [explore]"], modules: ["contacts"] });
  const agents = standIns(root);
  const started = [];
  let end;
  for (let round = 0; round < 20 && !end; round++) {
    const r = await nextStep("acme", { root });
    if (r.end) {
      end = r.end;
      break;
    }
    assert.equal(r.concurrency.modules, 1);
    for (const a of r.actions) {
      assert.ok(agents[a.agent], `next named ${a.agent}, which this run should never need (${a.stage})`);
      const args = promptArgs(a.prompt);
      assert.equal(args.product, "acme");
      if (a.module) assert.equal(args.module, a.module, "the prompt names the stage's module");
      assert.ok(!(await setStage("acme", a.stage, a.module, "start", undefined, { root })).errors);
      await agents[a.agent](args);
      const done = await setStage("acme", a.stage, a.module, "done", undefined, { root });
      assert.deepEqual(done.errors ?? [], [], `${a.stage}${a.module ? `/${a.module}` : ""}: done`);
      started.push(a.module ? `${a.module}/${a.stage}` : a.stage);
    }
  }
  assert.deepEqual(started, ["knowledge", "contacts/module-knowledge", "contacts/explore", "report"], "the chosen step, what it needs, and the report, in order");
  assert.equal(end.outcome, "completed");
  assert.deepEqual(end.notChosen.sort(), ["api-discovery", "clarifications", "k6", "playwright-api", "playwright-repo", "playwright-ui", "testcases"]);

  const rp = reportPaths(paths("acme", root).productDir, run.runId);
  assert.equal(reportUnverified(rp), null, "the report the run ended with is verified");
  const data = loadJson(rp.report);
  assert.deepEqual([data.totals.modulesExplored, data.effort.stages.map((s) => [s.key, s.status])], [1, [["_product/knowledge", "done"], ["contacts/module-knowledge", "done"], ["contacts/explore", "done"], ["_product/report", "running"]]], "collected while the report stage runs");
  assert.match(readFileSync(rp.html, "utf8"), /The run explored the contacts module\./);

  const ended = await endRun("acme", { root });
  assert.equal(ended.outcome, "completed");
  assert.ok(existsSync(path.join(root, ended.manifest.file)), "the run keeps its manifest");
  assert.ok(loadJson(path.join(root, ended.manifest.file)).files["artifacts/acme/modules/contacts/explore/model.json"]);
});
