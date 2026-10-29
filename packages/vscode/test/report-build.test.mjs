// scripts/build.mjs: the bundle the vsix ships. It is CommonJS with `vscode` left to the extension host, unminified,
// it loads under a fake `vscode` and exports activate/deactivate; an import of a package or anything esbuild warns about
// is a build error. Builds go to temp folders, never to packages/vscode/dist.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { ENTRY, buildExtension } from "../scripts/build.mjs";

const temp = () => mkdtempSync(path.join(tmpdir(), "atf-vscode-build-"));

// A `vscode` that answers every property with something callable and constructible, so module-level code that
// touches the API loads; the test needs only the exports.
const FAKE_VSCODE = `
const any = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : any()),
  apply: () => any(),
  construct: () => any(),
});
module.exports = any();
`;

test("the extension builds to one CommonJS dist/extension.js that loads with a fake vscode and exports activate and deactivate", { skip: !existsSync(ENTRY) && "src/extension.js is not written yet" }, async () => {
  const out = temp();
  const { errors, outfile } = await buildExtension({ out });
  assert.deepEqual(errors, []);
  assert.equal(outfile, path.join(out, "extension.js"));
  const code = readFileSync(outfile, "utf8");
  assert.match(code, /require\("vscode"\)/, "vscode stays external, for the extension host to provide");
  assert.match(code, /^module\.exports = __toCommonJS\(extension_exports\);$/m, "CommonJS: the entry's exports become module.exports");
  assert.doesNotMatch(code, /sourceMappingURL/, "no sourcemap");
  assert.match(code, /function registerReport\(/, "unminified: the source's names survive (readable stack traces, D-094)");
  assert.ok(code.split("\n").length > 200, "unminified: one statement per line");
  mkdirSync(path.join(out, "node_modules", "vscode"), { recursive: true });
  writeFileSync(path.join(out, "node_modules", "vscode", "index.js"), FAKE_VSCODE);
  const ext = createRequire(outfile)(outfile);
  assert.equal(typeof ext.activate, "function");
  assert.equal(typeof ext.deactivate, "function");
});

test("the build refuses a runtime dependency, and any esbuild warning, and leaves no bundle behind", async () => {
  const dir = temp();
  const entry = path.join(dir, "entry.js");
  writeFileSync(entry, 'import yaml from "js-yaml";\nimport { readFileSync } from "node:fs";\nimport os from "os";\nimport * as vscode from "vscode";\nexport const activate = () => [yaml, readFileSync, os, vscode];\n');
  const dep = await buildExtension({ out: path.join(dir, "out"), entry });
  assert.equal(dep.errors.length, 1);
  assert.match(dep.errors[0], /entry\.js: imports 'js-yaml': the extension has no runtime dependencies/);
  assert.ok(!existsSync(dep.outfile));

  writeFileSync(entry, "export const where = import.meta.url;\n");
  const warned = await buildExtension({ out: path.join(dir, "out"), entry });
  assert.match(warned.errors.join("\n"), /^warning: .*import\.meta/m, "import.meta is empty in CommonJS: a warning fails the build");
  assert.ok(!existsSync(warned.outfile));

  writeFileSync(entry, "export const broken = ;\n");
  const failed = await buildExtension({ out: path.join(dir, "out"), entry });
  assert.match(failed.errors.join("\n"), /entry\.js:1: /);

  writeFileSync(entry, 'import { join } from "node:path";\nexport function activate() { return join("a", "b"); }\nexport function deactivate() {}\n');
  const ok = await buildExtension({ out: path.join(dir, "out"), entry });
  assert.deepEqual(ok.errors, []);
  assert.equal(createRequire(ok.outfile)(ok.outfile).activate(), path.join("a", "b"));
});
