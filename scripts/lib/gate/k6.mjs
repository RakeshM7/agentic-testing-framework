// Gate rules for a module's k6 scripts (docs/k6-conventions.md): one script per workload scenario, the safety calls
// in setup(), handleSummary, and `k6 inspect`. Never runs load.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { foundationContext, gateFoundationProblems } from "../foundation.mjs";
import { finding, hygiene, read, run, walk } from "./common.mjs";

export function gateK6(ctx) {
  const { k6Project, productDir, module, compile = true } = ctx;
  const out = [];
  const workloadFile = path.join(productDir, "modules", module, "k6", "workload.json");
  if (!existsSync(workloadFile)) return [finding("blocker", "k6/workload.json", null, "workload", "workload.json is missing", "the workload step must finish first")];
  const scenarios = JSON.parse(readFileSync(workloadFile, "utf8")).filter((w) => w.id !== `K6-${module}-0`);
  const scripts = walk(k6Project, "scripts", new RegExp(`^${module}-.*\\.js$`));
  if (!existsSync(path.join(k6Project, "lib", "config.js"))) out.push(finding("blocker", "lib/config.js", null, "lib", "the shared lib is missing", "run k6-lib-writer"));

  const idRe = new RegExp(`K6-${module}-\\d+`, "g");
  const where = new Map();
  for (const f of scripts) {
    const text = read(k6Project, f);
    const ids = [...new Set(text.match(idRe) ?? [])].filter((id) => id !== `K6-${module}-0`);
    if (!ids.length) out.push(finding("major", f, null, "traceability", "names no workload scenario id", "put the workload id in the header comment"));
    for (const id of ids) where.set(id, [...(where.get(id) ?? []), f]);
    if (!/\bassertAllowedHost\(/.test(text)) out.push(finding("blocker", f, null, "allowed-host", "setup() does not call assertAllowedHost()", "call assertAllowedHost() in setup()"));
    if (!/\brequireFullRun\(/.test(text)) out.push(finding("blocker", f, null, "full-run", "setup() does not call requireFullRun()", "call requireFullRun(<mutates>) in setup()"));
    if (!/\bhandleSummary\b/.test(text)) out.push(finding("major", f, null, "summary", "handleSummary is not exported", "export { handleSummary } from '../lib/summary.js'"));
  }
  for (const w of scenarios) {
    const files = where.get(w.id) ?? [];
    if (!files.length) out.push(finding("major", "scripts/", null, "traceability", `${w.id} (${w.name}) has no script`, "write one script per workload scenario"));
    if (files.length > 1) out.push(finding("major", files.join(", "), null, "traceability", `${w.id} is implemented by ${files.length} scripts`, "one script per scenario"));
  }
  out.push(...hygiene(k6Project, scripts));
  // The lib is rendered from templates/ (D-054): once the script rendered it, no lib file may drift from its render.
  const fctx = foundationContext({ root: ctx.root, product: ctx.product, run: ctx.run, cfg: ctx.cfg, productDir, pwProject: ctx.pwProject, k6Project });
  for (const d of gateFoundationProblems(fctx, "k6")) out.push(finding("blocker", d.file, null, "foundation", d.problem, `re-render it: node scripts/foundation.mjs render ${ctx.product} --side k6 (a needed change goes into the k6 overlay or lib/ext/)`));

  if (compile) for (const f of scripts) {
    const err = run("k6", ["inspect", f], k6Project);
    if (err) out.push(finding("blocker", f, null, "inspect", `k6 inspect failed: ${err}`, "fix the script so k6 can load it"));
  }
  return out;
}
