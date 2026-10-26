#!/usr/bin/env node
// CLI over scripts/lib/foundation.mjs -- the product-wide foundations rendered from the framework's templates/
// (decision D-054): the Playwright repo's shared files (repo), the UI and API foundations (ui, api) and the k6 lib (k6).
// Uses the product's active run (state/run.json + state/config.resolved.json).
//
//   foundation.mjs render <product> --side repo|ui|api|k6
//        the side's templates + its overlay (artifacts/<p>/foundation/<side>-overlay.json) -> the managed files (only
//        those that differ), the extension seeds that are missing, and <side>-manifest.json. Exit 1, writing nothing,
//        on an invalid or uncited overlay.
//   foundation.mjs check <product> [--side S] [--static]
//        every rule: the overlay (schema, citations), no hand-edited managed file (package.json's dependency versions and
//        package-lock.json excepted), the guard fixtures, grepInvert, no hard-coded URL/credential/token, a credential
//        login only from a cited login state, the k6 safety calls, the extension requests' exports; then the compile
//        checks (npx tsc --noEmit and playwright test --list, or k6 inspect through a script-owned temp file). A full
//        pass stamps the manifest `verified`; --static skips the compile checks and stamps nothing. Without --side:
//        every side that was rendered.
//   foundation.mjs install <product>
//        npm install (the lockfile pins the versions it resolves) and npx playwright install chromium, in the
//        Playwright project; the repo side must be rendered first.
//   foundation.mjs paths <product> [--side S]
//        the overlay, manifest, managed files and extension files of each side
// Exits: 0 ok, 1 problems ({problems} or {errors}), 2 usage.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { SIDES, check, foundationContext, foundationPathsOut, install, render } from "./lib/foundation.mjs";
import { expandFw } from "./lib/roots.mjs";

const USAGE = "usage: foundation.mjs render <product> --side repo|ui|api|k6 | check <product> [--side S] [--static] | install <product> | paths <product> [--side S]";
const usage = (extra) => ({ code: 2, out: { errors: [...(extra ? [extra] : []), USAGE] } });

export function context(product, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  return foundationContext({ root, product, run: loadJson(p.runFile), cfg: loadJson(p.configFile), productDir: p.productDir, pwProject: p.pwProject, k6Project: p.k6Project });
}

// exec: (cmd, args, cwd) -> null | error text, for the compile checks and install; tests inject one.
export async function main(argv, { root = workspaceRoot, exec } = {}) {
  const [cmd, product, ...rest] = argv;
  if (!cmd || !product || product.startsWith("-")) return usage();
  let v;
  try {
    // a repeated --side is refused, so an allow-list entry such as `render * --side ui` can't be stretched to another side
    const sides = rest.filter((a) => a === "--side" || a.startsWith("--side=")).length;
    if (sides > 1) return usage("--side may be given once");
    ({ values: v } = parseArgs({ args: rest, options: { side: { type: "string" }, static: { type: "boolean" } }, strict: true, allowPositionals: false }));
  } catch (e) {
    return usage(e.message);
  }
  if (v.side !== undefined && !SIDES.includes(v.side)) return usage(`--side must be one of ${SIDES.join(", ")}`);
  if (v.static && cmd !== "check") return usage("--static is a check option");
  const ctx = context(product, root);
  if (cmd === "render") {
    if (!v.side) return usage("render needs --side");
    return render(ctx, v.side, validateData);
  }
  if (cmd === "check") {
    const sides = v.side ? [v.side] : SIDES.filter((s) => existsSync(ctx.fp.manifest(s)));
    if (!sides.length) return { code: 1, out: { valid: false, problems: [expandFw(`nothing rendered yet: node {fw}/scripts/foundation.mjs render ${product} --side repo`)] } };
    const results = [];
    for (const s of sides) results.push(await check(ctx, s, validateData, { compile: !v.static, ...(exec ? { exec } : {}) }));
    const valid = results.every((r) => r.valid);
    return { code: valid ? 0 : 1, out: sides.length === 1 ? results[0] : { valid, sides: results } };
  }
  if (cmd === "install") {
    if (v.side) return usage("install takes no --side (it installs the Playwright project)");
    return exec ? install(ctx, exec) : install(ctx);
  }
  if (cmd === "paths") {
    const sides = v.side ? [v.side] : SIDES;
    return { code: 0, out: sides.length === 1 ? foundationPathsOut(ctx, sides[0]) : { sides: sides.map((s) => foundationPathsOut(ctx, s)) } };
  }
  return usage(`unknown command ${cmd}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { code, out } = await main(process.argv.slice(2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(code);
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }, null, 2));
    process.exit(1);
  }
}
