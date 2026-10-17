// Citations in an agent's overlay (docs/conventions.md "Script-built agents", D-049). A citation is checked against
// the module's own files, never taken on trust:
//   clarification:<id>     a row of clarifications.csv that is answered
//   testcase:<TC id>       a test case of the module
//   knowledge:<path>       a file under the product's knowledge/
//   spec:<path>            a file under the module's api/
//   observation:<path>     a file under the module
// A path may carry a #fragment; only the file part must exist.
import { existsSync } from "node:fs";
import path from "node:path";
import { isAnswered } from "./clarifications.mjs";

export const CITATION_KINDS = ["clarification", "testcase", "knowledge", "spec", "observation"];
export const CITATION_PREFIXES = CITATION_KINDS.map((k) => `${k}:`);

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
  if (kind === "knowledge") return existsSync(path.join(ctx.productDir, "knowledge", file)) ? null : `'${c}': no such file under knowledge/`;
  if (kind === "spec") return existsSync(path.join(ctx.apiDir ?? path.join(ctx.moduleDir, "api"), file)) ? null : `'${c}': no such file under api/`;
  if (kind === "observation") return existsSync(path.join(ctx.moduleDir, file)) ? null : `'${c}': no such file under the module`;
  return `'${c}': a citation is clarification:<id>, testcase:<id>, knowledge:<path>, spec:<path> or observation:<path>`;
}
