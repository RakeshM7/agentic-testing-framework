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
// Phase 3c's cloud-agent opt-in commits the Copilot files (.github/agents/, .github/hooks/), so it filters this one
// list (ignoredEntries), never a second copy.
//
// sync() checks everything before it writes anything: a malformed block, an unreadable .gitignore or any build error
// (a bad overlay or fragment, a stray or missing source) leaves every file as it was (D-018).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "../build-agents.mjs";
import { loadConfig } from "./config.mjs";
import { isInstalled } from "./roots.mjs";

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

// Everything the block lists, sorted (code-unit order, the same on every OS and locale) so atf check is stable.
export const ignoredEntries = (agentFiles) => [...new Set([...agentFiles, ...CLIENT_IGNORED])].sort();

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

// -> { errors, changed: [workspace-relative paths that differ (or would, with check)], installed }
export function sync({ workspace, framework, check = false }) {
  const installed = isInstalled(framework);
  let ignore = null;
  if (installed) {
    const file = path.join(workspace, GITIGNORE);
    let current;
    try {
      current = existsSync(file) ? readFileSync(file, "utf8") : "";
    } catch (e) {
      return { errors: [`${GITIGNORE}: ${e.message}`], changed: [], installed };
    }
    let entries;
    try {
      entries = ignoredEntries(generatedAgentFiles({ workspace, framework }));
    } catch (e) {
      return { errors: [e.message], changed: [], installed };
    }
    const next = withGitignoreBlock(current, entries);
    if (next.error) return { errors: [`${GITIGNORE}: ${next.error}`], changed: [], installed };
    if (next.text !== current) ignore = { file, text: next.text };
  }
  const r = build({ root: workspace, framework, check });
  if (r.errors.length) return { errors: r.errors, changed: [], installed };
  const changed = [...r.changed];
  if (ignore) {
    changed.push(GITIGNORE);
    if (!check) {
      try {
        writeFileSync(ignore.file, ignore.text, "utf8");
      } catch (e) {
        return { errors: [`${GITIGNORE}: ${e.message} (the host files were written)`], changed: r.changed, installed };
      }
    }
  }
  return { errors: [], changed, installed };
}
