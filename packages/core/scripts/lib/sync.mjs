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
//   .agents/hooks.json      Antigravity's hook file, the same case: sync owns only its "atf-guard" hook set and keeps
//                           the client's other sets (lib/hook-registrations.mjs), so the client decides
//   .vscode/settings.json   the build does not write it at all: its chat settings are a hand-kept file (and later
//                           atf init's), never a sync output
//   the agent folders       .claude/agents/, .github/agents/ and .agents/agents/ also hold the client's own agents,
//                           which the build leaves alone (no GENERATED marker); git can't re-include a file under an
//                           ignored folder, so the block names the framework's agent files one by one instead
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
// The Claude Code plugin opt-in (packaging §3.12), atf/atf.json `"claude_plugin": true` with its "plugin_marketplace":
// the mode rule is lib/provenance.mjs claudeMode, and the build renders by it (build-agents.mjs). In plugin mode without
// a Claude-affecting customization the plugin supplies the Claude Code agents and MCP servers, so the block leaves out
// what the build no longer writes (.claude/agents/<name>.md, .mcp.json) and keeps the rest; with a customization it is
// the full block. sync reports the mode and why (claudeModeLine), naming the customization.
//
// A pinned Node.js (the friction plan's K2): hosts run the hook commands and the MCP servers with the `node` and `npx`
// their PATH finds first. When that node is older than MIN_NODE (Homebrew's node@18 ahead of nvm's 24), the guard
// refuses every call (D-109) and the browser server crashes. So, in a client's workspace only, sync finds the newest
// Node.js of MIN_NODE or later on the machine (node-version.mjs findNode) and renders it by its absolute path into the
// hook commands and the MCP servers (build-agents.mjs nodePin), recording it as "node": { path, version, pinnedAt } in
// atf/machine.json (node-version.mjs NODE_PIN_FILE): a machine-local file, listed in the block, so a team that commits
// atf/ never shares one machine's path; under atf/, so only a human (sync) writes it, since the framework's scripts
// run what it names when an agent starts them on an older Node (lib/node-gate.mjs). Its "node" goes with the pin, and
// the file with its last key. findNode prefers the workspace's .nvmrc major. Every sync decides again: a PATH node new
// enough removes the pin, and the commands are plain `node` again. "The PATH's node" is the first node in PATH, or, when bin/atf.mjs
// switched to a newer Node itself, the one it was started on (REEXEC_ENV). `atf check` and the doctor never decide:
// they render with the recorded pin, so a check from a terminal or session with another PATH reports no drift, and a
// recorded Node.js that is gone is an error. Never in a source checkout (its files are committed, D-018), and never in
// what the cloud-agent opt-in commits (.github/: GitHub's runner sets up its own Node).
//
// sync() checks everything before it writes anything: a malformed block, an unreadable .gitignore or atf.json, a bad
// "cloud_agent" or "claude_plugin" or any build error (a bad overlay or fragment, a stray or missing source) leaves every file as it was
// (D-018).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import yaml from "js-yaml";
import { build, pluginSupplies } from "../build-agents.mjs";
import { loadConfig } from "./config.mjs";
import { nodeWord } from "./hook-registrations.mjs";
import { mcpNodePin } from "./mcp.mjs";
import { MIN_NODE, NODE_PIN_FILE, NODE_PIN_KEY, REEXEC_ENV, findNode, installHint, nodeMajor, pathNode, probeNode, readLocalNode } from "./node-version.mjs";
import { CLAUDE_PLUGIN_KEY, PLUGIN, PLUGIN_ID, claudeAgentName, claudeMode } from "./provenance.mjs";
import { WORKSPACE_MARKER, frameworkRel, isInstalled, readMarker } from "./roots.mjs";

// The other files the build writes whole, besides the agents: workspace-relative, `/`-separated, written into the block
// anchored at the workspace root. Never a folder (see above). Never .agents/hooks.json either: like
// .claude/settings.json it is shared with the client's own hooks (see above).
export const CLIENT_IGNORED = [
  ".mcp.json",
  ".vscode/mcp.json",
  ".agents/mcp_config.json",
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

// What the Claude Code plugin supplies in place of the build, in plugin mode without a customization: the agent files
// and the MCP config file of the platform it stands in for (build-agents.mjs pluginSupplies), from the same config.
export function pluginSuppliedFiles({ workspace, framework }) {
  const opts = { framework, workspace };
  const names = Object.keys(loadConfig("permissions.yaml", opts)?.agents ?? {});
  const platforms = Object.values(loadConfig("platforms.yaml", opts)?.platforms ?? {}).filter(pluginSupplies);
  return platforms.flatMap((p) => [...(typeof p.output === "string" ? names.map((n) => p.output.replaceAll("{name}", n)) : []), ...(typeof p.mcp_config?.path === "string" ? [p.mcp_config.path] : [])]);
}

// Every whole file the build writes, sorted (code-unit order, the same on every OS and locale) so atf check is stable.
const hostEntries = (agentFiles) => [...new Set([...agentFiles, ...CLIENT_IGNORED])].sort();
// What the cloud agent reads from git: the build's files under .github/ (its Copilot agents, its hook registration).
const forCloudAgent = (entry) => entry.startsWith(".github/");
// Everything the block lists: all of it, or with the cloud-agent opt-in all but what the cloud agent reads; never what
// the plugin supplies (`supplied`, pluginSuppliedFiles in plugin mode), which the build doesn't write. And always the
// machine-local record of the pinned Node.js (NODE_PIN_FILE, see the header), whether or not there is one yet.
export const ignoredEntries = (agentFiles, { cloudAgent = false, supplied = [] } = {}) => {
  const skip = new Set(supplied);
  return [...hostEntries(agentFiles).filter((e) => !(cloudAgent && forCloudAgent(e)) && !skip.has(e)), NODE_PIN_FILE].sort();
};

// What sync says about the Claude Code plugin's mode (lib/provenance.mjs claudeMode), and why; null without the opt-in.
export function claudeModeLine(mode) {
  if (!mode?.on) return null;
  if (mode.agents === "plugin")
    return `Claude Code plugin mode (${WORKSPACE_MARKER} "${CLAUDE_PLUGIN_KEY}"): the ${PLUGIN_ID} plugin supplies the Claude Code agents and MCP servers, so .claude/agents/ and .mcp.json are not rendered; sessions open ${claudeAgentName("orchestrator-agent", mode)}. The guard's hooks stay in .claude/settings.json.`;
  return `Claude Code plugin mode (${WORKSPACE_MARKER} "${CLAUDE_PLUGIN_KEY}"), with the project's agents: this workspace customizes the Claude Code agents (${mode.customizations.join(", ")}), which the ${PLUGIN.name} plugin can't carry, so .claude/agents/ and .mcp.json are rendered as without the plugin and sessions open orchestrator-agent; the plugin's ${PLUGIN.name}: agents stay installed but unused.`;
}
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

// ---- the pinned Node.js (see the header) ----------------------------------------------------------------------------

// what the cloud-agent opt-in commits, so it keeps `node`: GitHub's runner has its own Node.js
export const PLAIN_WITH_CLOUD_AGENT = [".github/"];
const isMap = (v) => Object.prototype.toString.call(v) === "[object Object]";
const validRecord = (r) => isMap(r) && typeof r.path === "string" && r.path !== "" && typeof r.version === "string";
const PIN_KEY = `${NODE_PIN_FILE} "${NODE_PIN_KEY}"`;

// The machine as the decision sees it; each part injectable (tests: another OS's layout, a PATH node of any version).
export const nodeSystem = (sys = {}) => ({ env: process.env, platform: process.platform, home: os.homedir(), exists: existsSync, readdir: readdirSync, probe: probeNode, execPath: process.execPath, current: process.versions.node, now: Date.now(), ...sys });

// The machine-local file's content -> { text: as read (null: no file), record: its "node" (undefined: none) } |
// { error } (it isn't a JSON object).
export function readNodeRecord(workspace) {
  const file = path.join(workspace, ...NODE_PIN_FILE.split("/"));
  if (!existsSync(file)) return { text: null, record: undefined };
  let text, doc;
  try {
    text = readFileSync(file, "utf8");
    doc = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    return { error: `${NODE_PIN_FILE} could not be read as JSON (${e.message}): run npx atf sync (in the workspace), which writes it again` };
  }
  if (!isMap(doc)) return { error: `${NODE_PIN_FILE} must hold a JSON object: run npx atf sync (in the workspace), which writes it again` };
  return { text, record: doc[NODE_PIN_KEY] };
}

// The recorded "node" (undefined without one) -> { pin: the Node.js to render, or null; record: what "node" should hold
// (undefined: no key); pathNode: the PATH's node as found ({ path?, version }, null: none), in sync only; problem: why
// nothing could be pinned, when the PATH's node needs it } | { error }. check: render with the recorded pin, never
// decide (see the header). nvmrc: the workspace's .nvmrc major, which findNode prefers.
export function nodePinFor(recorded, { check = false, sys, nvmrc = null } = {}) {
  const s = nodeSystem(sys);
  const key = PIN_KEY;
  if (check) {
    if (recorded === undefined) return { pin: null, record: undefined };
    if (!validRecord(recorded)) return { error: `${key} must be { "path", "version", "pinnedAt" } as atf sync writes it, not ${JSON.stringify(recorded)}: run npx atf sync (in the workspace)` };
    if (!s.exists(recorded.path)) return { error: `${key} pins Node.js ${recorded.version} at ${recorded.path}, which is gone: run npx atf sync (in the workspace), which finds another` };
    try {
      nodeWord(recorded.path);
    } catch (e) {
      return { error: `${key}: ${e.message}: run npx atf sync (in the workspace)` };
    }
    return { pin: recorded, record: recorded };
  }
  // the node the hosts find: the one bin/atf.mjs was started on when it switched, else the PATH's first (this process
  // when it is that file, so the usual case starts nothing)
  const first = s.env[REEXEC_ENV] ? { version: String(s.env[REEXEC_ENV]) } : pathNode({ ...s, probe: (f) => (f === s.execPath ? s.current : s.probe(f)) });
  if (first?.version && nodeMajor(first.version) >= MIN_NODE) return { pin: null, record: undefined, pathNode: first };
  const was = !first ? "your PATH has no node" : first.version ? `your PATH's node is Node.js ${first.version}` : `your PATH's node (${first.path}) doesn't answer`;
  // the one findNode prefers (the .nvmrc's major, the newest LTS line, the newest); else the one recorded before, when
  // it is somewhere findNode doesn't look and still runs
  const kept = validRecord(recorded) && s.exists(recorded.path) ? s.probe(recorded.path) : null;
  const found = findNode({ ...s, nvmrc }) ?? (kept && nodeMajor(kept) >= MIN_NODE ? { path: recorded.path, version: kept, source: NODE_PIN_FILE } : null);
  if (!found)
    return { pin: null, record: undefined, pathNode: first, problem: `${was}, older than ${MIN_NODE}, and no newer Node.js is installed, so the guard hook refuses every call and the browser server can't start: install one (${installHint(s)}), then run npx atf sync` };
  try {
    nodeWord(found.path);
  } catch (e) {
    return { pin: null, record: undefined, pathNode: first, problem: `${was}, older than ${MIN_NODE}, and ${e.message} (Node.js ${found.version}): put a Node.js ${MIN_NODE} or later first in your PATH, then run npx atf sync` };
  }
  const same = validRecord(recorded) && recorded.path === found.path && recorded.version === found.version && typeof recorded.pinnedAt === "string";
  const pin = { path: found.path, version: found.version, pinnedAt: same ? recorded.pinnedAt : new Date(s.now).toISOString() };
  return { pin, record: pin, pathNode: first, source: found.source };
}

// The machine-local file's text (null: no file) -> the same with "node" set to `record` (or removed when undefined): its
// other keys in their order, its indent, line ending and BOM kept; null when nothing is left (the file goes).
export function withNodeRecord(text, record) {
  const bom = text?.charCodeAt(0) === 0xfeff ? "﻿" : "";
  const body = text === null ? "{}" : bom ? text.slice(1) : text;
  const next = { ...JSON.parse(body) };
  if (record === undefined) delete next[NODE_PIN_KEY];
  else next[NODE_PIN_KEY] = record;
  if (!Object.keys(next).length) return null;
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)"/m.exec(body)?.[1] ?? "  ";
  return bom + JSON.stringify(next, null, indent).replaceAll("\n", eol) + eol;
}

// What sync says about the pinned Node.js; null when there is nothing to say (the PATH's node is new enough).
export function nodePinLine(node) {
  if (node?.problem) return `warning: ${node.problem}.`;
  if (!node?.pin) return null;
  const was = node.pathNode?.version ? `your PATH's node is Node.js ${node.pathNode.version}` : "your PATH has no usable node";
  return `${was}, older than ${MIN_NODE}: the hooks and the browser server run Node.js ${node.pin.version} (${node.pin.path}), recorded in ${NODE_PIN_FILE} (this machine's, kept out of git); each sync checks again.`;
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
// cloudAgent, committed: [what the opt-in commits for the cloud agent], claude: the plugin's mode (provenance.mjs
// claudeMode: { on: false } | { on, agents, customizations, marketplace }), node: the pinned Node.js (nodePinFor: { pin,
// pathNode, problem? }; null in a source checkout) }. nodeSys: nodeSystem's injections, for tests.
export function sync({ workspace, framework, check = false, nodeSys }) {
  const installed = isInstalled(framework);
  const result = { errors: [], changed: [], created: [], problems: [], installed, cloudAgent: false, committed: [], claude: { on: false }, node: null };
  const fail = (errors, changed = []) => ({ ...result, errors, changed });
  let ignore = null;
  let setup = {};
  let nodePin = null;
  let machine = null;
  // the plugin's mode, in either kind of workspace: a source checkout's opt-in is an error (the build's too)
  const claude = claudeMode({ workspace, framework });
  if (claude.error) return fail([claude.error]);
  result.claude = claude;
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
    let agentFiles, supplied;
    try {
      agentFiles = generatedAgentFiles({ workspace, framework });
      if (opt.on) setup = setupWorkflow({ workspace, framework });
      supplied = claude.agents === "plugin" ? pluginSuppliedFiles({ workspace, framework }) : [];
    } catch (e) {
      return fail([e.message]);
    }
    const next = withGitignoreBlock(current, ignoredEntries(agentFiles, { cloudAgent: opt.on, supplied }));
    if (next.error) return fail([`${GITIGNORE}: ${next.error}`]);
    if (next.text !== current) ignore = { file, text: next.text };
    if (opt.on) result.committed = cloudAgentFiles(agentFiles);
    // the pinned Node.js: decided by sync, read back by check (see the header); sync rewrites a broken record file
    const { cfg } = readMarker(workspace); // cloudAgent() above already refused an unreadable one
    const local = readNodeRecord(workspace);
    if (local.error && check) return fail([local.error]);
    const recorded = local.error ? undefined : local.record;
    let node = nodePinFor(recorded, { check, sys: nodeSys, nvmrc: readLocalNode(workspace).nvmrc });
    if (node.error) return fail([node.error]);
    if (node.pin && !cfg) node = { pin: null, record: undefined, pathNode: node.pathNode, problem: `the PATH's node is older than ${MIN_NODE}, and there is no ${WORKSPACE_MARKER} here: run npx atf init here first` };
    result.node = { pin: node.pin, pathNode: node.pathNode ?? null, ...(node.problem ? { problem: node.problem } : {}) };
    if (node.pin) {
      const sys = nodeSystem(nodeSys);
      nodePin = { hook: nodeWord(node.pin.path), mcp: mcpNodePin(node.pin.path, sys), plain: opt.on ? PLAIN_WITH_CLOUD_AGENT : [] };
    }
    if (!check && (local.error || !isDeepStrictEqual(recorded, node.record))) {
      const file = path.join(workspace, ...NODE_PIN_FILE.split("/"));
      machine = { file, text: withNodeRecord(local.error ? null : local.text, node.record) };
    }
  }
  const r = build({ root: workspace, framework, check, nodePin });
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
  if (machine && (machine.text !== null || existsSync(machine.file))) {
    changed.push(NODE_PIN_FILE);
    try {
      if (machine.text === null) rmSync(machine.file, { force: true });
      else {
        mkdirSync(path.dirname(machine.file), { recursive: true });
        writeFileSync(machine.file, machine.text, "utf8");
      }
    } catch (e) {
      return fail([`${NODE_PIN_FILE}: ${e.message} (the host files were written)`], changed.slice(0, -1));
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
