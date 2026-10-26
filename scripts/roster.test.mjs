// The docs, configs, agent bodies and scripts name only agents that exist in config/permissions.yaml, and every agent
// count in the docs matches it -- so a roster change cannot leave stale text behind. docs/decisions.md is excluded:
// it is append-only history and keeps the names of agents that were later removed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { frameworkRoot } from "./lib/contract.mjs";
import { resolvePermissions } from "./lib/permissions.mjs";

const read = (rel) => readFileSync(path.join(frameworkRoot, rel), "utf8");
const { errors, resolved } = resolvePermissions(yaml.load(read("config/permissions.yaml")));
const agents = new Set(Object.keys(resolved.agents));

const COUNTED = ["AGENTS.md", "README.md", "architecture.md", "docs/agent-architecture.md"];
const ROLE = /-(writer|healer|implementor|reviewer|orchestrator|triager|explorer|scaffolder|discoverer|planner|designer|owner|generator|agent|fixer)$/;
// Agent-shaped words that are not agent names. framework-implementor-agent is planned, not yet an agent: the dev-only
// maintainer agent of docs/packaging.md (draft D-091), named there before it exists.
const NOT_AGENTS = new Set(["per-agent", "agent-to-agent", "custom-agent", "calling-agent", "cloud-agent", "framework-implementor-agent"]);
// Prose may shorten a name to its role ("every runner-triager"), so a hyphen-bounded suffix of a real agent counts.
const isAgent = (name) => agents.has(name) || [...agents].some((a) => a.endsWith(`-${name}`));

function files(dir, keep) {
  return readdirSync(path.join(frameworkRoot, dir)).flatMap((f) => {
    const rel = path.posix.join(dir, f);
    return statSync(path.join(frameworkRoot, rel)).isDirectory() ? files(rel, keep) : keep(rel) ? [rel] : [];
  });
}
const scanned = [
  ...files("agents", (f) => f.endsWith(".md")),
  ...files("docs", (f) => f.endsWith(".md") && f !== "docs/decisions.md"),
  ...files("config", (f) => f.endsWith(".yaml")),
  ...files("scripts", (f) => f.endsWith(".mjs")),
  "AGENTS.md",
  "README.md",
  "architecture.md",
];

test("config/permissions.yaml resolves", () => assert.deepEqual(errors, []));

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
