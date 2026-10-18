// Gate rules for one side (ui | api) of a module's Playwright code (docs/playwright-conventions.md). Traceability is
// to the test cases (ui) or the API plan's scenarios (api). Only a case a human approved is automated
// (scripts/lib/testcases.mjs approvalSummary): the UI side must trace every approved non-@api case; a case not approved
// (awaiting, rejected, sent back, or edited since it was approved) needs no test, and a test that exists for one must
// be a test.fixme whose title says "awaiting approval".
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { SETUP_FILE, foundationContext, gateFoundationProblems } from "../foundation.mjs";
import { approvalSummary } from "../testcases.mjs";
import { finding, hygiene, matches, read, run, testTitles, walk } from "./common.mjs";

// What the side must implement: {want: Map id -> {mutates, identities[]}, unapproved: Set of case ids}, or null.
function expected({ productDir, module, side }) {
  const moduleDir = path.join(productDir, "modules", module);
  if (side === "ui") {
    const { built, cases, approved } = approvalSummary(productDir, module);
    if (!built) return null;
    const ok = new Set(approved);
    return { want: new Map(cases.filter((c) => ok.has(c.id) && !c.api).map((c) => [c.id, { mutates: c.mutates }])), unapproved: new Set(cases.filter((c) => !ok.has(c.id)).map((c) => c.id)) };
  }
  const plan = path.join(moduleDir, "api", "plan.json");
  if (!existsSync(plan)) return null;
  return { want: new Map(JSON.parse(readFileSync(plan, "utf8")).map((s) => [s.id, { mutates: Boolean(s.mutates), identities: (s.requires ?? []).filter((r) => r.startsWith("identity:")).map((r) => r.slice(9)) }])), unapproved: new Set() };
}

// Which tests exist (D-053). With compile on, the gate trusts Playwright's own list (`--list --reporter=json`, read by
// listedTests/listFindings): every listed test's title path (describe titles + test title) must carry a case id, and an
// unapproved case may appear only as a test.fixme saying "awaiting approval" -- however the test was declared (an
// alias, a helper, an import rename). Without compile the syntax rules below are the fallback.
//
// One literal test per approved case (D-053; the G5 rule): in a spec, a test is declared only as test(…),
// test.only/skip/fixme/fail(…) with a plain string literal title (no ${}, no + concatenation), so the gate sees every
// case id a spec automates. A variable or built title (a loop, a joined id, a template) and any alias of `test`
// (const t = test, destructuring, test passed as an argument, test.extend under another name) are major findings.
// Fixture files may export `test = base.extend(…)`; the rules apply to spec files only.

// The text with // and /* */ comments blanked (outside strings), keeping line numbers.
export function stripComments(text) {
  let out = "";
  let q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === q) q = null;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
    } else {
      if (c === "'" || c === '"' || c === "`") q = c;
      out += c;
    }
  }
  return out;
}

// The top-level arguments of the call whose "(" is at open: [source strings]. If it never seems to close (a regex
// literal such as /\(/ in the body unbalances the count), the rest of the text is the last argument, so the
// arguments before it are still read.
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let q = null;
  let start = open + 1;
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") q = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) {
        args.push(text.slice(start, i).trim());
        return args.filter((x, n) => x || n === 0);
      }
      depth--;
    } else if (c === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

const DECLARING = ["", "only", "skip", "fixme", "fail"];
const MAYBE_ANNOTATION = ["skip", "fixme", "fail"]; // test.skip(condition, reason) inside a test annotates, it declares nothing
const LITERAL = /^(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\$]|\\.|\$(?!\{))*`)$/;
const isFunction = (src) => /^(async\s+)?(function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(src ?? "");

// -> [{line, problem, fix}] for one file's text. spec: false for a non-spec file under the module's test or helper
// folders, where declaring any test at all is a finding (a helper that declares tests hides them from a spec).
export function testDeclarationProblems(raw, { spec = true } = {}) {
  const text = stripComments(raw);
  // the same text with string contents blanked, so `test(` or `= test` inside a string is never read as code
  let code = "";
  for (let i = 0, q = null; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === "\\") {
        code += "  ";
        i++;
      } else if (c === q) {
        q = null;
        code += c;
      } else code += c === "\n" ? c : " ";
    } else {
      if (c === "'" || c === '"' || c === "`") q = c;
      code += c;
    }
  }
  const lineAt = (i) => text.slice(0, i).split("\n").length;
  const out = [];
  for (const m of code.matchAll(/(?<![\w$.])test((?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g)) {
    const variant = m[1].replace(/[\s.]+/g, ".").replace(/^\./, "");
    if (!DECLARING.includes(variant)) continue;
    const args = callArgs(text, m.index + m[0].length - 1);
    if (MAYBE_ANNOTATION.includes(variant) && !isFunction(args[1])) continue;
    if (!spec) out.push({ line: lineAt(m.index), problem: "declares a test outside a spec file (a helper calling test hides the test from the spec that runs it)", fix: "declare every test in its spec file, with a literal title carrying its case id" });
    else if (!LITERAL.test(args[0] ?? ""))
      out.push({ line: lineAt(m.index), problem: `test title must be a literal carrying its case id (found ${(args[0] || "nothing").slice(0, 60)})`, fix: "write one test per approved case, its title a plain string literal starting with the case id; no variables, loops, ${} or +" });
  }
  const alias = (re, what) => {
    for (const m of code.matchAll(re)) out.push({ line: lineAt(m.index), problem: `${what}: a test declared through it is invisible to traceability and approval`, fix: "call test(), test.fixme() or test.describe() directly" });
  };
  alias(/\b(?:const|let|var)\s+(?!test\b)[A-Za-z_$][\w$]*\s*=\s*test\b(?!\s*\.\s*(?:info|step|use|expect|setTimeout)\b)/g, "an alias of test");
  alias(/\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*test\b/g, "test destructured");
  alias(/[(,]\s*test\s*(?=[,)])/g, "test passed as an argument");
  alias(/\bimport\s*(?:type\s+)?\{[^}]*\btest\s+as\s+[A-Za-z_$][\w$]*/g, "test imported under another name");
  alias(/\{[^{}]*\btest\s*:\s*[A-Za-z_$][\w$]*[^{}]*\}\s*=/g, "test destructured under another name");
  alias(/(?<![\w$.])test\s*\[/g, "test used with bracket access");
  const namespaces = [...code.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/g)].map((m) => m[1] ?? m[2]);
  for (const ns of namespaces) alias(new RegExp(`(?<![\\w$.])${ns.replace(/\$/g, "\\$")}\\s*\\.\\s*test\\b`, "g"), `test used as a member of ${ns}`);
  return out;
}

// Playwright's JSON report of `test --list --reporter=json` -> [{file, line, titlePath, fixme}], one per spec. The top
// suites are files (their titles are paths, not part of the title path); nested suites are describe blocks. A spec's
// file is relative to the report's config.rootDir; it is made absolute when rootDir is known. A test is a fixme when
// Playwright reports a fixme annotation, or expects it skipped without any annotation.
export function listedTests(report) {
  const out = [];
  const rootDir = report?.config?.rootDir;
  const visit = (suite, titles, top) => {
    const here = top ? titles : [...titles, suite.title ?? ""];
    for (const sp of suite.specs ?? []) {
      const file = sp.file ?? suite.file ?? "";
      out.push({
        file: file && rootDir ? path.resolve(rootDir, file) : file, line: sp.line ?? null, titlePath: [...here, sp.title ?? ""].filter(Boolean),
        fixme: (sp.tests ?? []).some((t) => (t.annotations ?? []).some((a) => a.type === "fixme") || (t.expectedStatus === "skipped" && !(t.annotations ?? []).length)),
      });
    }
    for (const child of suite.suites ?? []) visit(child, here, false);
  };
  for (const s of report?.suites ?? []) visit(s, [], true);
  return out;
}

// The listed tests against the cases: no case id in a title path, or an unapproved case not parked as a fixme
// "awaiting approval", is a major finding. root: the Playwright project, which an absolute listed file is reported
// relative to; dir: the module's spec folder, for a relative file or none. setupFile: the side's rendered
// fixtures/<side>/auth.setup.ts (D-054), whose setup test Playwright lists as the side project's dependency; it is not a
// case. Only that one file is exempt, and the gate flags any other setup file and any drift from its render.
export function listFindings(tests, { idRe, unapproved, what, root, dir, setupFile = null }) {
  const out = [];
  let base = root;
  try {
    if (root) base = realpathSync.native(root);
  } catch {}
  for (const t of tests) {
    const title = t.titlePath.join(" > ");
    const file = !t.file ? dir
      : path.isAbsolute(t.file) && base ? path.relative(base, t.file).replaceAll("\\", "/")
      : path.posix.join(dir, t.file.replaceAll("\\", "/").split("/").pop());
    if (setupFile && file === setupFile) continue;
    const ids = title.match(new RegExp(idRe.source, "g")) ?? [];
    if (!ids.length) out.push(finding("major", file, t.line, "traceability", `Playwright lists "${title}", which carries no ${what} id`, `start the test (or its describe) title with its ${what} id, or remove a test that has no ${what}`));
    for (const id of ids)
      if (unapproved.has(id) && !(t.fixme && /awaiting approval/i.test(title)))
        out.push(finding("major", file, t.line, "approval", `Playwright lists "${title}", but ${id} is not approved by a human`, `remove the test, or make it test.fixme('${id} ... awaiting approval')`));
  }
  return out;
}

// Runs `npx playwright test --list --reporter=json` for the module. -> {report} | {error}
function listJson(cwd, side, module) {
  try {
    const stdout = execFileSync("npx", ["playwright", "test", `--project=${side}`, `tests/${side}/${module}`, "--list", "--reporter=json"], { cwd, stdio: "pipe", encoding: "utf8", shell: process.platform === "win32", timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    return { report: JSON.parse(stdout.slice(stdout.indexOf("{"))) };
  } catch (e) {
    // the JSON reporter still prints the report on a failed load; its errors say why
    try {
      const stdout = String(e.stdout ?? "");
      const messages = (JSON.parse(stdout.slice(stdout.indexOf("{"))).errors ?? []).map((x) => String(x.message ?? "").split(/\r?\n/)[0]).filter(Boolean);
      if (messages.length) return { error: messages.slice(0, 3).join(" / ") };
    } catch {}
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message;
    return { error: out.split(/\r?\n/).slice(0, 8).join(" / ") };
  }
}

export function gatePlaywright(ctx) {
  const { pwProject, productDir, module, side, compile = true } = ctx;
  const idRe = new RegExp(`${side === "ui" ? "TC" : "API"}-${module}-\\d+`, "g");
  const what = side === "ui" ? "test case" : "plan scenario";
  const objects = side === "ui" ? `pages/${module}` : `clients/${module}`;
  const owned = [objects, `tests/${side}/${module}`, `helpers/${side}`, `fixtures/${side}`];
  const files = owned.flatMap((d) => walk(pwProject, d, /\.ts$/));
  const specs = walk(pwProject, `tests/${side}/${module}`, /\.spec\.ts$/);
  const exp0 = expected({ productDir, module, side });
  const want = exp0?.want ?? null;
  const unapproved = exp0?.unapproved ?? new Set();
  const out = [];

  if (want === null) out.push(finding("blocker", side === "ui" ? "testcases/" : "api/plan.json", null, "traceability", `no ${what}s to trace to`, `the ${side === "ui" ? "testcase" : "plan"} stage must finish first`));
  else if (want.size && !specs.length) out.push(finding("blocker", `tests/${side}/${module}/`, null, "traceability", `no specs for ${want.size} ${what}s`, `write one test per ${what}`));

  const implemented = new Set();
  const project = compile && existsSync(path.join(pwProject, "package.json"));
  if (!project) {
    // the syntax fallback: specs strictly; any other .ts under the module's tests or the side's helpers must declare no test
    const nonSpecs = [`tests/${side}/${module}`, `helpers/${side}`].flatMap((d) => walk(pwProject, d, /\.ts$/)).filter((f) => !f.endsWith(".spec.ts"));
    for (const [f, spec] of [...specs.map((f) => [f, true]), ...nonSpecs.map((f) => [f, false])])
      for (const d of testDeclarationProblems(read(pwProject, f), { spec })) out.push(finding("major", f, d.line, "test-declaration", d.problem, d.fix));
  }
  for (const f of specs) {
    const text = stripComments(read(pwProject, f));
    let mutating = false;
    for (const t of testTitles(text)) {
      const ids = t.title.match(idRe) ?? [];
      if (/@mutates\b/.test(t.title)) mutating = true;
      if (!ids.length) {
        out.push(finding("major", f, t.line, "traceability", `test "${t.title}" carries no ${what} id`, `start the title with its ${what} id, or remove a test that has no ${what}`));
        continue;
      }
      for (const id of ids) {
        if (unapproved.has(id)) {
          if (t.kind !== "fixme" || !/awaiting approval/i.test(t.title)) out.push(finding("major", f, t.line, "approval", `${id} is not approved by a human, so it is not automated yet`, `remove the test, or make it test.fixme('${id} ... awaiting approval')`));
          continue;
        }
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

  // The foundation (D-054), once the script rendered this side: no managed file (the side's, or the repo's shared
  // files) drifted from its render between renders, and the extension files keep the guard.
  const fctx = foundationContext({ root: ctx.root, product: ctx.product, run: ctx.run, cfg: ctx.cfg, productDir, pwProject, k6Project: ctx.k6Project });
  const rendered = existsSync(fctx.fp.manifest(side));
  for (const d of gateFoundationProblems(fctx, side)) out.push(finding("blocker", d.file, null, "foundation", d.problem, `re-render it: node scripts/foundation.mjs render ${ctx.product} --side <side> (a needed change goes into that side's overlay)`));

  if (project) {
    const tsc = run("npx", ["tsc", "--noEmit"], pwProject);
    if (tsc) out.push(finding("blocker", "tsconfig.json", null, "typecheck", `npx tsc --noEmit failed: ${tsc}`, "fix the type errors"));
    // no specs: nothing to list (Playwright would fail with "No tests found"); a missing spec is the blocker above
    const listed = specs.length ? listJson(pwProject, side, module) : null;
    if (listed?.error) out.push(finding("blocker", `tests/${side}/${module}/`, null, "list", `playwright --list failed: ${listed.error}`, "fix the specs so Playwright can load them"));
    else if (listed) out.push(...listFindings(listedTests(listed.report), { idRe, unapproved, what, root: pwProject, dir: `tests/${side}/${module}`, setupFile: rendered ? SETUP_FILE(side) : null }));
  }
  return out;
}
