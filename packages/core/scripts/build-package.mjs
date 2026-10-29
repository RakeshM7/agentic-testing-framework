#!/usr/bin/env node
// Builds the published @testagentic/atf (docs/packaging.md §2, §3.11, packaging phase 4): packages/core/dist, the only
// thing `npm publish` ever sees. The source package.json stays private, so the source itself can't be published.
//   build-package.mjs [--out <dir>]          build dist (default packages/core/dist), then check it as below
//   build-package.mjs --check [--out <dir>]  check an existing dist against package-files.txt and the source
//   build-package.mjs --release <tag>        the release gate: dist's LICENSE.md no longer carries the DRAFT marker,
//                    [--out <dir>]           and <tag> is core-v<dist package.json version>
// Exit 1 with one line per problem.
//
// What dist holds, at the same paths as the source, so `node {fw}/scripts/<x>.mjs` and every path a script computes
// from its own location still work in node_modules/@testagentic/atf:
//   - bundled (esbuild, ESM, not minified, so stack traces in artifacts/hook-errors.jsonl stay readable): bin/atf.mjs
//     and every scripts/**.mjs module that runs in a client. Each is its own entry point, with its static imports
//     inlined. node: built-ins and the dependencies and peer dependencies (js-yaml, ajv, acorn, playwright) stay
//     imports; any other package is a build error, so a dev-only import can't ship.
//   - copied as written: agents/, config/, templates/, schemas/, the agent-facing docs/, scripts/browser/init-page.cjs
//     and LICENSE.md.
//   - generated: package.json, without `private`, devDependencies or the test script.
//   - never: tests, test-helpers.mjs, scripts/fixtures/, this script, build-plugin.mjs (the Claude Code plugin's
//     build), e2e.mjs (`atf e2e` refuses an installed copy, D-087, and it needs the fixtures), node_modules, dotfiles.
//     The decision log, feedback/ and the maintainer docs live outside packages/core, so nothing here could copy them.
//
// Every relative import() stays an import() of the bundled sibling at its source path, never inlined. That keeps the
// hook entries' property (scripts/hooks/pretooluse.mjs): each lib loads inside their try, so a lib, or a dependency of
// one, that fails to load is still caught and the hook still fails closed. Inlining would hoist the libs' package
// imports to the top of the entry, where a missing js-yaml would crash the hook before its try, failing open. The same
// holds for bin/atf.mjs's postinstall catch. The specifier is rewritten from the bundle's own folder, since a module
// inlined from scripts/lib/ into scripts/ would otherwise resolve it from the wrong place.
//
// import.meta.url in an inlined module is rewritten to that module's own path in dist (its source path), so
// frameworkRoot (scripts/lib/roots.mjs), the report templates (scripts/lib/report.mjs) and each script's "am I the
// main module" check see the file they were written in, not the bundle that inlined them.
//
// esbuild is a devDependency of packages/core: build time only, never shipped, loaded only when building.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "acorn";

export const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ALLOW_LIST = "package-files.txt";
export const DRAFT_MARKER = "DRAFT — NOT FOR RELEASE";
export const TAG_PREFIX = "core-v";

const posix = (p) => p.split(path.sep).join("/");
const COPIED_DIRS = ["agents", "config", "templates", "schemas", "docs", "migrations"];
const COPIED_FILES = ["LICENSE.md", "scripts/browser/init-page.cjs"];
// scripts/ files that are not part of a client's install (see the header)
// (build-plugin.mjs builds the Claude Code plugin, a release step of ours, never a client's)
const MAINTAINER_ONLY = new Set(["scripts/test-helpers.mjs", "scripts/build-package.mjs", "scripts/build-plugin.mjs", "scripts/e2e.mjs"]);
const skipped = (name) => name.startsWith(".") || name === "node_modules";

// Every file under `dir`, as `/` paths relative to it, sorted. Dotfiles and node_modules are left out (npm drops
// dotfiles such as .gitignore from a package anyway, which is why the templates name theirs _gitignore).
export function listFiles(dir, rel = "") {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(p).isDirectory()) {
      if (!skipped(name)) out.push(...listFiles(p, r));
    } else out.push(r);
  }
  return out.sort();
}

// The modules bundled, by their path in packages/core (and in dist).
export function entryPoints(core = CORE) {
  const scripts = listFiles(path.join(core, "scripts"), "scripts").filter(
    (f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs") && !f.startsWith("scripts/fixtures/") && !MAINTAINER_ONLY.has(f)
  );
  return ["bin/atf.mjs", ...scripts];
}

// The files copied as written.
export function copiedFiles(core = CORE) {
  return [...COPIED_DIRS.flatMap((d) => listFiles(path.join(core, d), d)), ...COPIED_FILES].sort();
}

// What dist must hold, exactly.
export const plannedFiles = (core = CORE) => [...new Set([...entryPoints(core), ...copiedFiles(core), "package.json"])].sort();

// dist's package.json, from the source one: what an install needs, and nothing that only the monorepo uses.
export function distPackageJson(pkg) {
  const { name, version, description, license, type, bin, dependencies, peerDependencies, publishConfig } = pkg;
  return {
    name,
    version,
    description,
    license,
    type,
    bin,
    scripts: { postinstall: "node bin/atf.mjs sync --postinstall" },
    dependencies,
    peerDependencies,
    publishConfig,
  };
}

// ---- the allow-list (package-files.txt) -------------------------------------------------------------------------------

const GLOB = /[*?]/;
// `*` and `?` stay within one folder, `**/` spans any number of them (none included), a trailing `**` everything below
export function globRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function parseAllowList(text) {
  const include = [];
  const exclude = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("!")) exclude.push(line.slice(1));
    else include.push(line);
  }
  return { include, exclude };
}

export const readAllowList = (core = CORE) => parseAllowList(readFileSync(path.join(core, ALLOW_LIST), "utf8"));

// files: dist's files as `/` paths. -> the problems, one line each (empty when the list allows exactly these files)
export function checkFiles(files, { include, exclude }) {
  const errors = [];
  const inc = include.map((g) => ({ g, re: globRegex(g) }));
  const exc = exclude.map((g) => ({ g, re: globRegex(g) }));
  for (const f of files) {
    const never = exc.find((x) => x.re.test(f));
    if (never) errors.push(`${f}: never shipped (!${never.g} in ${ALLOW_LIST})`);
    else if (!inc.some((x) => x.re.test(f))) errors.push(`${f}: not in ${ALLOW_LIST}`);
  }
  for (const { g, re } of inc) {
    if (files.some((f) => re.test(f))) continue;
    errors.push(GLOB.test(g) ? `${g}: matches no file in dist (${ALLOW_LIST})` : `${g}: required by ${ALLOW_LIST}, missing from dist`);
  }
  return errors;
}

// dist against the allow-list, and against what the source says it must hold (a file the build should have written
// and didn't, or one it should not have). -> problems
export function checkDist(dist, { core = CORE } = {}) {
  if (!existsSync(dist)) return [`${dist} does not exist: run node scripts/build-package.mjs first`];
  const files = listFiles(dist);
  const all = [];
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(path.join(dir, name)).isDirectory()) walk(path.join(dir, name), r);
      else all.push(r);
    }
  })(dist, "");
  const errors = checkFiles(all.sort(), readAllowList(core));
  const planned = new Set(plannedFiles(core));
  for (const f of planned) if (!files.includes(f)) errors.push(`${f}: missing from dist (the source has it)`);
  for (const f of files) if (!planned.has(f)) errors.push(`${f}: in dist, but nothing in the source builds it`);
  return [...new Set(errors)];
}

// ---- the release gate ----------------------------------------------------------------------------------------------

// The placeholder licence is marked on its first line; legal's EULA replaces the whole file (packaging §2).
export const licenseIsDraft = (text) => text.includes(DRAFT_MARKER) || /\bDRAFT\b/.test(text.replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim()) ?? "");

export function releaseErrors(dist, tag) {
  const errors = [];
  const license = path.join(dist, "LICENSE.md");
  if (!existsSync(license)) errors.push("LICENSE.md is missing from dist");
  else if (licenseIsDraft(readFileSync(license, "utf8"))) errors.push(`LICENSE.md is still the placeholder (${DRAFT_MARKER}): legal's EULA must replace it before a release`);
  const { version } = JSON.parse(readFileSync(path.join(dist, "package.json"), "utf8"));
  if (!/^core-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag ?? "")) errors.push(`tag '${tag ?? ""}' is not ${TAG_PREFIX}<semver>`);
  else if (tag.slice(TAG_PREFIX.length) !== version) errors.push(`tag ${tag} does not match the package version ${version} (packages/core/package.json)`);
  return errors;
}

// ---- the build -----------------------------------------------------------------------------------------------------

const BUILTINS = new Set(builtinModules);
const packageName = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
const fromBundle = (entryAbs, target) => {
  const r = posix(path.relative(path.dirname(entryAbs), target));
  return r.startsWith(".") ? r : `./${r}`;
};

// A module's source as it is inlined into a bundle at `ownUrl` (the module's own path, relative to the bundle): every
// import.meta.url becomes that path's URL. Parsed (acorn), so comments and strings that merely mention them are left
// alone. -> { contents } | { error } for an import.meta other than .url, or an import() of a computed specifier, which
// would resolve from the bundle's folder rather than the module's.
export function inlinedSource(text, ownUrl) {
  let ast;
  try {
    ast = parse(text, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  } catch (e) {
    return { error: `does not parse (${e.message})` };
  }
  const urls = [];
  let error;
  (function walk(node, parent) {
    if (error || !node || typeof node.type !== "string") return;
    if (node.type === "MetaProperty" && node.meta.name === "import") {
      if (parent?.type === "MemberExpression" && parent.object === node && !parent.computed && parent.property.name === "url") urls.push(parent);
      else error = "only import.meta.url can be rewritten when the module is inlined";
    }
    if (node.type === "ImportExpression" && !(node.source.type === "Literal" && typeof node.source.value === "string"))
      error = `an import() of a computed specifier (line ${text.slice(0, node.start).split("\n").length}) would resolve from the bundle's folder once inlined; load this module itself with import()`;
    for (const [k, v] of Object.entries(node)) {
      if (k === "parent") continue;
      if (Array.isArray(v)) for (const c of v) walk(c, node);
      else if (v && typeof v === "object") walk(v, node);
    }
  })(ast, null);
  if (error) return { error };
  let contents = text;
  for (const m of urls.sort((a, b) => b.start - a.start)) contents = `${contents.slice(0, m.start)}new URL(${JSON.stringify(ownUrl)}, import.meta.url).href${contents.slice(m.end)}`;
  return { contents };
}

// The esbuild plugin for one entry point (see the header for why each rule exists).
function atfPlugin(entryAbs, { core, deps, entries }) {
  return {
    name: "atf-package",
    setup(b) {
      b.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        const spec = args.path;
        if (spec.startsWith("node:") || BUILTINS.has(spec)) return { path: spec, external: true };
        if (spec.startsWith("./") || spec.startsWith("../")) {
          if (args.kind !== "dynamic-import") return undefined; // inlined
          const target = path.resolve(args.resolveDir, spec);
          const rel = posix(path.relative(core, target));
          if (!entries.has(rel)) return { errors: [{ text: `import("${spec}") loads ${rel}, which is not bundled into the package` }] };
          return { path: fromBundle(entryAbs, target), external: true };
        }
        if (deps.has(packageName(spec))) return { path: spec, external: true };
        return { errors: [{ text: `'${spec}' is not a dependency or peer dependency of @testagentic/atf, so a client's install would not have it` }] };
      });
      b.onLoad({ filter: /\.m?js$/ }, (args) => {
        if (path.relative(entryAbs, args.path) === "") return undefined; // the entry itself (any drive-letter case on Windows)
        const text = readFileSync(args.path, "utf8");
        const r = inlinedSource(text, fromBundle(entryAbs, args.path));
        return r.error ? { errors: [{ text: `${posix(path.relative(core, args.path))}: ${r.error}` }] } : { contents: r.contents, loader: "js" };
      });
    },
  };
}

// -> { errors, bundled, copied } and dist written at `out`
export async function buildPackage({ core = CORE, out = path.join(core, "dist") } = {}) {
  const { build } = await import("esbuild");
  const pkg = JSON.parse(readFileSync(path.join(core, "package.json"), "utf8"));
  const deps = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
  const list = entryPoints(core);
  const entries = new Set(list);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const banner = `// ${pkg.name} ${pkg.version}. All rights reserved: see LICENSE.md. Built by scripts/build-package.mjs; not the source.`;
  const errors = [];
  await Promise.all(
    list.map(async (rel) => {
      const abs = path.join(core, ...rel.split("/"));
      try {
        const r = await build({
          entryPoints: [abs],
          outfile: path.join(out, ...rel.split("/")),
          bundle: true,
          format: "esm",
          platform: "node",
          target: "node20",
          minify: false,
          sourcemap: false,
          legalComments: "none",
          charset: "utf8",
          logLevel: "silent",
          banner: { js: banner },
          plugins: [atfPlugin(abs, { core, deps, entries })],
        });
        for (const w of r.warnings) errors.push(`${rel}: ${w.text}${w.location ? ` (${w.location.file}:${w.location.line})` : ""}`);
      } catch (e) {
        for (const x of e.errors ?? [{ text: e.message }]) errors.push(`${rel}: ${x.text}${x.location ? ` (${x.location.file}:${x.location.line})` : ""}`);
      }
    })
  );
  const copied = copiedFiles(core);
  for (const rel of copied) {
    const src = path.join(core, ...rel.split("/"));
    if (!existsSync(src)) {
      errors.push(`${rel}: missing from the source`);
      continue;
    }
    cpSync(src, path.join(out, ...rel.split("/")));
  }
  writeFileSync(path.join(out, "package.json"), `${JSON.stringify(distPackageJson(pkg), null, 2)}\n`);
  return { errors: [...errors.sort(), ...(errors.length ? [] : checkDist(out, { core }))], bundled: list.length, copied: copied.length, out };
}

export async function main(argv) {
  const { values } = parseArgs({ args: argv, options: { out: { type: "string" }, check: { type: "boolean" }, release: { type: "string" } }, strict: true });
  const out = path.resolve(values.out ?? path.join(CORE, "dist"));
  let errors;
  if (values.release !== undefined) errors = existsSync(out) ? releaseErrors(out, values.release) : [`${out} does not exist: build it first`];
  else if (values.check) errors = checkDist(out);
  else {
    const r = await buildPackage({ out });
    errors = r.errors;
    if (!errors.length) console.log(`build-package: ${r.bundled} module(s) bundled, ${r.copied} file(s) copied, into ${out}`);
  }
  for (const e of errors) console.error(`build-package: ${e}`);
  if (!errors.length) console.log(values.release !== undefined ? `build-package: release ${values.release} may be published` : `build-package: ${out} matches ${ALLOW_LIST}`);
  return errors.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
