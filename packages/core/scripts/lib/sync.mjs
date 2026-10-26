// `atf sync` and `atf check` (docs/packaging.md §3.3, §3.6): the workspace's host files rendered from the framework
// it uses, through the agent build (scripts/build-agents.mjs build({ root: workspace, framework }): the framework's
// agent sources and the workspace's effective config, overlays and ejected files included, D-088).
//
// When the framework is installed (a client's workspace, roots.mjs isInstalled), the generated files are the
// package's output, not the client's work: sync also keeps them out of git with one marked block in the workspace's
// .gitignore, which it alone writes (lines outside the block are the client's and never touched). In a source checkout
// (the monorepo) they stay committed (D-018), so there is no block.
//
// What the block does NOT list, on purpose:
//   .claude/settings.json   sync owns only the framework's own entries in its `hooks` key (D-092); the client's own
//                           hooks and other settings live there too, so the client decides whether to commit it
//   .vscode/settings.json   the build does not write it at all: its chat settings are a hand-kept file (and later
//                           atf init's), never a sync output
//   the agent folders       .claude/agents/ and .github/agents/ also hold the client's own agents, which the build
//                           leaves alone (no GENERATED marker); git can't re-include a file under an ignored folder,
//                           so the block names the framework's agent files one by one instead
// The agent files follow the roster: the effective permissions.yaml's agents through each platform's output template
// (platforms.yaml), as the build derives them; an agent the package adds or drops changes the block on the next sync.
//
// The cloud-agent opt-in (packaging §3.6), atf/atf.json `"cloud_agent": true`: the Copilot cloud coding agent reads
// custom agents and hooks only as committed (.github/agents/*.agent.md, .github/hooks/*.json on the default branch),
// and never .mcp.json or .vscode/. So the opt-in commits everything the build writes under .github/ (the framework's
// Copilot agent files and .github/hooks/framework-guard.json): it filters the one list (ignoredEntries), never a second
// copy, and turning it off brings the whole block back. It also needs the package installed before the agent starts,
// or the committed guard hook has no script to run and denies every call: GitHub's copilot-setup-steps job does that,
// in .github/workflows/copilot-setup-steps.yml. Sync writes it from templates/workspace/ when it is missing (atf init
// does too), and never again: it is the client's, who may add steps. What sync can't fix it only reports (problems):
// a workflow without a job step that runs npm ci (or npm install) with ATF_NPM_TOKEN in its env. Sync warns; check and
// the doctor fail. Only in an installed workspace: a source checkout commits all of .github/ already (D-018).
//
// sync() checks everything before it writes anything: a malformed block, an unreadable .gitignore or atf.json, a bad
// "cloud_agent" or any build error (a bad overlay or fragment, a stray or missing source) leaves every file as it was
// (D-018).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { build } from "../build-agents.mjs";
import { loadConfig } from "./config.mjs";
import { WORKSPACE_MARKER, frameworkRel, isInstalled, readMarker } from "./roots.mjs";

// The other files the build writes whole, besides the agents: workspace-relative, `/`-separated, written into the block
// anchored at the workspace root. Never a folder (see above).
export const CLIENT_IGNORED = [
  ".mcp.json",
  ".vscode/mcp.json",
  ".github/hooks/framework-guard.json",
  ".vscode/hooks/framework-guard.json",
];
export const GITIGNORE = ".gitignore";
export const BLOCK_START = "# >>> atf sync: host files rendered from the installed @testagentic/atf. npx atf sync rewrites this block; edit outside it.";
export const BLOCK_END = "# <<< atf sync";
// what identifies the markers, whatever the rest of the start line says (a later wording still finds an old block)
const isStart = (line) => line.trim().startsWith("# >>> atf sync");
const isEnd = (line) => line.trim() === BLOCK_END;

// The framework's agent files in `workspace`, one per agent and platform: the build's own derivation (build-agents.mjs
// returns only what changed, not what it renders), from the same effective config, workspace overlays included.
// Throws what loadConfig throws (the build would report the same error).
export function generatedAgentFiles({ workspace, framework }) {
  const opts = { framework, workspace };
  const names = Object.keys(loadConfig("permissions.yaml", opts)?.agents ?? {});
  const platforms = Object.values(loadConfig("platforms.yaml", opts)?.platforms ?? {});
  return platforms.flatMap((p) => (typeof p?.output === "string" ? names.map((n) => p.output.replaceAll("{name}", n)) : []));
}

// Every whole file the build writes, sorted (code-unit order, the same on every OS and locale) so atf check is stable.
const hostEntries = (agentFiles) => [...new Set([...agentFiles, ...CLIENT_IGNORED])].sort();
// What the cloud agent reads from git: the build's files under .github/ (its Copilot agents, its hook registration).
const forCloudAgent = (entry) => entry.startsWith(".github/");
// Everything the block lists: all of it, or with the cloud-agent opt-in all but what the cloud agent reads.
export const ignoredEntries = (agentFiles, { cloudAgent = false } = {}) => hostEntries(agentFiles).filter((e) => !(cloudAgent && forCloudAgent(e)));
// With the opt-in, what the client commits for the cloud agent: those files and the setup workflow.
export const cloudAgentFiles = (agentFiles) => [...hostEntries(agentFiles).filter(forCloudAgent), SETUP_WORKFLOW];

// ---- the cloud-agent opt-in ----------------------------------------------------------------------------------------

export const CLOUD_AGENT_KEY = "cloud_agent";
export const SETUP_WORKFLOW = ".github/workflows/copilot-setup-steps.yml";
export const SETUP_TEMPLATE = "templates/workspace/copilot-setup-steps.yml";
export const SETUP_JOB = "copilot-setup-steps";
export const TOKEN_ENV = "ATF_NPM_TOKEN";

// atf.json's object (roots.mjs readMarker; null without one) -> { on } | { error }. Absent is off; anything but a
// boolean is refused, since a typo ("yes", "true") must not silently leave the cloud agent without its files.
export function cloudAgentOf(cfg) {
  const v = cfg?.[CLOUD_AGENT_KEY];
  if (v === undefined) return { on: false };
  if (typeof v !== "boolean") return { error: `${WORKSPACE_MARKER} "${CLOUD_AGENT_KEY}" must be true or false, not ${JSON.stringify(v)}` };
  return { on: v };
}
// The workspace's opt-in -> { on } | { error }
export function cloudAgent(workspace) {
  const m = readMarker(workspace);
  return m.error ? { error: m.error } : cloudAgentOf(m.cfg);
}

// The template, as a client finds it in their install.
export const setupTemplateRel = (workspace, framework) => [frameworkRel(workspace, framework), SETUP_TEMPLATE].filter(Boolean).join("/");

// What a client's setup workflow lacks, or null. Tolerant: any layout GitHub accepts, as long as the job
// `copilot-setup-steps` has a step whose `run` runs npm ci or npm install with ATF_NPM_TOKEN in its env (the step's, the
// job's or the workflow's). Read, never rewritten.
export function setupWorkflowProblem(text) {
  let doc;
  try {
    doc = yaml.load(text);
  } catch (e) {
    return `is not valid YAML (${e.message.split("\n")[0]})`;
  }
  const job = doc?.jobs?.[SETUP_JOB];
  if (!job || typeof job !== "object") return `has no job named ${SETUP_JOB}, the one GitHub runs before the cloud agent starts`;
  const installs = (Array.isArray(job.steps) ? job.steps : []).filter((s) => typeof s?.run === "string" && /\bnpm\s+(?:ci|install|i)\b/.test(s.run));
  if (!installs.length) return `has no step in its ${SETUP_JOB} job that runs npm ci (or npm install)`;
  const hasToken = (o) => o?.env && typeof o.env === "object" && Object.hasOwn(o.env, TOKEN_ENV);
  if (!installs.some((s) => [s, job, doc].some(hasToken))) return `runs npm ci (or npm install) without ${TOKEN_ENV} in its env, the registry token the committed .npmrc reads`;
  return null;
}

// The setup workflow in an opted-in workspace -> { create: the template's text } when missing | { problem: { detail,
// fix } } | {}. Throws on a file it can't read.
function setupWorkflow({ workspace, framework }) {
  const file = path.join(workspace, ...SETUP_WORKFLOW.split("/"));
  if (!existsSync(file)) return { create: readFileSync(path.join(framework, ...SETUP_TEMPLATE.split("/")), "utf8") };
  const problem = setupWorkflowProblem(readFileSync(file, "utf8"));
  if (!problem) return {};
  const fix = `add a step to the ${SETUP_JOB} job that runs npm ci with \`env: { ${TOKEN_ENV}: \${{ secrets.${TOKEN_ENV} }} }\` (the repository's Agents secret), as ${setupTemplateRel(workspace, framework)} does; atf never rewrites this file`;
  return { problem: { detail: `${SETUP_WORKFLOW} ${problem}: without the framework installed, the cloud agent's guard denies every tool call`, fix } };
}

// a literal path as a gitignore pattern: its glob characters escaped (agent names are plain today; the roster isn't ours
// to trust blindly once a workspace overlay can add to it)
const literal = (p) => p.replace(/[\\*?[]/g, "\\$&");
export const gitignoreBlock = (entries) => [BLOCK_START, ...entries.map((e) => `/${literal(e)}`), BLOCK_END];

// .gitignore text -> { text } with the block in place of the old one, or appended after a blank line; the file's own
// line ending (CRLF stays CRLF) and every line outside the block kept. -> { error } on a block it can't place safely.
export function withGitignoreBlock(text, entries) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const starts = lines.flatMap((l, i) => (isStart(l) ? [i] : []));
  const ends = lines.flatMap((l, i) => (isEnd(l) ? [i] : []));
  const block = gitignoreBlock(entries);
  if (!starts.length && !ends.length) {
    if (text === "") return { text: block.join(eol) + eol };
    const body = text.endsWith(eol) ? text : text + eol;
    return { text: body + eol + block.join(eol) + eol };
  }
  if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0])
    return { error: `the atf sync block is malformed (expected one '# >>> atf sync' line, then one '${BLOCK_END}' line); remove its marker lines and every line between them, then run npx atf sync` };
  lines.splice(starts[0], ends[0] - starts[0] + 1, ...block);
  return { text: lines.join(eol) };
}

// -> { errors, changed: [workspace-relative paths that differ (or would, with check)], created: [the setup workflow,
// written (or missing, with check)], problems: [{ detail, fix }] (what sync reports and never fixes), installed,
// cloudAgent, committed: [what the opt-in commits for the cloud agent] }
export function sync({ workspace, framework, check = false }) {
  const installed = isInstalled(framework);
  const result = { errors: [], changed: [], created: [], problems: [], installed, cloudAgent: false, committed: [] };
  const fail = (errors, changed = []) => ({ ...result, errors, changed });
  let ignore = null;
  let setup = {};
  if (installed) {
    const opt = cloudAgent(workspace);
    if (opt.error) return fail([opt.error]);
    result.cloudAgent = opt.on;
    const file = path.join(workspace, GITIGNORE);
    let current;
    try {
      current = existsSync(file) ? readFileSync(file, "utf8") : "";
    } catch (e) {
      return fail([`${GITIGNORE}: ${e.message}`]);
    }
    let agentFiles;
    try {
      agentFiles = generatedAgentFiles({ workspace, framework });
      if (opt.on) setup = setupWorkflow({ workspace, framework });
    } catch (e) {
      return fail([e.message]);
    }
    const next = withGitignoreBlock(current, ignoredEntries(agentFiles, { cloudAgent: opt.on }));
    if (next.error) return fail([`${GITIGNORE}: ${next.error}`]);
    if (next.text !== current) ignore = { file, text: next.text };
    if (opt.on) result.committed = cloudAgentFiles(agentFiles);
  }
  const r = build({ root: workspace, framework, check });
  if (r.errors.length) return fail(r.errors);
  const changed = [...r.changed];
  if (ignore) {
    changed.push(GITIGNORE);
    if (!check) {
      try {
        writeFileSync(ignore.file, ignore.text, "utf8");
      } catch (e) {
        return fail([`${GITIGNORE}: ${e.message} (the host files were written)`], r.changed);
      }
    }
  }
  if (setup.create !== undefined && !check) {
    const file = path.join(workspace, ...SETUP_WORKFLOW.split("/"));
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, setup.create, { encoding: "utf8", flag: "wx" }); // never over a file that appeared meanwhile
    } catch (e) {
      if (e.code !== "EEXIST") return fail([`${SETUP_WORKFLOW}: ${e.message} (the host files were written)`], changed);
      setup = {};
    }
  }
  return { ...result, changed, created: setup.create !== undefined ? [SETUP_WORKFLOW] : [], problems: setup.problem ? [setup.problem] : [] };
}
