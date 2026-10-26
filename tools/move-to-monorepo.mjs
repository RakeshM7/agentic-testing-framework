#!/usr/bin/env node
// Packaging phase 2a (docs/packaging.md §3.11, §4; D-086): moves the framework into packages/core and makes the repo
// root the maintainers' workspace. A one-time tool, run by a human from their own terminal, never by an agent session:
// it rewrites the hook registrations (.claude/settings.json and the others), and a running Claude Code or VS Code
// session keeps the hook path it read at start-up. Deleted in phase 2b.
//
//   node tools/move-to-monorepo.mjs [--dry-run]
//
// Steps, in order:
//   1. git mv the framework: scripts/, agents/, templates/, schemas/, the framework's config/ files and the docs that
//      agents and scripts read, into packages/core/
//   2. write the root package.json (npm workspaces), packages/core/package.json (@testagentic/atf) and atf/atf.json
//   3. docs/decisions.md: prefix every moved Affects path with packages/core/ (nothing else in an entry changes), mark
//      D-085 superseded by D-086 and append D-086 (tools/D-086.md) with its index row
//   4. the root-relative paths only the move can fix: .gitattributes, .vscode/settings.json, the Makefile, the copilot
//      setup steps, the briefs (AGENTS.md, README.md, architecture.md), the decision log's rules and the doc links
//   5. npm install                     (links node_modules/@testagentic/atf -> packages/core, updates the lock)
//   6. node packages/core/scripts/build-agents.mjs   (the host files' hook and MCP commands now name packages/core)
//   7. npm run check
// It refuses to start while a run is active (any artifacts/**/state/lock.json), when the working tree has changes
// other than its own inputs (commit first), or when the framework has already moved. --dry-run prints every step and
// changes nothing. It never runs a destructive git command: when a step fails it says where it stopped and how to go
// back. Node APIs only; git and npm are spawned with argument arrays, on macOS, Windows and Linux.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "packages/core";
const DRY = process.argv.includes("--dry-run");
const SELF = ["tools/move-to-monorepo.mjs", "tools/D-086.md"];
const DECISIONS = "docs/decisions.md";
const MOVED_DIRS = ["scripts", "agents", "templates", "schemas"];
const MOVED_FILES = [
  ...["permissions", "models", "platforms", "mcp", "hooks", "run-config.example"].map((n) => `config/${n}.yaml`),
  ...["agent-handoffs", "playwright-conventions", "k6-conventions", "conventions", "artifact-contract", "platforms"].map((n) => `docs/${n}.md`),
];
const MOVED = [...MOVED_DIRS, ...MOVED_FILES];
// Root files whose framework paths are written from the repo root (`node scripts/run.mjs`, `docs/platforms.md`): their
// moved paths get the packages/core/ prefix. The decision log's entries are excluded: only their Affects change (step 3).
const ROOT_TEXT = ["AGENTS.md", "README.md", "architecture.md", "docs/agent-architecture.md", "Makefile", ".gitattributes", ".github/workflows/copilot-setup-steps.yml"];
const PLAYWRIGHT_FALLBACK = "1.64.1";

const rel = (...p) => path.join(ROOT, ...p);
const slash = (p) => p.replaceAll("\\", "/");
const read = (f) => readFileSync(rel(f), "utf8");
const say = (s = "") => process.stdout.write(`${s}\n`);
const steps = [];
const step = (name, run) => steps.push({ name, run });

// ---- spawning git and npm with argument arrays -------------------------------------------------------------------

// npm's own entry script, run with this node: no shell, so the arguments reach npm as written on every OS (Windows
// can't spawn npm.cmd without a shell). Falls back to npm on PATH (npm.cmd through cmd.exe on Windows; the arguments
// here are fixed words, never user input).
function npmCommand() {
  const dir = path.dirname(process.execPath);
  const candidates = [process.env.npm_execpath, path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"), path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")];
  const cli = candidates.find((c) => c && /npm-cli\.js$/.test(c) && existsSync(c));
  if (cli) return { cmd: process.execPath, pre: [cli], shell: false };
  return process.platform === "win32" ? { cmd: "npm.cmd", pre: [], shell: true } : { cmd: "npm", pre: [], shell: false };
}

function run(cmd, args, { capture = false, shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
  if (r.error) throw new Error(`${cmd} ${args.join(" ")}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${[cmd, ...args].join(" ")} exited with ${r.status}${capture ? `\n${r.stderr || r.stdout}` : ""}`);
  return r.stdout ?? "";
}
const git = (args, opts) => run("git", args, opts);
function npm(args) {
  const { cmd, pre, shell } = npmCommand();
  return run(cmd, [...pre, ...args], { shell });
}

// ---- the checks before anything changes --------------------------------------------------------------------------

// Every artifacts/**/state/lock.json: an active run, in any product or environment.
function locks(dir = rel("artifacts"), out = []) {
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) locks(p, out);
    else if (d.name === "lock.json" && path.basename(dir) === "state") out.push(slash(path.relative(ROOT, p)));
  }
  return out;
}

const alreadyMoved = () => existsSync(rel(CORE, "scripts")) || !existsSync(rel("scripts", "lib", "guard.mjs"));

// -> [reason] that stop the move
function refusals() {
  const out = [];
  for (const f of SELF) if (!existsSync(rel(f))) out.push(`${f} is missing: it is one of this script's inputs`);
  const held = locks();
  if (held.length) out.push(`a run is active (${held.join(", ")}): end it first (node scripts/run.mjs end <product>), then run this again`);
  let status = "";
  try {
    status = git(["status", "--porcelain=v1", "--untracked-files=all"], { capture: true });
  } catch (e) {
    out.push(`git status failed (${e.message.split("\n")[0]}): run this from a git checkout of the framework`);
  }
  const changed = [];
  const untracked = [];
  for (const line of status.split("\n").filter(Boolean)) {
    const file = slash(line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop());
    if (line.startsWith("??")) untracked.push(file);
    else changed.push(file);
  }
  // A tracked change would be mixed into the move; an untracked file inside a moved folder would be carried along
  // with it. Untracked files elsewhere (an editor's or another tool's folder) are left alone.
  const touched = (f) => MOVED.some((m) => f === m || f.startsWith(`${m}/`)) || [CORE, "atf", "package.json", "package-lock.json", DECISIONS, ...ROOT_TEXT, ".vscode/settings.json"].some((m) => f === m || f.startsWith(`${m}/`));
  const stray = untracked.filter((f) => !SELF.includes(f) && touched(f));
  if (changed.length || stray.length)
    out.push(`the working tree has changes: ${[...changed, ...stray].slice(0, 12).join(", ")}${changed.length + stray.length > 12 ? ", ..." : ""}. Commit them first (git add -A && git commit), then run this again`);
  const others = untracked.filter((f) => !SELF.includes(f) && !touched(f));
  if (others.length) say(`note: untracked files outside the move are left alone: ${[...new Set(others.map((f) => f.split("/")[0]))].join(", ")}`);
  return out;
}

// ---- step 1: git mv ---------------------------------------------------------------------------------------------

step(`git mv the framework into ${CORE}/`, () => {
  for (const from of MOVED) {
    const to = `${CORE}/${from}`;
    say(`  git mv ${from} ${to}`);
    if (DRY) continue;
    mkdirSync(path.dirname(rel(to)), { recursive: true });
    git(["mv", from, to]);
  }
  // the run-configs' folder stays the workspace's: kept in git even while it holds none
  say("  config/.gitkeep (the workspace's run-configs folder)");
  if (!DRY) {
    mkdirSync(rel("config"), { recursive: true });
    if (!existsSync(rel("config", ".gitkeep"))) writeFileSync(rel("config", ".gitkeep"), "");
  }
});

// ---- step 2: package files and the workspace marker -------------------------------------------------------------

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;
function packages() {
  const root = JSON.parse(read("package.json"));
  const playwright = root.devDependencies?.playwright ?? PLAYWRIGHT_FALLBACK;
  const core = {
    name: "@testagentic/atf",
    version: "0.0.0",
    private: true,
    license: "UNLICENSED",
    type: "module",
    description: "The agentic testing framework: scripts (run state, contracts, guard, agent builder), agent sources, default config, templates, schemas and the agent-facing docs.",
    scripts: { test: 'node --test "scripts/**/*.test.mjs"' },
    dependencies: root.dependencies ?? {},
    peerDependencies: { playwright },
  };
  const ws = {
    name: root.name,
    private: true,
    type: "module",
    description: "The maintainers' workspace: the framework is packages/core (@testagentic/atf), linked by npm workspaces like a client install. Generated test projects (playwright-tests/, k6-tests/) keep their own dependency trees.",
    workspaces: ["packages/*"],
    scripts: {
      check: `node ${CORE}/scripts/build-agents.mjs --check && npm test`,
      test: `node --test "${CORE}/scripts/**/*.test.mjs"`,
      "build-agents": `node ${CORE}/scripts/build-agents.mjs`,
    },
    devDependencies: { ...root.devDependencies, playwright },
  };
  return { ws, core };
}

step("write package.json (npm workspaces), packages/core/package.json and atf/atf.json", () => {
  const { ws, core } = packages();
  say(`  package.json: workspaces ${JSON.stringify(ws.workspaces)}, scripts -> ${CORE}/scripts, devDependencies ${JSON.stringify(ws.devDependencies)}`);
  say(`  ${CORE}/package.json: ${core.name}, private, ${core.license}, dependencies ${JSON.stringify(core.dependencies)}, peerDependencies ${JSON.stringify(core.peerDependencies)}, no bin`);
  say("  atf/atf.json: the workspace marker (scripts/lib/roots.mjs)");
  if (DRY) return;
  writeFileSync(rel("package.json"), json(ws));
  writeFileSync(rel(CORE, "package.json"), json(core));
  mkdirSync(rel("atf"), { recursive: true });
  writeFileSync(rel("atf", "atf.json"), "{}\n");
});

// ---- step 3: the decision log ------------------------------------------------------------------------------------

const movedPath = (p) => MOVED_DIRS.some((d) => p === d || p.startsWith(`${d}/`)) || MOVED_FILES.includes(p);

// -> the new log text and what changed
export function rerootDecisions(text, d086) {
  const counts = { affects: 0, entries: new Set() };
  let out = text.replace(/^(### (D-\d{3}) · [^\n]*\n[\s\S]*?)(?=^### D-\d{3} · |(?![\s\S]))/gm, (entry, _body, id) =>
    entry.replace(/^- \*\*Affects:\*\* .+$/m, (line) =>
      line.replace(/`([^`]+)`/g, (m, p) => {
        if (!movedPath(p)) return m;
        counts.affects++;
        counts.entries.add(id);
        return `\`${CORE}/${p}\``;
      })));
  // the rules above the index name the framework's commands and files from the repo root, like the briefs
  const index = out.indexOf("\n## Index");
  out = rerootText(out.slice(0, index)) + out.slice(index);
  // D-086 supersedes D-085's read-only bullet (the log's precedent: the old entry's Status, then the new entry)
  const supersede = "Superseded by D-086 (2026-10-26)";
  out = out.replace(/^(### D-085 · [^\n]*\n- \*\*Status:\*\* )Accepted /m, `$1${supersede} `);
  out = out.replace(/^(\| D-085 \| [^|]+ \| )Accepted( \| [^|]+ \|)$/m, "$1Superseded by D-086$2");
  const head = /^### (D-086) · (.+)$/m.exec(d086);
  if (!head) throw new Error("tools/D-086.md does not start with a `### D-086 · <title>` heading");
  const date = /\*\*Date:\*\* (\d{4}-\d{2}-\d{2})/.exec(d086)?.[1];
  // the index row after D-085's, the entry at the end
  out = out.replace(/^(\| D-085 \| .+\|)$/m, `$1\n| D-086 | ${head[2]} | Accepted | ${date} |`);
  out = `${out.replace(/\s*$/, "")}\n\n${d086.replace(/\s*$/, "")}\n`;
  return { text: out, affects: counts.affects, entries: counts.entries.size };
}

step(`${DECISIONS}: re-root the moved Affects paths with ${CORE}/, mark D-085 superseded, append D-086`, () => {
  const before = read(DECISIONS);
  const r = rerootDecisions(before, read("tools/D-086.md"));
  if (!/^\| D-086 \|/m.test(r.text) || !/^### D-085 · [^\n]*\n- \*\*Status:\*\* Superseded by D-086/m.test(r.text))
    throw new Error(`${DECISIONS}: D-085's entry or index row is not where this script expects it; nothing was written`);
  say(`  ${r.affects} Affects paths in ${r.entries} entries get the ${CORE}/ prefix; D-085: Superseded by D-086 (2026-10-26); D-086 and its index row appended`);
  if (!DRY) writeFileSync(rel(DECISIONS), r.text);
});

// ---- step 4: root-relative paths ---------------------------------------------------------------------------------

// A moved path written from the repo root, as a word of its own (`scripts/`, `node scripts/x.mjs`, `docs/platforms.md`,
// `config/permissions.yaml`), never inside a longer path (`.claude/agents/`, `k6-tests/<p>/scripts/`).
const TOKEN = new RegExp(
  String.raw`(?<![\w./@~$-])((?:${MOVED_DIRS.join("|")})/|(?:${MOVED_FILES.map((f) => f.replace(/[.]/g, "\\.")).join("|")})(?![\w-]))`,
  "g",
);
// A line that draws a generated test project's tree (`k6-tests/<product>/   # lib/, scripts/, results/`) is left alone.
export const rerootText = (text) =>
  text
    .split("\n")
    .map((line) => (/^\s*(?:k6-tests|playwright-tests)\//.test(line) ? line : line.replace(TOKEN, `${CORE}/$1`)))
    .join("\n");

// Where `config/` alone means the framework's default config, or a layout row names both: exact edits after the
// rewrite above. One that no longer matches is reported, never guessed.
const SPECIAL = [
  ["AGENTS.md", "generates the platform files from those sources and `config/`:", `generates the platform files from those sources and \`${CORE}/config/\`:`],
  [".gitattributes", `from ${CORE}/agents/ and config/ --`, `from ${CORE}/agents/ and ${CORE}/config/ --`],
  ["README.md", `from ${CORE}/agents/ and config/`, `from ${CORE}/agents/ and ${CORE}/config/`],
  ["README.md",
    "| `config/` | run-config example, `permissions.yaml`, `models.yaml`, `platforms.yaml`, `mcp.yaml`; your `<product>.yaml` run-configs (and the git-ignored `interview-answers.json` the interview leaves) |\n| `docs/` | architecture, contract, conventions |",
    `| \`${CORE}/config/\` | run-config example, \`permissions.yaml\`, \`models.yaml\`, \`platforms.yaml\`, \`mcp.yaml\`, \`hooks.yaml\` |\n| \`config/\` | your \`<product>.yaml\` run-configs (and the git-ignored \`interview-answers.json\` the interview leaves) |\n| \`${CORE}/docs/\` | contract, hand-offs, conventions, platforms |\n| \`docs/\` | decisions, architecture, packaging |\n| \`atf/atf.json\` | marks the repo root as the workspace (the framework is \`${CORE}\`, \`@testagentic/atf\`) |`],
  ["architecture.md", "generated from it and `config/` (", `generated from it and \`${CORE}/config/\` (`],
  ["architecture.md", `SRC[${CORE}/agents/ + config/]`, `SRC[${CORE}/agents/ + ${CORE}/config/]`],
];

// Markdown links relative to a file that moved, or to a file that moved away from one: re-pointed to where the target
// now is. `files`: [{ old, now }] repo-relative paths before and after the move.
const mapPath = (p) => (movedPath(p) ? `${CORE}/${p}` : p);
export function relinkMarkdown(text, oldFile, newFile) {
  return text.replace(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g, (m, target, anchor = "") => {
    if (/^[a-z][a-z0-9+.-]*:|^\//i.test(target)) return m; // a URL or an absolute path
    const was = path.posix.normalize(path.posix.join(path.posix.dirname(oldFile), target));
    if (was.startsWith("..")) return m;
    const now = mapPath(was.replace(/\/$/, "")) + (target.endsWith("/") ? "/" : "");
    let link = path.posix.relative(path.posix.dirname(newFile), now) || ".";
    if (target.endsWith("/") && !link.endsWith("/")) link += "/";
    return link === target ? m : `](${link}${anchor})`;
  });
}

function markdownFiles() {
  const list = (dir) => (existsSync(rel(dir)) ? readdirSync(rel(dir)).filter((f) => f.endsWith(".md")).map((f) => (dir === "." ? f : `${dir}/${f}`)) : []);
  // after step 1 (or, in a dry run, before it): the root's and docs/' own, and the moved docs at their new place
  const moved = MOVED_FILES.filter((f) => f.endsWith(".md"));
  const here = [...list("."), ...list("docs")].filter((f) => !moved.includes(f));
  return [...here.map((f) => ({ old: f, now: f })), ...moved.map((f) => ({ old: f, now: `${CORE}/${f}` }))];
}

const VSCODE = ".vscode/settings.json";
const VSCODE_FROM = String.raw`"/^node scripts\\/[a-z-]+\\.mjs /": true`;
const VSCODE_TO = String.raw`"/^node packages\\/core\\/scripts\\/[a-z-]+\\.mjs /": true`;

step("fix the root-relative paths only the move can fix", () => {
  const edits = new Map(); // file -> new text
  const at = (f) => (DRY && f.startsWith(`${CORE}/`) ? f.slice(CORE.length + 1) : f); // a dry run reads the old place
  for (const f of ROOT_TEXT) if (existsSync(rel(f))) edits.set(f, rerootText(read(f)));
  for (const [f, from, to] of SPECIAL) {
    const t = edits.get(f);
    if (t?.includes(from)) edits.set(f, t.replace(from, () => to));
    else say(`  note: ${f} no longer has "${from.split("\n")[0].slice(0, 60)}..."; left as it is`);
  }
  if (existsSync(rel(VSCODE))) {
    const t = read(VSCODE);
    if (!t.includes(VSCODE_FROM) && !t.includes(VSCODE_TO)) throw new Error(`${VSCODE}: its auto-approve rule for node scripts is not where this script expects it`);
    edits.set(VSCODE, t.replace(VSCODE_FROM, VSCODE_TO));
  }
  for (const { old, now } of markdownFiles()) {
    const t = edits.get(now) ?? read(at(now));
    edits.set(now, relinkMarkdown(t, old, now));
  }
  for (const [f, t] of edits) {
    const before = read(at(f));
    if (t === before) continue;
    const old = new Set(before.split("\n"));
    say(`  ${f}: ${t.split("\n").filter((l) => !old.has(l)).length} line(s) changed or added`);
    if (!DRY) writeFileSync(rel(f), t);
  }
});

// ---- steps 5 to 7: install, rebuild, check ----------------------------------------------------------------------

step("npm install (links node_modules/@testagentic/atf to packages/core and updates package-lock.json)", () => {
  say(`  ${npmCommand().cmd === process.execPath ? "node <npm-cli.js>" : npmCommand().cmd} install`);
  if (!DRY) npm(["install", "--no-audit", "--no-fund"]);
});

step(`rebuild the host files: node ${CORE}/scripts/build-agents.mjs`, () => {
  say("  .claude/settings.json (hooks), .github/hooks, .vscode/hooks, .mcp.json, .vscode/mcp.json and every agent file now name packages/core");
  if (!DRY) run(process.execPath, [`${CORE}/scripts/build-agents.mjs`]);
});

step("npm run check", () => {
  if (!DRY) npm(["run", "check"]);
});

// ---- the run ---------------------------------------------------------------------------------------------------

function recovery(head, done) {
  const lines = [
    "Nothing was committed. To look at what changed: git status",
    `To keep the partial result aside: git stash --include-untracked`,
    `To go back to where you started (this discards every change since ${head.slice(0, 12)}):`,
    `  git reset --hard ${head}`,
  ];
  lines.push(`  then remove what the reset leaves of this script's folders: ${CORE}/ (only untracked files are left there, such as a moved scripts/node_modules), atf/ and config/.gitkeep`);
  if (done >= 4) lines.push("  then npm install, to restore node_modules for the old layout");
  return lines;
}

function main() {
  say(`${DRY ? "DRY RUN: nothing is changed. " : ""}Moving the framework into ${CORE}/ (docs/packaging.md, phase 2a) in ${ROOT}`);
  if (alreadyMoved()) {
    say(`refused: already moved (${CORE}/scripts exists, or scripts/lib/guard.mjs is gone). Nothing to do.`);
    process.exit(1);
  }
  const stop = refusals();
  if (stop.length) {
    for (const r of stop) say(`${DRY ? "would refuse" : "refused"}: ${r}`);
    if (!DRY) process.exit(1);
    say("(the plan below is what a run would do once these are resolved)");
  }
  let head = "";
  try {
    head = git(["rev-parse", "HEAD"], { capture: true }).trim();
  } catch {
    head = "<the commit you started from>";
  }
  for (const [i, s] of steps.entries()) {
    say(`\n${i + 1}/${steps.length} ${s.name}`);
    try {
      s.run();
    } catch (e) {
      say(`\nSTOPPED at step ${i + 1}/${steps.length} (${s.name}):\n${e.message}`);
      if (DRY) process.exit(1);
      if (i === steps.length - 1)
        say(`\nThe move itself is complete (steps 1 to ${i}); only the check failed. Read the failures above: a test that needs a live session or the network may fail here and pass in CI.`);
      for (const l of recovery(head, i)) say(l);
      process.exit(1);
    }
  }
  say(`\n${DRY ? "Dry run complete: nothing was changed." : "Done."}`);
  if (DRY) {
    if (stop.length) process.exit(1);
    return;
  }
  say(`- the framework is in ${CORE}/ (@testagentic/atf, linked at node_modules/@testagentic/atf); the repo root is the workspace (atf/atf.json)`);
  say(`- every hook command now runs node ${CORE}/scripts/hooks/...; docs/decisions.md has D-086`);
  say("- review with: git status (renames) and git diff, then commit the move");
  say("\nStart a NEW Claude Code / VS Code session now: this one's hooks still point at the old paths.");
}

const invoked = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};
if (process.argv[1] && invoked()) main();
