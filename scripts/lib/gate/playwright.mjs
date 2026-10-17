// Gate rules for one side (ui | api) of a module's Playwright code (docs/playwright-conventions.md). Traceability is
// to the test cases (ui) or the API plan's scenarios (api).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { testcasesFile } from "../testcases.mjs";
import { parseCases } from "./testcases.mjs";
import { finding, hygiene, matches, read, run, testTitles, walk } from "./common.mjs";

// What the side must implement: Map id -> {mutates, identities[]}.
function expected({ productDir, module, side, format }) {
  const moduleDir = path.join(productDir, "modules", module);
  if (side === "ui") {
    const file = testcasesFile(moduleDir, module, format);
    if (!existsSync(file)) return null;
    return new Map(parseCases(file, format).filter((c) => c.id && !c.api).map((c) => [c.id, { mutates: c.mutates }]));
  }
  const plan = path.join(moduleDir, "api", "plan.json");
  if (!existsSync(plan)) return null;
  return new Map(JSON.parse(readFileSync(plan, "utf8")).map((s) => [s.id, { mutates: Boolean(s.mutates), identities: (s.requires ?? []).filter((r) => r.startsWith("identity:")).map((r) => r.slice(9)) }]));
}

export function gatePlaywright({ pwProject, productDir, module, side, format, compile = true }) {
  const idRe = new RegExp(`${side === "ui" ? "TC" : "API"}-${module}-\\d+`, "g");
  const what = side === "ui" ? "test case" : "plan scenario";
  const objects = side === "ui" ? `pages/${module}` : `clients/${module}`;
  const owned = [objects, `tests/${side}/${module}`, `helpers/${side}`, `fixtures/${side}`];
  const files = owned.flatMap((d) => walk(pwProject, d, /\.ts$/));
  const specs = walk(pwProject, `tests/${side}/${module}`, /\.spec\.ts$/);
  const want = expected({ productDir, module, side, format });
  const out = [];

  if (want === null) out.push(finding("blocker", side === "ui" ? "testcases/" : "api/plan.json", null, "traceability", `no ${what}s to trace to`, `the ${side === "ui" ? "testcase" : "plan"} stage must finish first`));
  else if (want.size && !specs.length) out.push(finding("blocker", `tests/${side}/${module}/`, null, "traceability", `no specs for ${want.size} ${what}s`, `write one test per ${what}`));

  const implemented = new Set();
  for (const f of specs) {
    const text = read(pwProject, f);
    let mutating = false;
    for (const t of testTitles(text)) {
      const ids = t.title.match(idRe) ?? [];
      if (/@mutates\b/.test(t.title)) mutating = true;
      if (!ids.length) {
        out.push(finding("major", f, t.line, "traceability", `test "${t.title}" carries no ${what} id`, `start the title with its ${what} id, or remove a test that has no ${what}`));
        continue;
      }
      for (const id of ids) {
        implemented.add(id);
        const exp = want?.get(id);
        if (want && !exp) out.push(finding("major", f, t.line, "traceability", `${id} is not a ${what} of this module`, `trace the test to an existing ${what}`));
        else if (exp?.mutates && !/@mutates\b/.test(t.title)) out.push(finding("blocker", f, t.line, "mutates-tag", `${id} changes data but its title lacks @mutates`, "add @mutates so readonly runs skip it"));
        for (const who of exp?.identities ?? []) if (!t.title.split(/\s+/).includes(`@identity-${who}`)) out.push(finding("major", f, t.line, "identity-tag", `${id} needs identity '${who}' but its title lacks @identity-${who}`, `add @identity-${who} so runs without that identity skip it`));
      }
    }
    if (mutating && !/\brecordCreated\(/.test(text)) out.push(finding("major", f, null, "ledger", "has @mutates tests but never calls recordCreated", "record every created entity with recordCreated right after creating it"));
  }
  for (const id of want?.keys() ?? []) if (!implemented.has(id)) out.push(finding("major", `tests/${side}/${module}/`, null, "traceability", `${id} has no test (nor a test.fixme with a reason)`, `implement it, or add test.fixme('${id} <reason>')`));

  for (const f of files) {
    for (const m of matches(read(pwProject, f), /\bwaitForTimeout\(/)) out.push(finding("major", f, m.line, "no-fixed-wait", "waitForTimeout is a fixed sleep", "wait for a state with a web-first assertion or locator"));
    if (f.startsWith(`${objects}/`)) for (const m of matches(read(pwProject, f), /\bexpect\(/)) out.push(finding("major", f, m.line, "no-assertions-in-objects", `assertion in a ${side === "ui" ? "page object" : "client"}`, "move the assertion into the test"));
  }
  out.push(...hygiene(pwProject, files));

  if (compile && existsSync(path.join(pwProject, "package.json"))) {
    const tsc = run("npx", ["tsc", "--noEmit"], pwProject);
    if (tsc) out.push(finding("blocker", "tsconfig.json", null, "typecheck", `npx tsc --noEmit failed: ${tsc}`, "fix the type errors"));
    const list = run("npx", ["playwright", "test", `--project=${side}`, `tests/${side}/${module}`, "--list"], pwProject);
    if (list) out.push(finding("blocker", `tests/${side}/${module}/`, null, "list", `playwright --list failed: ${list}`, "fix the specs so Playwright can load them"));
  }
  return out;
}
