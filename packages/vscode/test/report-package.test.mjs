// scripts/package.mjs and the release: the files the vsix ships (.vscodeignore, checked against the manifest, and with
// `vsce ls` when @vscode/vsce is installed), the release gate (DRAFT licence, tag = version), and the release
// workflow's vscode job running after, and without changing, the npm and plugin jobs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { DRAFT_MARKER, licenseIsDraft } from "../../core/scripts/build-package.mjs";
import { buildExtension } from "../scripts/build.mjs";
import { PKG, readManifest, releaseErrors, shippedErrors, shippedFiles, vsceAvailable, vsceFiles, vsixName } from "../scripts/package.mjs";

const REPO = path.resolve(PKG, "..", "..");
const manifest = readManifest();
const SHIPPED = ["CHANGELOG.md", "LICENSE.md", "README.md", "dist/extension.js", "media/atf.svg", "media/icon.png", "package.json"];

test("shippedFiles: the manifest's main, the listing pages and every icon it names; codicons are not files", () => {
  assert.deepEqual(shippedFiles(manifest), SHIPPED);
  const m = {
    main: "./out/main.js",
    icon: "img\\big.png",
    contributes: {
      viewsContainers: { activitybar: [{ icon: "a.svg" }], panel: [{ icon: { light: "l.svg", dark: "d.svg" } }] },
      views: { x: [{ icon: "v.svg" }, {}] },
      commands: [{ icon: "$(refresh)" }, { icon: { light: "cl.svg", dark: "$(play)" } }],
    },
  };
  assert.deepEqual(shippedFiles(m), ["CHANGELOG.md", "LICENSE.md", "README.md", "a.svg", "cl.svg", "d.svg", "img/big.png", "l.svg", "out/main.js", "package.json", "v.svg"]);
  assert.equal(vsixName(manifest), `atf-vscode-${manifest.version}.vsix`);
});

test(".vscodeignore excludes everything, then keeps exactly the manifest's files", () => {
  const lines = readFileSync(path.join(PKG, ".vscodeignore"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  assert.equal(lines[0], "**", "everything is excluded first");
  assert.deepEqual(lines.slice(1).sort(), SHIPPED.map((f) => `!${f}`).sort(), "then only the shipped files come back, one plain path each (no globs)");
});

test("shippedErrors names a missing and a stray file", () => {
  assert.deepEqual(shippedErrors(SHIPPED, manifest), []);
  const errs = shippedErrors([...SHIPPED.filter((f) => f !== "media/atf.svg"), "src/report.js"], manifest);
  assert.equal(errs.length, 2);
  assert.match(errs[0], /^media\/atf\.svg: the manifest needs it/);
  assert.match(errs[1], /^src\/report\.js: the vsix would ship it/);
});

test("vsce ls (offline) lists exactly the shipped files", { skip: !vsceAvailable() && "@vscode/vsce is not installed (npm install): the pattern test above still checks .vscodeignore" }, async () => {
  // vsce ls reads the folder as it is: build dist/extension.js first so it is there to list
  assert.deepEqual((await buildExtension()).errors, []);
  assert.deepEqual(vsceFiles(), SHIPPED);
});

test("the release gate: a DRAFT licence and a tag that isn't core-v<extension version> are refused", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "atf-vscode-release-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
  writeFileSync(path.join(dir, "LICENSE.md"), `${DRAFT_MARKER}\n\n# placeholder\n`);
  assert.deepEqual(releaseErrors("core-v1.2.3", { pkgDir: dir }), [`LICENSE.md is still the placeholder (${DRAFT_MARKER}): legal's licence must replace it before the extension is published`]);
  writeFileSync(path.join(dir, "LICENSE.md"), "# The licence\n\nThe real text.\n");
  assert.deepEqual(releaseErrors("core-v1.2.3", { pkgDir: dir }), []);
  assert.match(releaseErrors("core-v1.2.4", { pkgDir: dir })[0], /tag core-v1\.2\.4 does not match the extension version 1\.2\.3/);
  assert.match(releaseErrors("v1.2.3", { pkgDir: dir })[0], /is not core-v<semver>/);
  assert.match(releaseErrors(undefined, { pkgDir: dir })[0], /is not core-v<semver>/);
  writeFileSync(path.join(dir, "LICENSE.md"), "DRAFT licence\n");
  assert.equal(releaseErrors("core-v1.2.3", { pkgDir: dir }).length, 1, "the framework's rule: DRAFT on the first line is a draft too");
});

test("the extension's licence is the DRAFT placeholder today, marked as the framework's gate expects, so the release refuses it", () => {
  const ours = readFileSync(path.join(PKG, "LICENSE.md"), "utf8");
  assert.ok(ours.split("\n")[0].includes(DRAFT_MARKER), "the placeholder's first line carries the marker");
  assert.ok(licenseIsDraft(ours));
  assert.match(releaseErrors(`core-v${manifest.version}`)[0], /LICENSE\.md is still the placeholder/);
});

test("the extension's version is the framework's: one core-v tag releases both", () => {
  const core = JSON.parse(readFileSync(path.join(REPO, "packages", "core", "package.json"), "utf8"));
  assert.equal(manifest.version, core.version);
});

test("the release workflow: the vscode job runs after publish, gates first, then packages, uploads and publishes to both registries", () => {
  const wf = yaml.load(readFileSync(path.join(REPO, ".github", "workflows", "release.yml"), "utf8"));
  assert.deepEqual(Object.keys(wf.jobs), ["publish", "plugin", "vscode"], "the existing jobs stay, in front");
  const job = wf.jobs.vscode;
  assert.equal(job.needs, "publish");
  const runs = job.steps.map((s) => s.run ?? s.uses ?? "");
  const at = (re) => runs.findIndex((r) => re.test(r));
  assert.ok(at(/^npm ci$/) >= 0);
  assert.ok(at(/^npm ci$/) < at(/package\.mjs --release "\$TAG"/));
  assert.ok(at(/package\.mjs --release/) < at(/node packages\/vscode\/scripts\/package\.mjs\n/), "the gate runs before anything is built");
  assert.ok(at(/package\.mjs\n/) < at(/upload-artifact/));
  const market = at(/vsce publish --packagePath "\$VSIX"/);
  const ovsx = at(/"\$OVSX" publish "\$VSIX"/);
  assert.ok(at(/upload-artifact/) < market && market < ovsx);
  for (const i of [market, ovsx]) {
    assert.match(runs[i], /DRY_RUN" = "true".*::notice.*exit 0/, "a dry run publishes nothing, with a notice");
    assert.match(runs[i], /PAT" != "true".*::notice.*exit 0/, "no secret: a notice, not a failure");
    assert.match(runs[i], /already published"; exit 0/);
    assert.match(runs[i], /--skip-duplicate/);
  }
  assert.equal(job.steps[market].env.VSCE_PAT, "${{ secrets.VSCE_PAT }}");
  assert.equal(job.steps[ovsx].env.OVSX_PAT, "${{ secrets.OVSX_PAT }}");
  assert.match(job.env.OVSX, /^ovsx@\d+\.\d+\.\d+$/, "ovsx through npx at a pinned version");
});

test("the build output is git-ignored", () => {
  const out = execFileSync("git", ["check-ignore", "packages/vscode/dist/extension.js", "packages/vscode/dist/atf-vscode-0.1.0.vsix"], { cwd: REPO, encoding: "utf8" });
  assert.equal(out.trim().split(/\r?\n/).length, 2);
});
