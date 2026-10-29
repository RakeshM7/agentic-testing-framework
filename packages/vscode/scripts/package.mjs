#!/usr/bin/env node
// Packages the extension (P-12, packaging phase 7) into dist/atf-vscode-<version>.vsix, the file the release publishes
// to the VS Code Marketplace and Open VSX.
//   package.mjs [--out <file>]   build dist/extension.js, check what vsce would ship, then vsce package into <file>
//                                (default packages/vscode/dist/atf-vscode-<version>.vsix)
//   package.mjs --ls             only the check: the files vsce would ship equal shippedFiles(manifest)
//   package.mjs --release <tag>  the release gate: LICENSE.md is no longer the DRAFT placeholder, and <tag> is
//                                core-v<the extension's version> (one release tag for the npm package, the Claude Code
//                                plugin and the extension: the same commit, the same version)
// Exit 1 with one line per problem.
//
// vsce runs with --no-dependencies (the bundle is the extension's whole code; there are no runtime dependencies, so
// node_modules must never be walked or shipped) and --allow-missing-repository (the source repository is private, so
// the public listing names none). .vscodeignore decides the shipped set; the check makes a drift in it, or a new file
// the manifest references (an icon), a packaging error instead of a silently different vsix.
//
// The licence gate reuses the framework's own rule (packages/core/scripts/build-package.mjs licenseIsDraft, D-094), so
// both artifacts of a release refuse the same DRAFT marker. It is build-time only: nothing of the framework is bundled.
// @vscode/vsce is a devDependency; it runs through the node binary itself (no shell, the same on Windows).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DRAFT_MARKER, TAG_PREFIX, licenseIsDraft } from "../../core/scripts/build-package.mjs";
import { DIST, PKG, buildExtension } from "./build.mjs";

export { DIST, PKG };

export const readManifest = (pkgDir = PKG) => JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
export const vsixName = (manifest) => `atf-vscode-${manifest.version}.vsix`;
const posix = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");

// Every file a manifest needs at run time or on the listing: package.json, its `main`, the listing pages, the
// Marketplace icon and every icon a contribution names (the activity-bar container, views, commands; a string or
// { light, dark }). This is exactly what the vsix may hold, beside vsce's own generated files.
export function shippedFiles(manifest) {
  const files = new Set(["package.json", "README.md", "CHANGELOG.md", "LICENSE.md"]);
  if (manifest.main) files.add(posix(manifest.main));
  if (manifest.icon) files.add(posix(manifest.icon));
  const icon = (v) => {
    if (typeof v === "string" && !v.startsWith("$(")) files.add(posix(v)); // $(codicon) names are not files
    else if (v && typeof v === "object") for (const k of ["light", "dark"]) icon(v[k]);
  };
  const c = manifest.contributes ?? {};
  for (const list of Object.values(c.viewsContainers ?? {})) for (const x of list ?? []) icon(x.icon);
  for (const list of Object.values(c.views ?? {})) for (const x of list ?? []) icon(x.icon);
  for (const x of c.commands ?? []) icon(x.icon);
  return [...files].sort();
}

// vsce's CLI, from the devDependency, run as `node <bin>`.
function vsceBin() {
  const require = createRequire(path.join(PKG, "package.json"));
  let pkgFile;
  try {
    pkgFile = require.resolve("@vscode/vsce/package.json");
  } catch {
    return null;
  }
  const { bin } = JSON.parse(readFileSync(pkgFile, "utf8"));
  return path.join(path.dirname(pkgFile), typeof bin === "string" ? bin : bin.vsce);
}
export const vsceAvailable = () => vsceBin() !== null;

export function vsce(args, { cwd = PKG } = {}) {
  const bin = vsceBin();
  if (!bin) throw new Error("@vscode/vsce is not installed: run npm install");
  return execFileSync(process.execPath, [bin, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// The files `vsce ls` would put in the vsix (offline: it only reads the folder and .vscodeignore).
export const vsceFiles = (pkgDir = PKG) =>
  vsce(["ls", "--no-dependencies"], { cwd: pkgDir })
    .split(/\r?\n/)
    .map((l) => posix(l.trim()))
    .filter(Boolean)
    .sort();

export function shippedErrors(listed, manifest) {
  const want = shippedFiles(manifest);
  return [
    ...want.filter((f) => !listed.includes(f)).map((f) => `${f}: the manifest needs it, but the vsix would not ship it (.vscodeignore, or not built)`),
    ...listed.filter((f) => !want.includes(f)).map((f) => `${f}: the vsix would ship it, but it is not one of the extension's files (.vscodeignore)`),
  ];
}

// The release gate (see the header).
export function releaseErrors(tag, { pkgDir = PKG } = {}) {
  const errors = [];
  const license = path.join(pkgDir, "LICENSE.md");
  if (!existsSync(license)) errors.push("LICENSE.md is missing");
  else if (licenseIsDraft(readFileSync(license, "utf8"))) errors.push(`LICENSE.md is still the placeholder (${DRAFT_MARKER}): legal's licence must replace it before the extension is published`);
  const { version } = readManifest(pkgDir);
  if (!/^core-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? "")) errors.push(`tag '${tag ?? ""}' is not ${TAG_PREFIX}<semver>`);
  else if (tag.slice(TAG_PREFIX.length) !== version) errors.push(`tag ${tag} does not match the extension version ${version} (packages/vscode/package.json)`);
  return errors;
}

export async function packageExtension({ out } = {}) {
  const manifest = readManifest();
  const vsix = path.resolve(out ?? path.join(DIST, vsixName(manifest)));
  const built = await buildExtension();
  if (built.errors.length) return { errors: built.errors, vsix };
  const errors = shippedErrors(vsceFiles(), manifest);
  if (errors.length) return { errors, vsix };
  vsce(["package", "--no-dependencies", "--allow-missing-repository", "--out", vsix]);
  return { errors: [], vsix };
}

export async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, ls: { type: "boolean" }, release: { type: "string" } }, strict: true });
  let errors;
  let done;
  try {
    if (values.release !== undefined) {
      errors = releaseErrors(values.release);
      done = `release ${values.release} may publish the extension`;
    } else if (values.ls) {
      errors = shippedErrors(vsceFiles(), readManifest());
      done = `the vsix ships ${shippedFiles(readManifest()).join(", ")}`;
    } else {
      const r = await packageExtension({ out: values.out });
      errors = r.errors;
      done = path.relative(process.cwd(), r.vsix) || r.vsix;
    }
  } catch (e) {
    errors = [String(e.stderr || e.message).trim()];
  }
  for (const e of errors) console.error(`package: ${e}`);
  if (!errors.length) console.log(`package: ${done}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
