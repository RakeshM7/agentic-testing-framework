// Each domain's flow as data, read by `orchestration.mjs next`: the build steps in order (agent, prompt arguments, and
// when a step is skipped), then the bounded review loop (gate -> reviewer -> writer/fixer) and, for the automation
// domains, the bounded run loop (runner-triager -> fixer). The clarification domain is one explorer per open row.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { planPaths, planUnverified } from "./api-plan.mjs";
import { foundationContext, foundationUnverified } from "./foundation.mjs";
import { reviewResult, testcaseContext, testcaseTotals, testcasesUnverified } from "./testcases.mjs";
import { noUiCases, uiCodeContext, uiCodeUnverified } from "./ui-code.mjs";

const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

// An empty catalogue is either "nothing there" or "could not see" (coverage.json status blocked, D-045); the two must
// never look the same in the run's notes and results.
function noApiSurface(c) {
  const api = path.join(c.productDir, "modules", c.module, "api");
  if ((json(path.join(api, "discovered-endpoints.json")) ?? []).length) return false;
  const cov = json(path.join(api, "coverage.json"));
  return cov?.status === "blocked" ? `API discovery blocked: ${cov.blockedReason ?? "no reason recorded"}` : "no API surface found";
}

// A side's foundation is rendered from templates/ (D-054): its build step is skipped only while foundation.mjs check's
// verified stamp is current, and a done step counts only with that stamp. A stale stamp (a hand edit, a changed
// overlay, template or run-config input) re-runs the side's agent, which re-renders.
const fCtx = (c) => foundationContext({ root: c.root, product: c.product, run: c.run, cfg: c.cfg, productDir: c.productDir, pwProject: c.pwProject, k6Project: c.k6Project });
const foundationStep = (side, step, agent, what) => ({
  step, agent,
  skip: (c) => !foundationUnverified(fCtx(c), side) && `${what} is verified (foundation.mjs check)`,
  verify: (c) => foundationUnverified(fCtx(c), side),
});

const tcCtx = (c) => testcaseContext({ root: c.root, product: c.product, module: c.module, run: c.run, cfg: c.cfg, productDir: c.productDir });

// The UI code is script-scaffolded (D-055): a done pages or tests step counts only once `ui-code.mjs check` (--pages for
// the page objects) stamped what is on disk. Verified once, when the step is first seen done (verifyOnce): the review
// and heal loops' fixer edits the same files afterwards, and the gate re-checks every rule each round.
const ucCtx = (c) => uiCodeContext({ root: c.root, product: c.product, module: c.module, run: c.run, cfg: c.cfg, productDir: c.productDir, pwProject: c.pwProject });

// The blocker and major rows of a findings file (docs/agent-handoffs.md §6): what is still unresolved.
export function unresolvedFindings(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\|\s*(\d+)\s*\|\s*(blocker|major)\s*\|[^|]*\|[^|]*\|\s*([^|]*?)\s*\|\s*((?:[^|\\]|\\.)*?)\s*\|/.exec(l))
    .filter(Boolean)
    .map((m) => ({ n: Number(m[1]), severity: m[2], rule: m[3], problem: m[4] }));
}

// ctx: {root, product, run, cfg, productDir, module, pwProject, k6Project, format}
export const FLOWS = {
  // The cases are script-built (D-053): a done write step counts only once testcases.mjs check passed on what is on
  // disk; the review verdict is derived from the reviewer's per-case review.json, never read from a typed line.
  testcases: {
    build: [{ step: "write", agent: "testcase-writer", verify: (c) => testcasesUnverified(tcCtx(c)) }],
    review: { reviewer: "testcase-reviewer", fixer: "testcase-writer", verdict: (c, round) => reviewResult(tcCtx(c), { round }) },
    // what done reports, so the orchestrator reads nothing by hand: totals, assumptions, approvals, unresolved findings
    done: (c, lastFindings) => ({ ...testcaseTotals(tcCtx(c)), unresolved: lastFindings ? unresolvedFindings(lastFindings) : [] }),
  },
  "playwright-ui": {
    build: [
      foundationStep("ui", "scaffold", "pw-ui-scaffolder", "the UI foundation"),
      // Every approved case is @api: nothing to scaffold or review; the runner records not-run with the reason.
      { step: "pages", agent: "pw-ui-pom-writer", skipRest: (c) => noUiCases(ucCtx(c)), verify: (c) => uiCodeUnverified(ucCtx(c), "pages"), verifyOnce: true },
      { step: "tests", agent: "pw-ui-tests-writer", verify: (c) => uiCodeUnverified(ucCtx(c), "tests"), verifyOnce: true },
    ],
    review: { reviewer: "pw-ui-reviewer", fixer: "pw-ui-fixer" },
    run: { runner: "pw-ui-test-runner-triager", fixer: "pw-ui-fixer", framework: "playwright-ui" },
  },
  "playwright-api": {
    build: [
      { step: "discover", agent: "api-discoverer" },
      // No API surface (or discovery blocked): nothing to plan, build or review; the runner records not-run with the reason.
      // The plan is script-built (D-046): a "done" plan step counts only once api-plan.mjs check passed on what is on disk.
      { step: "plan", agent: "api-test-planner", skipRest: noApiSurface, verify: (c) => planUnverified(planPaths(c.productDir, c.module)) },
      foundationStep("api", "scaffold", "pw-api-scaffolder", "the API foundation"),
      { step: "clients", agent: "pw-api-client-writer" },
      { step: "tests", agent: "pw-api-tests-writer" },
    ],
    review: { reviewer: "pw-api-reviewer", fixer: "pw-api-fixer" },
    run: { runner: "pw-api-test-runner-triager", fixer: "pw-api-fixer", framework: "playwright-api" },
  },
  k6: {
    build: [
      { step: "workload", agent: "k6-workload-designer" },
      // Every endpoint excluded: no scripts to write or review; the runner records not-run.
      { ...foundationStep("k6", "lib", "k6-lib-writer", "the k6 lib"), skipRest: (c) => (json(path.join(c.productDir, "modules", c.module, "k6", "workload.json")) ?? []).filter((w) => w.id !== `K6-${c.module}-0`).length === 0 && "every endpoint excluded from load" },
      { step: "scripts", agent: "k6-script-writer" },
    ],
    review: { reviewer: "k6-reviewer", fixer: "k6-fixer" },
    run: { runner: "k6-runner-triager", fixer: "k6-fixer", framework: "k6" },
  },
};

// `Verdict: pass | changes-required` of a findings file (review or gate), or null.
export function verdictOf(file) {
  if (!existsSync(file)) return null;
  return /^Verdict:\s*(pass|changes-required)\b/m.exec(readFileSync(file, "utf8"))?.[1] ?? null;
}

// Rows of a triage table (docs/agent-handoffs.md §7) whose Healable column is yes.
export function healableRows(file) {
  if (!existsSync(file)) return 0;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().toLowerCase());
  const col = lines.length ? cells(lines[0]).indexOf("healable") : -1;
  if (col < 0) return 0;
  return lines.slice(1).filter((l) => !/^\|?\s*:?-{3,}/.test(l.trim()) && cells(l)[col] === "yes").length;
}
