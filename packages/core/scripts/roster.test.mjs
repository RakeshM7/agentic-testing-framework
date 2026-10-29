// The docs, configs, agent bodies and scripts name only agents that exist in config/permissions.yaml, and every agent
// count in the docs matches it -- so a roster change cannot leave stale text behind. docs/decisions.md is excluded:
// it is append-only history and keeps the names of agents that were later removed.
// The framework's files (agents, config, scripts, the agent-facing docs) and the workspace's (the briefs and the
// maintainer docs) are both scanned: one directory, or the monorepo's root and its packages/core.
// The workspace's dev-only agents (atf/atf.json "dev_agents", docs/packaging.md §3.8: sources in that folder, rows in
// the atf/permissions.yaml overlay) are real agents wherever they are named, and their sources are scanned too, but
// they are not the framework's roster: the counts and the roster table are the framework's own permissions.yaml.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { frameworkRoot, workspaceRoot } from "./lib/contract.mjs";
import { loadConfig } from "./lib/config.mjs";
import { devAgentsDir } from "./lib/roots.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";

const ROOTS = [...new Set([workspaceRoot, frameworkRoot])];
// a path from whichever root holds it: the workspace's first
const where = (rel) => ROOTS.map((r) => path.join(r, rel)).find((f) => existsSync(f)) ?? path.join(frameworkRoot, rel);
const read = (rel) => readFileSync(where(rel), "utf8");
const { errors, resolved } = resolvePermissions(yaml.load(read("config/permissions.yaml")));
const agents = new Set(Object.keys(resolved.agents));
const dev = devAgentsDir(workspaceRoot, frameworkRoot);
const devAgents = new Set(dev.dir ? readdirSync(dev.dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : []);

const COUNTED = ["AGENTS.md", "README.md", "architecture.md", "docs/agent-architecture.md"];
const ROLE = /-(writer|healer|implementor|reviewer|orchestrator|triager|explorer|scaffolder|discoverer|planner|designer|owner|generator|agent|fixer)$/;
// Agent-shaped words that are not agent names.
const NOT_AGENTS = new Set(["per-agent", "agent-to-agent", "custom-agent", "calling-agent", "cloud-agent"]);
// Prose may shorten a name to its role ("every runner-triager"), so a hyphen-bounded suffix of a real agent counts.
const isAgent = (name) => [...agents, ...devAgents].some((a) => a === name || a.endsWith(`-${name}`));

// -> the files under `dir` in every root, by their path from that root (a directory in both is listed once per file)
function files(dir, keep) {
  const under = (root, d) =>
    existsSync(path.join(root, d))
      ? readdirSync(path.join(root, d)).flatMap((f) => {
        const rel = path.posix.join(d, f);
        return statSync(path.join(root, rel)).isDirectory() ? under(root, rel) : keep(rel) ? [rel] : [];
      })
      : [];
  return [...new Set(ROOTS.flatMap((root) => under(root, dir)))];
}
const scanned = [
  ...files("agents", (f) => f.endsWith(".md")),
  ...(dev.dir ? files(dev.rel, (f) => f.endsWith(".md")) : []),
  ...files("docs", (f) => f.endsWith(".md") && f !== "docs/decisions.md"),
  ...files("config", (f) => f.endsWith(".yaml")),
  ...files("scripts", (f) => f.endsWith(".mjs")),
  "AGENTS.md",
  "README.md",
  "architecture.md",
];

test("config/permissions.yaml resolves", () => assert.deepEqual(errors, []));

test("the workspace's dev-only agents are its own: none is a framework agent, each has a row in the effective permissions.yaml", () => {
  assert.equal(dev.error, undefined);
  const effective = new Set(Object.keys(loadConfig("permissions.yaml", { framework: frameworkRoot, workspace: workspaceRoot }).agents));
  for (const name of devAgents) {
    assert.ok(!agents.has(name), `${name}: a framework agent's name`);
    assert.ok(effective.has(name), `${name}: no row in the effective permissions.yaml (atf/permissions.yaml)`);
  }
  // every effective row is the framework's or a dev agent's: an overlay row with no source is caught here too
  assert.deepEqual([...effective].filter((n) => !agents.has(n) && !devAgents.has(n)), []);
});

test("every agent count in the docs matches config/permissions.yaml", () => {
  for (const f of COUNTED)
    for (const [phrase, n] of read(f).matchAll(/\b(\d+)(?:[- ]| small )(?:agents?|roles)\b/g))
      assert.equal(Number(n), agents.size, `${f}: "${phrase}" -- the roster has ${agents.size} agents`);
});

test("the roster table in docs/agent-architecture.md names exactly the agents in config/permissions.yaml", () => {
  const section = read("docs/agent-architecture.md").split(/^## Roster.*$/m)[1].split(/^## /m)[0];
  const named = new Set([...section.matchAll(/`([a-z0-9]+(?:-[a-z0-9]+)+)`/g)].map(([, n]) => n));
  assert.deepEqual([...named].filter((n) => !agents.has(n)), [], "names in the table that are not agents");
  assert.deepEqual([...agents].filter((n) => !named.has(n)), [], "agents missing from the table");
});

test("every agent-shaped name in docs, configs, agent bodies and scripts is a real agent", () => {
  const stale = [];
  for (const f of scanned)
    for (const [name] of read(f).matchAll(/(?<![\w-])[a-z][a-z0-9]*(?:-[a-z0-9]+)+(?![\w-])/g))
      if (ROLE.test(name) && !isAgent(name) && !NOT_AGENTS.has(name)) stale.push(`${f}: ${name}`);
  assert.deepEqual([...new Set(stale)], []);
});
