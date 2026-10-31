// The Node.js check (scripts/lib/node-version.mjs, D-109) that the guard hook, run.mjs, run-config.mjs and the doctor
// run first, and the minimum the package declares to npm.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MIN_NODE, nodeProblem } from "./lib/node-version.mjs";
import { frameworkRoot } from "./lib/roots.mjs";

test("an older Node.js is a problem with its fix; the minimum and later are not", () => {
  for (const v of ["18.20.8", "v18.20.8", "19.9.0"]) {
    const p = nodeProblem(v);
    assert.equal(p.detail, `Node.js ${v.replace(/^v/, "")} is older than ${MIN_NODE}, which Playwright, the browser server and the framework's scripts need`);
    assert.match(p.fix, /nvm use/);
    assert.match(p.fix, /start a new agent session/);
  }
  for (const v of [`${MIN_NODE}.0.0`, "22.1.0", "v24.19.0"]) assert.equal(nodeProblem(v), null, v);
  // this process: the suite itself runs on a supported Node
  assert.equal(nodeProblem(), null);
});

test("the package declares the same minimum to npm", () => {
  const pkg = JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8"));
  assert.deepEqual(pkg.engines, { node: `>=${MIN_NODE}` });
});
