#!/usr/bin/env node
// Renders every agent definition for Claude Code and GitHub Copilot from one source:
//   agents/src/<agent>.md   name/description frontmatter + shared body with platform sections
//   agents/manifest.yaml    tool capabilities, platform-only frontmatter, shared wording, MCP server
//   config/models.yaml      model per agent per platform
// into the generated (never hand-edited) files:
//   .claude/agents/<agent>.md, .github/agents/<agent>.agent.md, .mcp.json, .vscode/mcp.json
//
// Body syntax (see docs/conventions.md, "Changing an agent's behavior"):
//   {{#claude}}...{{/claude}}  {{#copilot}}...{{/copilot}}   text for one platform only; a marker
//                                                           alone on its line also drops that line break
//   {{v:<key>}}                                              a manifest `vocab` term
//   {{browser:<tool>}}                                       a Playwright MCP tool name
//
// Usage: node scripts/build-agents.mjs [--check] [--deltas]
//   --check   write nothing; exit 1 if any output is missing, stale or hand-edited (CI, pre-commit)
//   --deltas  print each agent's platform-only sections, for review
// Exports renderBody / renderAgent / buildAll for tests.

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

export const PLATFORMS = ["claude", "copilot"];
const GENERATED_MARK = "GENERATED from agents/src/";
const SECTION = /\{\{#(claude|copilot)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

function header(name) {
  return `<!-- ${GENERATED_MARK}${name}.md by scripts/build-agents.mjs. DO NOT EDIT. Edit the source, then run: node scripts/build-agents.mjs -->`;
}

// A marker alone on its line consumes that line's newline, so a section can hold whole paragraphs
// without leaving blank lines behind in the other platform's output.
function joinStandaloneMarkers(body) {
  return body.replace(/^[ \t]*(\{\{[#/](?:claude|copilot)\}\})[ \t]*\n/gm, "$1");
}

export function renderBody(body, platform, manifest, agent = "agent") {
  let s = joinStandaloneMarkers(body);
  for (const m of s.matchAll(SECTION)) {
    if (/\{\{[#/]/.test(m[2])) throw new Error(`${agent}: nested platform section near "${m[0].slice(0, 60)}"`);
  }
  s = s.replace(SECTION, (_, p, text) => (p === platform ? text : ""));
  const stray = s.match(/\{\{[#/][^}]*\}\}/);
  if (stray) throw new Error(`${agent}: unbalanced platform section marker ${stray[0]}`);
  s = s.replace(/\{\{(v|browser):([\w-]+)\}\}/g, (m, kind, key) => {
    if (kind === "browser") return manifest.tools.browser[platform].replace("{tool}", key);
    const term = manifest.vocab?.[key]?.[platform];
    if (term === undefined) throw new Error(`${agent}: unknown vocab term {{v:${key}}} for ${platform}`);
    return term;
  });
  const unknown = s.match(/\{\{[^}]*\}\}/);
  if (unknown) throw new Error(`${agent}: unknown token ${unknown[0]}`);
  return s;
}

// Splits a source file into its raw frontmatter lines (copied verbatim) and body.
function splitSource(text, file) {
  const lines = text.split("\n");
  if (lines[0] !== "---") throw new Error(`${file}: expected YAML frontmatter starting with '---'`);
  const end = lines.indexOf("---", 1);
  if (end === -1) throw new Error(`${file}: unterminated YAML frontmatter`);
  const fmLines = lines.slice(1, end);
  const fm = yaml.load(fmLines.join("\n")) ?? {};
  for (const k of Object.keys(fm)) {
    if (!["name", "description"].includes(k))
      throw new Error(`${file}: frontmatter key '${k}' belongs in agents/manifest.yaml or config/models.yaml, not the source`);
  }
  if (typeof fm.name !== "string" || typeof fm.description !== "string")
    throw new Error(`${file}: frontmatter needs string 'name' and 'description'`);
  return { fm, fmLines, body: lines.slice(end + 1).join("\n") };
}

function toolNames(name, spec, manifest, platform) {
  const out = [];
  for (const cap of spec.tools ?? []) {
    const def = manifest.tools[cap];
    if (!def) throw new Error(`${name}: unknown tool capability '${cap}'`);
    if (cap === "browser") {
      if (!spec.browser_tools?.length) throw new Error(`${name}: 'browser' capability needs a browser_tools list`);
      out.push(...spec.browser_tools.map((t) => def[platform].replace("{tool}", t)));
    } else if (cap === "agent") {
      if (!spec.subagents?.length) throw new Error(`${name}: 'agent' capability needs a subagents list`);
      const v = def[platform];
      out.push(...(Array.isArray(v) ? v : [v.replace("{subagents}", spec.subagents.join(", "))]));
    } else {
      out.push(...def[platform]);
    }
  }
  return [...new Set(out)];
}

const quoteList = (xs) => `[${xs.map((x) => `'${x}'`).join(", ")}]`;

function renderModel(value, platform, manifest) {
  if (platform === "claude") return String(value);
  const list = Array.isArray(value) ? value : [value];
  return manifest.platforms.copilot.model_format === "array" ? quoteList(list) : `'${list[0]}'`;
}

export function renderAgent({ name, source, spec, models, manifest }) {
  const { fm, fmLines, body } = splitSource(source, `agents/src/${name}.md`);
  if (fm.name !== name) throw new Error(`agents/src/${name}.md: name '${fm.name}' must match its file name`);
  const out = {};
  for (const platform of PLATFORMS) {
    const model = models?.[platform];
    if (model === undefined) throw new Error(`config/models.yaml: ${name} has no '${platform}' entry`);
    const tools = toolNames(name, spec, manifest, platform);
    const front = [...fmLines];
    if (platform === "claude") {
      front.push(`tools: ${tools.join(", ")}`, `model: ${renderModel(model, platform, manifest)}`);
      if (spec.claude?.color) front.push(`color: ${spec.claude.color}`);
      if (spec.claude?.inline_mcp) {
        const server = manifest.mcp[spec.claude.inline_mcp];
        if (!server) throw new Error(`${name}: inline_mcp '${spec.claude.inline_mcp}' is not in manifest mcp:`);
        front.push(
          "mcpServers:",
          `  - ${server.claude_inline_name}:`,
          "      type: stdio",
          `      command: ${server.command}`,
          `      args: [${server.args.map((a) => JSON.stringify(a)).join(", ")}]`,
        );
      }
    } else {
      front.push(`tools: ${quoteList(tools)}`);
      if (spec.subagents?.length && spec.tools.includes("agent")) front.push(`agents: [${spec.subagents.join(", ")}]`);
      front.push(`model: ${renderModel(model, platform, manifest)}`);
      for (const [k, v] of Object.entries(spec.copilot ?? {})) front.push(`${k}: ${Array.isArray(v) ? quoteList(v) : v}`);
    }
    out[platform] = ["---", ...front, "---", header(name)].join("\n") + "\n" + renderBody(body, platform, manifest, name);
  }
  return out;
}

export function lintOutput(name, platform, text, manifest) {
  const errors = [];
  const bodyStart = text.indexOf("\n---\n", 4);
  const body = text.slice(bodyStart + 5);
  for (const word of manifest.lint?.[platform] ?? []) {
    // Claude's own frontmatter legitimately holds Agent(...)/mcpServers; lint the body only.
    if (body.includes(word)) errors.push(`${name} (${platform}): '${word}' leaked into the ${platform} file -- move it into a platform section or a {{v:...}} term`);
  }
  if (platform === "copilot") {
    const limit = manifest.platforms.copilot.body_limit;
    if (body.length > limit) errors.push(`${name} (copilot): body is ${body.length} chars, over GitHub's ${limit}-char limit`);
  }
  return errors;
}

function renderMcpJson(manifest, key) {
  const entries = Object.entries(manifest.mcp).map(
    ([name, s]) =>
      `    ${JSON.stringify(name)}: {\n      "command": ${JSON.stringify(s.command)},\n      "args": [${s.args.map((a) => JSON.stringify(a)).join(", ")}]\n    }`,
  );
  return `{\n  ${JSON.stringify(key)}: {\n${entries.join(",\n")}\n  }\n}\n`;
}

// Returns { files: Map<relPath, content>, errors, warnings, deltas }.
export function buildAll(root) {
  const manifest = yaml.load(readFileSync(path.join(root, "agents", "manifest.yaml"), "utf8"));
  const models = yaml.load(readFileSync(path.join(root, "config", "models.yaml"), "utf8"))?.agents ?? {};
  const files = new Map();
  const errors = [];
  const warnings = [];
  const deltas = [];
  const srcDir = path.join(root, "agents", "src");
  const sources = readdirSync(srcDir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  for (const name of Object.keys(manifest.agents)) if (!sources.includes(name)) errors.push(`agents/manifest.yaml: ${name} has no agents/src/${name}.md`);

  for (const name of sources) {
    const spec = manifest.agents[name];
    if (!spec) {
      errors.push(`agents/src/${name}.md has no entry in agents/manifest.yaml`);
      continue;
    }
    const source = readFileSync(path.join(srcDir, `${name}.md`), "utf8");
    try {
      const out = renderAgent({ name, source, spec, models: models[name], manifest });
      for (const platform of PLATFORMS) {
        files.set(manifest.platforms[platform].output.replace("{name}", name), out[platform]);
        errors.push(...lintOutput(name, platform, out[platform], manifest));
      }
      const tier = models[name]?.claude;
      const firstCopilot = [].concat(models[name]?.copilot ?? [])[0] ?? "";
      if (["sonnet", "opus", "haiku"].includes(tier) && !new RegExp(`claude.*${tier}`, "i").test(firstCopilot))
        warnings.push(`config/models.yaml: ${name}'s first copilot model '${firstCopilot}' is not a Claude ${tier} model; the two flavors may behave differently`);
      deltas.push({ name, ...measureDeltas(source) });
    } catch (e) {
      errors.push(e.message);
    }
  }
  files.set(".mcp.json", renderMcpJson(manifest, "mcpServers"));
  files.set(path.join(".vscode", "mcp.json"), renderMcpJson(manifest, "servers"));
  return { files, errors, warnings, deltas, manifest };
}

function measureDeltas(source) {
  const body = joinStandaloneMarkers(source);
  const sections = [...body.matchAll(SECTION)].map((m) => {
    const line = source.slice(0, source.indexOf(m[2].slice(0, 40))).split("\n").length;
    return { platform: m[1], line, chars: m[2].length, preview: m[2].trim().slice(0, 90).replace(/\s+/g, " ") };
  });
  const platformChars = sections.reduce((n, s) => n + s.chars, 0);
  return { sections, sharedPct: Math.round(100 * (1 - platformChars / body.length)) };
}

// Generated agent files no longer produced by the build (agent removed/renamed).
function orphans(root, files, manifest) {
  const found = [];
  for (const platform of PLATFORMS) {
    const dir = path.dirname(manifest.platforms[platform].output);
    if (!existsSync(path.join(root, dir))) continue;
    for (const f of readdirSync(path.join(root, dir))) {
      const rel = path.join(dir, f);
      if (!files.has(rel) && readFileSync(path.join(root, rel), "utf8").includes(GENERATED_MARK)) found.push(rel);
    }
  }
  return found;
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const check = process.argv.includes("--check");
  const { files, errors, warnings, deltas, manifest } = buildAll(root);
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length) {
    console.error(errors.map((e) => `error: ${e}`).join("\n"));
    process.exit(1);
  }
  if (process.argv.includes("--deltas")) {
    for (const d of deltas) {
      console.log(`\n${d.name}: ${d.sharedPct}% shared, ${d.sections.length} platform section(s)`);
      for (const s of d.sections) console.log(`  ${s.platform.padEnd(7)} line ${String(s.line).padStart(3)}  ${s.chars} chars  ${s.preview}`);
    }
    return;
  }
  let changed = 0;
  for (const [rel, content] of files) {
    const abs = path.join(root, rel);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current === content) continue;
    changed++;
    console.log(`${check ? (current === null ? "missing" : "stale or hand-edited") : "updated"}: ${rel}`);
    if (!check) {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content, "utf8");
    }
  }
  for (const rel of orphans(root, files, manifest)) {
    changed++;
    console.log(`${check ? "orphaned" : "removed"}: ${rel}`);
    if (!check) unlinkSync(path.join(root, rel));
  }
  console.log(`${changed} file(s) ${check ? "out of date -- run: node scripts/build-agents.mjs" : "written"}.`);
  if (check && changed > 0) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
