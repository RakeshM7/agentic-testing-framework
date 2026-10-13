// The hand-written agent sources: agents/<name>.md, one per agent in config/permissions.yaml. A source holds only what
// no config file can derive: the agent's identity (name, description, optional color, user_invocable) and its
// platform-neutral prompt body. Tools, model and MCP servers are never written here; the build derives them.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export const SOURCE_DIR = "agents";
const KEYS = new Set(["name", "description", "color", "user_invocable"]);

export function splitFrontmatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`${file}: missing YAML frontmatter`);
  return { meta: yaml.load(m[1]) ?? {}, body: m[2] };
}

function validate(name, meta, rel) {
  const errors = [];
  if (meta.name !== name) errors.push(`${rel}: frontmatter name must be '${name}'`);
  if (typeof meta.description !== "string" || !meta.description.trim()) errors.push(`${rel}: description is required`);
  if (meta.user_invocable !== undefined && typeof meta.user_invocable !== "boolean") errors.push(`${rel}: user_invocable must be true or false`);
  for (const k of Object.keys(meta))
    if (!KEYS.has(k)) errors.push(`${rel}: '${k}' does not belong in a source (allowed: ${[...KEYS].join(", ")}); tools/model/MCP come from config/`);
  return errors;
}

// -> { sources: { [name]: { meta, body, eol } }, errors }. `names` = the agents in config/permissions.yaml.
export function loadSources(root, names) {
  const dir = path.join(root, SOURCE_DIR);
  const errors = [];
  const sources = {};
  for (const f of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [])
    if (!names.includes(f.slice(0, -3))) errors.push(`${SOURCE_DIR}/${f}: not in config/permissions.yaml`);
  for (const name of names) {
    const rel = `${SOURCE_DIR}/${name}.md`;
    const file = path.join(root, rel);
    if (!existsSync(file)) {
      errors.push(`${rel}: missing`);
      continue;
    }
    try {
      const text = readFileSync(file, "utf8");
      const { meta, body } = splitFrontmatter(text, rel);
      const errs = validate(name, meta, rel);
      if (errs.length) errors.push(...errs);
      else sources[name] = { meta, body, eol: text.includes("\r\n") ? "\r\n" : "\n" };
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { sources, errors };
}
