#!/usr/bin/env node
// Builds the extension (P-12, packaging phase 7): esbuild bundles src/extension.js and everything it imports into one
// file, dist/extension.js, the manifest's `main` and the only code the vsix ships.
//   build.mjs [--out <dir>]     write <dir>/extension.js (default packages/vscode/dist)
// Exit 1 with one line per problem.
//
// Why each setting:
//   - CommonJS for platform node: the extension host require()s `main`. The sources are ESM; esbuild converts them.
//   - `vscode` is external: the extension host provides it, there is no such package to bundle.
//   - unminified, no sourcemap: the same choice as the framework's own bundle (D-094), so a stack trace a user pastes
//     from the extension host log names real functions and lines. The sources are not secret (a public extension that
//     holds no framework code).
//   - no runtime dependencies: anything bundled must come from src/; an import of a package (other than node: built-ins
//     and `vscode`) is a build error, so a dev-only or framework import can't slip into the published extension.
//   - any esbuild warning fails the build (e.g. import.meta, which is empty in CommonJS).
// esbuild is a devDependency, loaded only when building.
import { mkdirSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY = path.join(PKG, "src", "extension.js");
export const DIST = path.join(PKG, "dist");
// VS Code ships Node 20 or later in its extension host (Electron); the bundle targets the oldest.
export const TARGET = "node20";

const BUILTINS = new Set(builtinModules);
const isBuiltin = (spec) => spec.startsWith("node:") || BUILTINS.has(spec.split("/")[0]);

// esbuild plugin: `vscode` and node built-ins stay require()s; any other bare import is refused.
const onlyOwnCode = (problems) => ({
  name: "atf-vscode-imports",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      // the entry point, and an absolute path (C:\… on Windows also matches the filter), resolve as usual
      if (args.kind === "entry-point" || path.isAbsolute(args.path)) return undefined;
      if (args.path === "vscode" || isBuiltin(args.path)) return { path: args.path, external: true };
      problems.push(`${path.relative(PKG, args.importer).split(path.sep).join("/")}: imports '${args.path}': the extension has no runtime dependencies`);
      return { path: args.path, external: true };
    });
  },
});

export async function buildExtension({ out = DIST, entry = ENTRY } = {}) {
  const { build } = await import("esbuild");
  const problems = [];
  const outfile = path.join(out, "extension.js");
  rmSync(outfile, { force: true });
  mkdirSync(out, { recursive: true });
  let r;
  try {
    r = await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: TARGET,
      sourcemap: false,
      minify: false,
      legalComments: "none",
      logLevel: "silent",
      plugins: [onlyOwnCode(problems)],
    });
  } catch (e) {
    return { errors: (e.errors ?? [{ text: e.message }]).map((m) => `${m.location ? `${m.location.file}:${m.location.line}: ` : ""}${m.text}`), outfile };
  }
  problems.push(...r.warnings.map((m) => `warning: ${m.location ? `${m.location.file}:${m.location.line}: ` : ""}${m.text}`));
  if (problems.length) rmSync(outfile, { force: true });
  return { errors: problems, outfile };
}

export async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" } }, strict: true });
  const { errors, outfile } = await buildExtension({ out: path.resolve(values.out ?? DIST) });
  for (const e of errors) console.error(`build: ${e}`);
  if (!errors.length) console.log(`build: ${path.relative(process.cwd(), outfile) || outfile}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
