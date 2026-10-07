#!/usr/bin/env node
// Builds the generated part of every agent definition in .claude/agents/<name>.md from:
//   config/permissions.yaml  -> tools (incl. Agent(<spawns>), shell, web, browser) and mcpServers
//   config/models.yaml       -> model
// Hand-written parts are kept: `name`, `description`, `color` and the prompt body. A prompt can therefore never
// grant an agent a tool its permissions row does not allow.
//
//   node scripts/build-agents.mjs           rewrite generated frontmatter
//   node scripts/build-agents.mjs --check   write nothing; exit 1 on drift, a missing agent file, or a stray one
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { resolvePermissions } from "./lib/permissions.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const agentsDir = path.join(repoRoot, ".claude", "agents");

const BROWSER_READ = ["navigate", "navigate_back", "snapshot", "click", "hover", "take_screenshot", "wait_for", "tabs", "resize", "console_messages", "network_requests"];
const BROWSER_MUTATE = ["type", "fill_form", "select_option", "press_key", "file_upload", "drag", "drop", "handle_dialog", "evaluate"];
const MCP = "playwright";

export function toolsFor(row) {
  const t = ["Read", "Glob", "Grep"];
  if (row.filesystem.write.length) t.push("Write", "Edit");
  if (row.shell !== "none") t.push("Bash");
  if (row.web_research === "allowed" || row.live_target.http !== "none") t.push("WebFetch");
  if (row.web_research === "allowed") t.push("WebSearch");
  if (row.spawns.length) t.push(`Agent(${row.spawns.join(", ")})`);
  if (row.live_target.browser !== "none") {
    const set = row.live_target.browser === "mutate" ? [...BROWSER_READ, ...BROWSER_MUTATE] : BROWSER_READ;
    t.push(...set.map((n) => `mcp__${MCP}__browser_${n}`));
  }
  t.push(...(row.extra_tools ?? []));
  return t;
}

export function modelFor(models, name) {
  return models?.agents?.[name]?.claude ?? models?.default?.claude;
}

function splitFrontmatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: missing YAML frontmatter`);
  return { fm: yaml.load(m[1]) ?? {}, body: m[2] };
}

export function render(name, fm, row, model, eol) {
  if (fm.name !== name) throw new Error(`${name}.md: frontmatter name must be '${name}'`);
  if (typeof fm.description !== "string" || !fm.description.trim()) throw new Error(`${name}.md: description is required`);
  const lines = ["---", `name: ${name}`, `description: ${JSON.stringify(fm.description.trim())}`, `tools: ${toolsFor(row).join(", ")}`];
  if (row.live_target.browser !== "none") lines.push("mcpServers:", `  - ${MCP}`);
  if (!model) throw new Error(`${name}: no model in config/models.yaml (agents.${name}.claude or default.claude)`);
  lines.push(`model: ${model}`);
  if (fm.color) lines.push(`color: ${fm.color}`);
  lines.push("---");
  return lines.join(eol) + eol;
}

export function build({ check = false, root = repoRoot } = {}) {
  const dir = path.join(root, ".claude", "agents");
  const perms = resolvePermissions(yaml.load(readFileSync(path.join(root, "config", "permissions.yaml"), "utf8")));
  if (perms.errors.length) return { errors: perms.errors };
  const models = yaml.load(readFileSync(path.join(root, "config", "models.yaml"), "utf8"));
  const errors = [];
  const changed = [];
  const names = Object.keys(perms.resolved.agents);
  for (const f of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [])
    if (!names.includes(f.slice(0, -3))) errors.push(`.claude/agents/${f}: not in config/permissions.yaml`);
  for (const name of names) {
    const file = path.join(dir, `${name}.md`);
    if (!existsSync(file)) {
      errors.push(`.claude/agents/${name}.md: missing`);
      continue;
    }
    try {
      const text = readFileSync(file, "utf8");
      const eol = text.includes("\r\n") ? "\r\n" : "\n";
      const { fm, body } = splitFrontmatter(text, file);
      const next = render(name, fm, perms.resolved.agents[name], modelFor(models, name), eol) + body;
      if (next !== text) {
        changed.push(name);
        if (!check) writeFileSync(file, next, "utf8");
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { errors, changed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { errors, changed } = build({ check });
  for (const e of errors) console.error(`error: ${e}`);
  for (const n of changed ?? []) console.log(`${check ? "drift" : "built"}: .claude/agents/${n}.md`);
  console.log(`${changed?.length ?? 0} agent file(s) ${check ? "out of date" : "rebuilt"}, ${errors.length} error(s).`);
  if (errors.length || (check && changed?.length)) process.exit(1);
}
