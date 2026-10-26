#!/usr/bin/env node
// The live end-to-end check (D-084): `atf e2e`. Everything the agents produce is replaced by fixtures, everything the
// scripts and templates produce is real, and it runs against a real product in a real browser:
//   1. copies the framework into a scratch folder (its scripts then resolve every path there, so the repo's own
//      artifacts/ are never touched) and starts the demo app (scripts/fixtures/demo-app) on a free local port;
//   2. renders the demo product's Playwright foundation from the templates, installs it (npm install, the browser) and
//      checks it with tsc and `playwright test --list`;
//   3. per mode (readonly, then full-run), starts a run, copies the fixture specs (scripts/fixtures/e2e) into the repo
//      and runs them headless, then checks what happened -- in the results, the ledger and the app itself:
//      readonly: a destructive click and an API POST never reach the app, @mutates tests are not run;
//      full-run: a test's own contact is created and deleted, the ledger guard stops the delete of a pre-existing one,
//      and an API contact left behind is recorded with its cleanup recipe;
//   4. ends the full-run and runs the human's ledger sweep (a stand-in terminal types the slug), which must delete the
//      leftover through its recipe.
// Needs the network once (npm and the Playwright browser), and a machine that can start Chromium.
//   node scripts/e2e.mjs [--keep]      --keep leaves the scratch folder for a look
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT = "demo";
const keep = process.argv.includes("--keep");
const checks = [];
const expect = (ok, what, detail = "") => {
  checks.push({ ok: !!ok, what, ...(detail && !ok ? { detail } : {}) });
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail && !ok ? `: ${detail}` : ""}`);
};

function scratchFramework() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-e2e-"));
  for (const d of ["scripts", "schemas", "templates"]) cpSync(path.join(REPO, d), path.join(root, d), { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) });
  mkdirSync(path.join(root, "config"));
  for (const f of ["permissions.yaml", "mcp.yaml", "models.yaml"]) cpSync(path.join(REPO, "config", f), path.join(root, "config", f));
  cpSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
  symlinkSync(nodeModules(REPO), path.join(root, "node_modules"), "junction");
  return root;
}

// The framework's installed dependencies: its own node_modules, or the workspace's that npm workspaces hoist them into.
function nodeModules(from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "node_modules", "js-yaml", "package.json"))) return path.join(dir, "node_modules");
    if (path.dirname(dir) === dir) throw new Error(`no node_modules with the framework's dependencies above ${from}: run npm install`);
  }
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: process.platform === "win32", ...opts });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
// The same, without blocking: the demo app answers from this process while the suite runs.
function runAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: process.platform === "win32", ...opts });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

async function main() {
  const root = scratchFramework();
  const lib = (p) => import(pathToFileURL(path.join(root, "scripts", p)).href);
  const { startDemoApp } = await lib("fixtures/demo-app/server.mjs");
  const app = await startDemoApp();
  console.log(`scratch ${root}\ndemo app ${app.url}`);
  try {
    const { initRun, endRun } = await lib("run.mjs");
    const { paths } = await lib("lib/contract.mjs");
    const { main: foundation } = await lib("foundation.mjs");
    const { fromPlaywright } = await lib("results.mjs");
    const { live } = await lib("lib/ledger.mjs");
    const { sweep } = await lib("lib/sweep.mjs");
    const { writeJson } = await lib("lib/files.mjs");
    const p = paths(PRODUCT, root);
    const config = (mode) => {
      const file = path.join(root, "config", `${PRODUCT}.yaml`);
      writeFileSync(file, [`product: ${PRODUCT}`, `target: {url: '${app.url}', api_urls: ['${app.url}']}`, "modules:", `  - {slug: contacts, name: Contacts, entry_url: '${app.url}/contacts'}`, `authorizations: {mode: ${mode}}`].join("\n") + "\n");
      return file;
    };

    // the foundation, rendered from the templates, installed and compiled
    initRun(config("readonly"), { root, runId: "demo-e2e-readonly" });
    for (const side of ["repo", "ui", "api"]) {
      const r = await foundation(["render", PRODUCT, "--side", side], { root });
      expect(r.code === 0, `foundation render --side ${side}`, JSON.stringify(r.out).slice(0, 400));
    }
    const installed = await foundation(["install", PRODUCT], { root });
    expect(installed.code === 0, "foundation install (npm install)", JSON.stringify(installed.out).slice(0, 400));
    const browser = run("npx", ["playwright", "install", "chromium"], { cwd: p.pwProject });
    expect(browser.code === 0, "the repo's Playwright browser is installed", browser.out.slice(-400));
    for (const side of ["repo", "ui", "api"]) {
      const c = await foundation(["check", PRODUCT, "--side", side], { root });
      expect(c.code === 0, `foundation check --side ${side} (tsc, playwright --list)`, JSON.stringify(c.out.problems ?? c.out).slice(0, 600));
    }
    for (const [file, dir] of [["ui.spec.ts", "tests/ui/e2e"], ["api.spec.ts", "tests/api/e2e"]]) {
      mkdirSync(path.join(p.pwProject, dir), { recursive: true });
      cpSync(path.join(root, "scripts", "fixtures", "e2e", file), path.join(p.pwProject, dir, file));
    }
    const emptyState = path.join(p.pwProject, ".auth", "e2e-empty.json");
    mkdirSync(path.dirname(emptyState), { recursive: true });
    writeFileSync(emptyState, JSON.stringify({ cookies: [], origins: [] }));
    // the catalogue's delete of a contact, which the sweep resolves a cleanup recipe through
    writeJson(path.join(p.module("contacts"), "api", "discovered-endpoints.json"), [{ id: "EP-contacts-2", method: "DELETE", path: "/api/contacts/{id}", server: app.url, crud: "delete" }]);

    const suite = async (mode, runId) => {
      const report = path.join(p.pwProject, "test-results", `e2e-${mode}.json`);
      const r = await runAsync("npx", ["playwright", "test", "tests/ui/e2e", "tests/api/e2e", "--reporter=list,json", "--retries=0"], {
        cwd: p.pwProject,
        env: { ...process.env, CI: "", BASE_URL: app.url, API_BASE_URL: app.url, STORAGE_STATE: emptyState, ATF_MODE: mode, ATF_PRODUCT: PRODUCT, ATF_RUN_ID: runId, ATF_REPO_ROOT: root, PLAYWRIGHT_JSON_OUTPUT_NAME: report },
      });
      const items = existsSync(report) ? fromPlaywright(JSON.parse(readFileSync(report, "utf8"))).items : [];
      const status = (id) => items.filter((i) => i.title.includes(id)).map((i) => i.status).join(",") || "absent";
      return { r, status };
    };

    // readonly: nothing reaches the app
    {
      const { r, status } = await suite("readonly", "demo-e2e-readonly");
      expect(["E2E-UI-1", "E2E-UI-2", "E2E-API-1", "E2E-API-2"].every((id) => status(id) === "passed"), "readonly: reads pass, a destructive click and an API POST are blocked", r.out.slice(-1500));
      expect(["E2E-UI-3", "E2E-UI-4", "E2E-API-3"].every((id) => status(id) === "absent"), "readonly: @mutates tests are not run");
      expect(JSON.stringify(app.contacts()) === JSON.stringify([{ id: 1, name: "Pre Existing" }]), "readonly: the app is unchanged", JSON.stringify(app.contacts()));
      await endRun(PRODUCT, { root });
    }

    // full-run: a test's own data only
    {
      initRun(config("full-run"), { root, runId: "demo-e2e-full" });
      const { r, status } = await suite("full-run", "demo-e2e-full");
      expect(["E2E-UI-1", "E2E-UI-3", "E2E-API-1", "E2E-API-3"].every((id) => status(id) === "passed"), "full-run: a test creates and deletes its own contact; the API leaves one recorded", r.out.slice(-1500));
      expect(status("E2E-UI-4") === "passed", "full-run: the ledger guard fails the test that deletes a pre-existing contact (an expected failure)", r.out.slice(-1500));
      const names = app.contacts().map((c) => c.name);
      expect(names.includes("Pre Existing"), "full-run: the pre-existing contact survived the attempt", names.join(", "));
      expect(!names.includes("Made By E2E") && names.includes("Left For The Sweep"), "full-run: the test's own contact is gone, the leftover is there", names.join(", "));
      const leftover = live(p.ledgerFile).filter((e) => e.runId === "demo-e2e-full");
      expect(leftover.length === 1 && leftover[0].cleanup?.endpoint === "EP-contacts-2", "full-run: the leftover is live in the ledger with its cleanup recipe", JSON.stringify(leftover));
      await endRun(PRODUCT, { root });
    }

    // the human's sweep, between runs
    {
      const s = await sweep(PRODUCT, { root, interactive: { isTTY: true, ask: async () => PRODUCT } });
      expect(!s.errors && s.deleted.length === 1 && !s.failed.length, "sweep: deletes the leftover through its recipe", JSON.stringify(s));
      expect(JSON.stringify(app.contacts().map((c) => c.name)) === JSON.stringify(["Pre Existing"]), "sweep: the app holds only what was there before", JSON.stringify(app.contacts()));
      expect(live(p.ledgerFile).length === 0, "sweep: nothing is live in the ledger any more");
    }
  } finally {
    await app.close();
    if (keep) console.log(`kept ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

await main();
