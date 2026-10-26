// Citations in an agent's overlay (docs/conventions.md "Script-built agents", D-049). A citation is checked against
// the module's own files, never taken on trust:
//   clarification:<id>     a row of clarifications.csv that is answered
//   testcase:<TC id>       a test case of the module
//   knowledge:<path>       a file under the product's knowledge/
//   spec:<path>            a file under the module's api/
//   observation:<path>     a file under the module
// A path must stay inside its base folder (no absolute path, `..` out of it, drive or stream suffix). A path may carry
// a #fragment; only the file part must exist, except explore/network-inventory.json#NI-<m>-<n>,
// whose entry must exist too (D-052).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isAnswered } from "./clarifications.mjs";

export const CITATION_KINDS = ["clarification", "testcase", "knowledge", "spec", "observation"];
export const CITATION_PREFIXES = CITATION_KINDS.map((k) => `${k}:`);

// true when `file` (relative) names something strictly inside `base`.
function inside(base, file) {
  if (!file || path.isAbsolute(file) || /^[a-z]:/i.test(file) || file.includes(":") || /^[\\/]/.test(file)) return false;
  const rel = path.relative(path.resolve(base), path.resolve(base, file));
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// ctx: {rows (clarifications.csv rows), cases (Map or Set of test case ids), productDir, moduleDir, apiDir?}
// -> null when the citation holds, else why not.
export function citationProblem(c, ctx) {
  const [kind, ...restParts] = String(c).split(":");
  const ref = restParts.join(":");
  const file = ref.split("#")[0];
  if (kind === "clarification") {
    const row = ctx.rows.find((r) => r.id.trim() === ref);
    if (!row) return `'${c}': no such row in clarifications.csv`;
    return isAnswered(row) ? null : `'${c}': the row is not answered yet`;
  }
  if (kind === "testcase") return ctx.cases.has(ref) ? null : `'${c}': no such test case`;
  // A path citation stays inside its base folder: no absolute path, no `..` out of it, no drive or stream prefix.
  const bases = { knowledge: ["knowledge/", path.join(ctx.productDir, "knowledge")], spec: ["api/", ctx.apiDir ?? path.join(ctx.moduleDir, "api")], observation: ["the module", ctx.moduleDir] };
  if (bases[kind] && !inside(bases[kind][1], file)) return `'${c}': the path must stay inside ${bases[kind][0]}`;
  if (kind === "knowledge") return existsSync(path.join(ctx.productDir, "knowledge", file)) ? null : `'${c}': no such file under knowledge/`;
  if (kind === "spec") return existsSync(path.join(ctx.apiDir ?? path.join(ctx.moduleDir, "api"), file)) ? null : `'${c}': no such file under api/`;
  if (kind === "observation") {
    const abs = path.join(ctx.moduleDir, file);
    if (!existsSync(abs)) return `'${c}': no such file under the module`;
    // A network-inventory entry is cited by its stable NI id (D-052), which must exist; the older #/<index> form
    // only needs the file.
    const frag = ref.split("#")[1] ?? "";
    if (/^NI-/.test(frag) && path.basename(file) === "network-inventory.json") {
      let inv;
      try {
        inv = JSON.parse(readFileSync(abs, "utf8"));
      } catch {
        return `'${c}': ${file} is not valid JSON`;
      }
      if (!Array.isArray(inv) || !inv.some((e) => e?.id === frag)) return `'${c}': no entry ${frag} in ${file}`;
    }
    return null;
  }
  return `'${c}': a citation is clarification:<id>, testcase:<id>, knowledge:<path>, spec:<path> or observation:<path>`;
}
