#!/usr/bin/env node
// The decision log, looked up instead of read whole (D-082). The log is the workspace's own (scripts/lib/decisions.mjs
// decisionsFile: atf/atf.json "decisions", else atf/decisions.md; docs/decisions.md in the monorepo). It is append-only
// and grows with every decision; before a change, an agent asks which Accepted decisions govern the files it will touch,
// reads those entries, and scans the index for any other that the change could contradict by meaning (a decision is not
// limited to the paths it lists).
//   decisions.mjs for <path...> [--full]   per path, the Accepted decisions whose Affects match it (the hook's own
//                                          matching, on the path from the workspace root); --full adds each matched
//                                          entry's text
//   decisions.mjs index                    every Accepted decision: id and title (and which file the log is)
//   decisions.mjs show <D-NNN...>          the full entries
// Output is JSON, except the entry texts (`--full`, `show`), which are the log's own Markdown.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceRoot } from "./lib/contract.mjs";
import { entryText, governing, loadDecisions } from "./lib/decisions.mjs";

// A path as the workspace names it, which is how every Affects path is written (the framework's files under its folder,
// `packages/core/scripts/run.mjs` in the monorepo): a relative path is read from the working directory when that is
// inside the workspace (`scripts/run.mjs` from packages/core), else from the workspace root.
const within = (root, p) => {
  const r = path.relative(root, p);
  return !r.startsWith("..") && !path.isAbsolute(r);
};
const rel = (root, p, cwd) => {
  const fromCwd = path.resolve(cwd, p);
  return path.relative(root, within(root, cwd) && within(root, fromCwd) ? fromCwd : path.resolve(root, p)).replaceAll("\\", "/");
};

// -> {code, out} with out an object (JSON) or a string (Markdown)
export function main(argv, { root = workspaceRoot, cwd = process.cwd() } = {}) {
  const [cmd, ...rest] = argv;
  const { decisions, error, file } = loadDecisions(root);
  if (error) return { code: 1, out: { errors: [error] } };
  const text = () => readFileSync(path.join(root, file), "utf8");
  // a missing log is not an error (it governs nothing), but say so: an agent should not read "no decisions" as "checked"
  const missing = existsSync(path.join(root, file)) ? {} : { warning: `${file} does not exist: no decision is recorded in this workspace` };
  if (cmd === "index") return { code: 0, out: { log: file, accepted: decisions.filter((d) => d.accepted).map(({ id, title }) => ({ id, title })), ...missing } };
  if (cmd === "show") {
    const ids = rest.filter((x) => /^D-\d{3}$/.test(x));
    if (!ids.length) return { code: 2, out: { errors: ["usage: decisions.mjs show <D-NNN...>"] } };
    const unknown = ids.filter((id) => !decisions.some((d) => d.id === id));
    if (unknown.length) return { code: 1, out: { errors: unknown.map((id) => `${id} is not in ${file}`) } };
    return { code: 0, out: ids.map((id) => entryText(text(), id)).join("\n\n") + "\n" };
  }
  if (cmd === "for") {
    const files = rest.filter((x) => x !== "--full");
    if (!files.length) return { code: 2, out: { errors: ["usage: decisions.mjs for <path...> [--full]"] } };
    const per = files.map((f) => rel(root, f, cwd)).map((p) => ({ path: p, decisions: governing(decisions, p).map(({ id, title }) => ({ id, title })) }));
    if (!rest.includes("--full")) return { code: 0, out: { log: file, files: per, note: "read these entries; then scan `decisions.mjs index` for any decision your change could contradict by meaning", ...missing } };
    const ids = [...new Set(per.flatMap((x) => x.decisions.map((d) => d.id)))].sort();
    return { code: 0, out: [`<!-- ${per.map((x) => `${x.path}: ${x.decisions.map((d) => d.id).join(", ") || "none"}`).join("; ")} -->`, ...ids.map((id) => entryText(text(), id))].join("\n\n") + "\n" };
  }
  return { code: 2, out: { errors: ["usage: decisions.mjs for <path...> [--full] | index | show <D-NNN...>"] } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, out } = main(process.argv.slice(2));
  process.stdout.write(typeof out === "string" ? out : JSON.stringify(out, null, 2) + "\n");
  process.exit(code);
}
