// `atf init [dir]` (docs/packaging.md §3.3, §3.6, §3.7: drafts P-3 and P-6): a client's test workspace, created from
// the package's templates/workspace/. The CLI (scripts/lib/cli.mjs) plans it and runs it; this file holds what is
// specific to it.
//
// It never overwrites. initPlan() only reads: for each file, what to create, what to add to a file the client already
// has, and what to leave alone. applyInit() writes exactly that, and refuses a file that changed since it was read, so a
// re-run on an existing workspace is safe and reports every file as present. A file the plan can't read safely (a
// package.json that isn't a JSON object, a malformed init block in .gitignore, an atf/atf.json the decision hook
// can't read, with a "cloud_agent" that isn't a boolean or a "contract" that isn't a whole number) stops the whole init
// before anything is written.
//
// The committed files (AGENTS.md, atf/decisions.md, config/README.md, .vscode/settings.json) name the framework as
// node_modules/<package>, where npm installs it, whatever runs init: the package from npx's cache, a copy already
// installed here (under pnpm its real path is in node_modules/.pnpm, which differs per machine and version) or a source
// checkout. The host files sync renders use the real path (roots.mjs frameworkRel), and are git-ignored.
//
// What each file is:
//   package.json           private, named after the folder; the package pinned to the running version and its peer
//                          dependencies (playwright) at their pinned versions, as devDependencies. An existing one
//                          gains only the missing ones; an existing version is never changed (the doctor reports a
//                          peer at another version).
//   .npmrc                 the private registry template, commented out (see templates/workspace/_npmrc for why)
//   .gitignore             run output and secrets, in a marked block init alone writes (apart from sync's block):
//                          missing lines are added inside it, the client's lines are never touched
//   atf/atf.json           the workspace marker, with the artifact-contract version the workspace starts on
//                          (`{ "contract": 2 }`, contract.mjs CONTRACT_VERSION; docs/packaging.md §3.10). An existing
//                          marker is left as it is: without "contract" it counts as 2, today's layout
//   the decision log       atf/decisions.md (or what atf.json "decisions" names), the empty log, with its rules
//   AGENTS.md              the committed brief every host reads at session start (§3.6)
//   config/README.md       only when config/ doesn't exist yet: how to create a run-config
//   .vscode/settings.json  VS Code's chat settings the hosts need (agent and hook locations, nested subagents,
//                          AGENTS.md); sync never writes it, so a client edits and commits it like any settings file
//   .github/workflows/copilot-setup-steps.yml
//                          only when an existing atf/atf.json has "cloud_agent": true: the Copilot cloud agent's
//                          setup steps, the client's from then on (sync.mjs)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONTRACT_VERSION, workspaceContract } from "./contract.mjs";
import { decisionsFile } from "./decisions.mjs";
import { FW_TOKEN, WORKSPACE_MARKER, expandFw, findWorkspace, isInstalled, isWithin } from "./roots.mjs";
import { SETUP_TEMPLATE, SETUP_WORKFLOW, TOKEN_ENV, cloudAgent } from "./sync.mjs";

export const TEMPLATES = ["templates", "workspace"];
// The client's run output and secrets: what this workspace's tools write that must never reach git. Patterns without a
// leading `/` match at any depth (a product's playwright-tests/<p>/.auth/ too); the Playwright and k6 folders also get
// their own rendered .gitignore, so this is the floor before they exist and for anything run from the workspace root.
// k6-tests/<p>/results/ is left to its own .gitignore, which keeps a .gitkeep there.
export const CLIENT_GITIGNORE = [
  "node_modules/",
  "/artifacts/",
  ".env",
  ".env.*",
  "!.env.example",
  "!.env.*.example",
  ".auth/",
  "auth.json",
  "test-results/",
  "playwright-report/",
  "blob-report/",
  "atf-issues-*.zip",
  "/config/interview-answers.json",
  "*.log",
  ".DS_Store",
];
export const INIT_BLOCK_START = "# >>> atf init: run output and secrets, kept out of git. npx atf init adds what is missing here; your own lines go outside it.";
export const INIT_BLOCK_END = "# <<< atf init";
const isStart = (line) => line.trim().startsWith("# >>> atf init");
const isEnd = (line) => line.trim() === INIT_BLOCK_END;

// An npm package name from a folder name: lowercase, URL-safe, not starting with `.` or `_`, at most 214 characters.
export function packageName(dir) {
  const name = path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^[._~-]+/, "").replace(/-+$/, "").slice(0, 214);
  return !name || ["node_modules", "favicon.ico"].includes(name) ? "atf-tests" : name;
}

// The devDependencies a workspace needs: the package at the running version, and its peers at their pinned versions.
export function wantedDeps(fwPkg) {
  return { [fwPkg.name]: fwPkg.version, ...fwPkg.peerDependencies };
}

const indentOf = (text) => /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";
const json = (value, indent = "  ", eol = "\n") => JSON.stringify(value, null, indent).replaceAll("\n", eol) + eol;

// An existing package.json -> { text?: the new text when deps were added, added: [[name, spec]], kept: [[name, have,
// want]] (present at another version, left as it is) } | { error }. Its indentation and line ending are kept.
export function withDeps(text, wanted) {
  let pkg;
  try {
    pkg = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    return { error: `package.json is not valid JSON (${e.message}); fix it, then run atf init again` };
  }
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return { error: "package.json must hold a JSON object; fix it, then run atf init again" };
  for (const k of ["dependencies", "devDependencies"])
    if (pkg[k] !== undefined && (!pkg[k] || typeof pkg[k] !== "object" || Array.isArray(pkg[k]))) return { error: `package.json "${k}" must be an object; fix it, then run atf init again` };
  const have = { ...pkg.devDependencies, ...pkg.dependencies };
  const added = Object.entries(wanted).filter(([name]) => !Object.hasOwn(have, name));
  const kept = Object.entries(wanted).filter(([name, spec]) => Object.hasOwn(have, name) && have[name] !== spec).map(([name, spec]) => [name, have[name], spec]);
  if (!added.length) return { added, kept };
  pkg.devDependencies = { ...pkg.devDependencies, ...Object.fromEntries(added) };
  return { text: json(pkg, indentOf(text), text.includes("\r\n") ? "\r\n" : "\n"), added, kept };
}

// .gitignore text -> { text?: the new text when lines were added, added: [lines] } | { error }. A pattern already
// anywhere in the file counts as present; a negation (`!x`) counts only inside the block, since git lets the last
// matching line win and it must come after the block's own patterns. The file's line ending is kept.
export function withInitBlock(text, entries = CLIENT_GITIGNORE) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (isStart(l) ? [i] : []));
  const ends = lines.flatMap((l, i) => (isEnd(l) ? [i] : []));
  if (starts.length > 1 || ends.length > 1 || starts.length !== ends.length || ends[0] < starts[0])
    return { error: `.gitignore: the atf init block is malformed (expected one '# >>> atf init' line, then one '${INIT_BLOCK_END}' line); fix its marker lines, then run atf init again` };
  const block = new Set(starts.length ? lines.slice(starts[0] + 1, ends[0]).map((l) => l.trim()) : []);
  const anywhere = new Set(lines.map((l) => l.trim()));
  const added = entries.filter((e) => !(e.startsWith("!") ? block : anywhere).has(e));
  if (!added.length) return { added };
  if (starts.length) {
    lines.splice(ends[0], 0, ...added);
    return { text: lines.join(eol), added };
  }
  const body = text === "" ? "" : `${text.endsWith(eol) ? text : text + eol}${eol}`;
  return { text: body + [INIT_BLOCK_START, ...added, INIT_BLOCK_END].join(eol) + eol, added };
}

// Why init can't create a workspace in `dir`, or null.
export function initRefusal(dir, framework) {
  if (existsSync(dir) && !statSync(dir).isDirectory()) return `atf init: ${dir} is a file, not a folder`;
  if (isWithin(dir, framework)) return `atf init: ${dir} is inside the framework itself (${framework}); create the workspace in a folder of its own`;
  // A source checkout inside `dir` is the maintainers' own workspace (the monorepo), which links the package itself.
  if (!isInstalled(framework) && isWithin(framework, dir)) return `atf init: ${dir} holds the framework's source checkout (${framework}), whose workspace is the maintainers' own; create a client workspace in a folder of its own`;
  const outer = findWorkspace(path.dirname(path.resolve(dir)));
  if (outer) return `atf init: ${dir} is inside the atf workspace ${outer} (it has ${WORKSPACE_MARKER}), and a workspace can't hold another; use that one, or create this one outside it`;
  return null;
}

// Whether the framework running init is the one installed in `dir`'s own node_modules (`npx atf init` in a folder where
// the package is already installed), so the sync can run in process.
export const installedIn = (dir, framework) => isInstalled(framework) && isWithin(framework, path.join(dir, "node_modules"));

const read = (file) => readFileSync(file, "utf8");
// `{fw}` in a JSON string that is a VS Code regex (`"/^node {fw}\\/scripts\\/…/"`): regex-escaped, `/` escaped for the
// slash-delimited form, then JSON-escaped.
const fwInJsonRegex = (rel) => rel.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replaceAll("\\", "\\\\");

// -> { actions: [{ file, kind: "create"|"update"|"present", text?, before?, notes: [] }], errors, depsAdded, fwRel, name }.
// Reads only. `file` is workspace-relative with `/`.
export function initPlan({ dir, framework }) {
  const root = path.resolve(dir);
  const tpl = (f) => read(path.join(framework, ...TEMPLATES, f));
  const fwPkg = JSON.parse(read(path.join(framework, "package.json")));
  const fwRel = `node_modules/${fwPkg.name}`;
  const actions = [];
  const errors = [];
  const at = (f) => path.join(root, ...f.split("/"));
  const create = (file, text, notes = []) => actions.push(existsSync(at(file)) ? { file, kind: "present", notes: [] } : { file, kind: "create", text, notes });

  // package.json
  const wanted = wantedDeps(fwPkg);
  const listed = (deps) => deps.map(([n, v]) => `${n} ${v}`).join(", ");
  let depsAdded = false;
  if (!existsSync(at("package.json"))) {
    create("package.json", json({ name: packageName(root), private: true, devDependencies: wanted }), [`devDependencies ${listed(Object.entries(wanted))}`]);
    depsAdded = true;
  } else {
    const before = read(at("package.json"));
    const r = withDeps(before, wanted);
    if (r.error) errors.push(r.error);
    else {
      const notes = [...(r.added.length ? [`added devDependencies ${listed(r.added)}`] : []), ...r.kept.map(([n, have, want]) => `kept ${n} ${have} (the framework pins ${want}; the doctor checks what is installed)`)];
      actions.push(r.text === undefined ? { file: "package.json", kind: "present", notes } : { file: "package.json", kind: "update", before, text: r.text, notes });
      depsAdded = r.added.length > 0;
    }
  }

  create(".npmrc", tpl("_npmrc"), ["the registry template, commented out until you set your registry URL"]);

  // .gitignore
  const ignoreBefore = existsSync(at(".gitignore")) ? read(at(".gitignore")) : null;
  const ignore = withInitBlock(ignoreBefore ?? "");
  if (ignore.error) errors.push(ignore.error);
  else if (ignore.text === undefined) actions.push({ file: ".gitignore", kind: "present", notes: [] });
  else actions.push(ignoreBefore === null ? { file: ".gitignore", kind: "create", text: ignore.text, notes: [] } : { file: ".gitignore", kind: "update", before: ignoreBefore, text: ignore.text, notes: [`added ${ignore.added.join(" ")}`] });

  create(WORKSPACE_MARKER, json({ contract: CONTRACT_VERSION }), [`artifact contract ${CONTRACT_VERSION}`]);
  // the log the hook will read: atf.json's "decisions" when it already names one, else the default
  const log = existsSync(at(WORKSPACE_MARKER)) ? decisionsFile(root) : { file: "atf/decisions.md" };
  if (log.error) errors.push(`${log.error}; fix it, then run atf init again`);
  else create(log.file, expandFw(tpl("decisions.md"), fwRel), ["the workspace's decision log, empty"]);
  create("AGENTS.md", expandFw(tpl("AGENTS.md"), fwRel), ["the brief every host reads; commit it"]);
  if (existsSync(at("config"))) actions.push({ file: "config/", kind: "present", notes: [] });
  else create("config/README.md", expandFw(tpl("config-README.md"), fwRel), ["the run-configs' folder"]);
  const vscode = tpl("_vscode-settings.json").replaceAll(`${FW_TOKEN}\\\\/`, () => `${fwInJsonRegex(fwRel)}\\\\/`).replaceAll(FW_TOKEN, () => fwRel);
  create(".vscode/settings.json", vscode, ["VS Code's chat settings for the agents and the guard's hooks"]);
  // the Copilot cloud agent's setup steps, when an existing atf.json already opts in (a later opt-in gets it from the
  // next sync); the same marker error as the log's is reported once
  if (existsSync(at(WORKSPACE_MARKER))) {
    // an existing marker's contract is the doctor's to compare with this package (init's last step); only a value no
    // reader can use stops init. Its unreadable-marker error is the log's, reported once.
    const contract = workspaceContract(root);
    if (contract.error && !log.error) errors.push(`${contract.error}; fix it, then run atf init again`);
    const opt = cloudAgent(root);
    if (opt.error) {
      if (opt.error !== log.error) errors.push(`${opt.error}; fix it, then run atf init again`);
    } else if (opt.on) create(SETUP_WORKFLOW, read(path.join(framework, ...SETUP_TEMPLATE.split("/"))), [`the Copilot cloud agent's setup steps, yours from now on; merge it to the default branch and add the Agents secret ${TOKEN_ENV}`]);
  }
  return { actions, errors, depsAdded, fwRel, name: fwPkg.name };
}

// Writes what initPlan() decided, in `dir`. -> { code, lines } where lines report every file. Never overwrites: a file
// created meanwhile is left alone, and a file changed since the plan read it is not written (code 1).
export function applyInit({ dir, actions }) {
  const root = path.resolve(dir);
  const lines = [];
  const done = [];
  const say = (kind, a, extra = a.notes) => lines.push(`  ${kind.padEnd(8)} ${a.file}${extra.length ? `: ${extra.join("; ")}` : ""}`);
  for (const a of actions) {
    const file = path.join(root, ...a.file.split("/"));
    try {
      if (a.kind === "present") {
        say("present", a, a.notes.length ? a.notes : ["left as it is"]);
        continue;
      }
      if (a.kind === "update" && (!existsSync(file) || read(file) !== a.before)) throw new Error("it changed while atf init ran, so it was not written");
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, a.text, a.kind === "create" ? { flag: "wx" } : {});
      done.push(a.file);
      say(a.kind === "create" ? "created" : "updated", a);
    } catch (e) {
      if (e.code === "EEXIST") {
        say("present", a, ["appeared while atf init ran; left as it is"]);
        continue;
      }
      lines.push(`  FAILED   ${a.file}: ${e.message}`);
      const rest = actions.slice(actions.indexOf(a) + 1).filter((x) => x.kind !== "present").map((x) => x.file);
      lines.push(`atf init stopped: ${done.length ? `written: ${done.join(", ")}` : "nothing was written"}; not written: ${[a.file, ...rest].join(", ")}. Fix the error, then run atf init again (it never overwrites).`);
      return { code: 1, lines };
    }
  }
  return { code: 0, lines };
}

// The doctor's base group (Node.js, the framework's dependencies and its peers from the workspace, the host files),
// for a workspace that has no run-config yet: scripts/doctor.mjs needs one, and runChecks() is async while the CLI's
// run() is synchronous, so it runs in a child node on the framework installed in the workspace (argv: the workspace,
// the package name). Its exit code is the check's: 1 on a blocking problem.
export const DOCTOR_BASE_SCRIPT = `
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [workspace, name] = process.argv.slice(1);
const installed = path.join(workspace, "node_modules", ...name.split("/"));
if (!existsSync(path.join(installed, "scripts", "lib", "doctor.mjs"))) {
  console.error("Dependency check: " + name + " is not installed in " + workspace + "; run npm install there.");
  process.exit(1);
}
const framework = realpathSync(installed);
const at = (f) => pathToFileURL(path.join(framework, "scripts", f)).href;
const { runChecks, failures } = await import(at("lib/doctor.mjs"));
const { render } = await import(at("doctor.mjs"));
const checks = await runChecks({}, ["base"], { root: workspace, framework });
console.log(render(checks, { label: "the new workspace (Node.js, the framework's dependencies, the host files)", stages: [] }));
process.exitCode = failures(checks).length ? 1 : 0;
`;
