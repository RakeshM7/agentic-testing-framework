// Each domain's flow as data, read by `orchestration.mjs next`: the build steps in order (agent, prompt arguments, and
// when a step is skipped), then the bounded review loop (gate -> reviewer -> writer/fixer) and, for the automation
// domains, the bounded run loop (runner-triager -> fixer). The clarification domain is one explorer per open row.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const exists = (dir, ...files) => files.every((f) => existsSync(path.join(dir, f)));
const json = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

// ctx: {productDir, module, pwProject, k6Project, format}
export const FLOWS = {
  testcases: {
    build: [{ step: "write", agent: "testcase-writer", args: (c) => ({ format: c.format }) }],
    review: { reviewer: "testcase-reviewer", fixer: "testcase-writer", reviewerArgs: (c) => ({ format: c.format }), fixerArgs: (c) => ({ format: c.format }) },
  },
  "playwright-ui": {
    build: [
      { step: "scaffold", agent: "pw-ui-scaffolder", skip: (c) => exists(c.pwProject, "config/ui/settings.ts", "fixtures/ui/index.ts", "fixtures/ui/auth.setup.ts") && "the UI foundation exists" },
      { step: "pages", agent: "pw-ui-pom-writer" },
      { step: "tests", agent: "pw-ui-tests-writer" },
    ],
    review: { reviewer: "pw-ui-reviewer", fixer: "pw-ui-fixer" },
    run: { runner: "pw-ui-test-runner-triager", fixer: "pw-ui-fixer", framework: "playwright-ui" },
  },
  "playwright-api": {
    build: [
      { step: "discover", agent: "api-discoverer" },
      // No API surface: nothing to plan, build or review; the runner records not-run.
      { step: "plan", agent: "api-test-planner", skipRest: (c) => (json(path.join(c.productDir, "modules", c.module, "api", "discovered-endpoints.json")) ?? []).length === 0 && "no API surface found" },
      { step: "scaffold", agent: "pw-api-scaffolder", skip: (c) => exists(c.pwProject, "config/api/settings.ts", "fixtures/api/index.ts", "fixtures/api/auth.setup.ts", "helpers/api/schema.ts") && "the API foundation exists" },
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
      { step: "lib", agent: "k6-lib-writer", skipRest: (c) => (json(path.join(c.productDir, "modules", c.module, "k6", "workload.json")) ?? []).filter((w) => w.id !== `K6-${c.module}-0`).length === 0 && "every endpoint excluded from load", skip: (c) => exists(c.k6Project, "lib/config.js") && "the shared lib exists" },
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
