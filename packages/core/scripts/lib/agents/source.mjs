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

// `<!-- include: _shared/<file>.md -->` on a line of its own expands to agents/_shared/<file>.md (no frontmatter, no
// nested includes), so wording shared by several agents is written once. A fragment is not an agent: loadSources
// lists only agents/*.md, never the _shared directory. The build lints and limits the EXPANDED body, and the
// generated files hold the expanded text, so a changed fragment is drift in every agent that includes it.
export const SHARED_DIR = "_shared";
// (the line's own `\r`, captured, is put back after the text, or a CRLF source would get one bare LF per include)
const INCLUDE_LINE = /^[ \t]*<!--\s*include:\s*(\S+?)\s*-->[ \t]*(\r?)$/m;
const TARGET = new RegExp(`^${SHARED_DIR}/([A-Za-z0-9][A-Za-z0-9._-]*\\.md)$`);

export function expandIncludes(root, rel, body, errors) {
  const crlf = body.includes("\r\n");
  return body.replace(new RegExp(INCLUDE_LINE.source, "gm"), (whole, target, cr) => {
    const m = TARGET.exec(target);
    if (!m) {
      errors.push(`${rel}: include '${target}' must be ${SHARED_DIR}/<file>.md`);
      return whole;
    }
    const file = path.join(root, SOURCE_DIR, SHARED_DIR, m[1]);
    if (!existsSync(file)) {
      errors.push(`${rel}: include '${target}' names no file (${SOURCE_DIR}/${target})`);
      return whole;
    }
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (INCLUDE_LINE.test(text)) errors.push(`${SOURCE_DIR}/${target}: a fragment cannot include another fragment`);
    return (crlf ? text.replace(/\n/g, "\r\n") : text) + cr;
  });
}

// Add-on fragments (docs/packaging.md §3.5): a workspace's `atf/agents/<name>.extra.md` is appended to that framework
// agent's body under a fixed heading, so a client adds house rules to an agent without forking its source. It is body
// text only: no frontmatter (a leading `---` block is an error), so tools, model, MCP servers and subagents still come
// only from config (D-006, D-018), and no include line (`_shared/` is the framework's). Only `<name>.extra.md` files
// for agents the framework has belong in the folder; anything else, a subfolder included, fails the build, named, so
// a misspelt fragment is never silently dropped. Dot-files (a Finder `.DS_Store`) are not entries. The build lints and
// limits the COMBINED body like any source, and the generated files hold it, so a changed fragment is drift.
export const FRAGMENT_DIR = "atf/agents";
export const FRAGMENT_SUFFIX = ".extra.md";
export const fragmentRel = (name) => `${FRAGMENT_DIR}/${name}${FRAGMENT_SUFFIX}`;
export const fragmentHeading = (name) => `## Project additions (from ${fragmentRel(name)})`;
const LEADING_FRONTMATTER = /^---[ \t]*(\n|$)/;

// -> { [name]: fragment text (LF, trimmed) }, pushing an error per stray entry or bad fragment.
export function loadFragments(workspace, names, errors) {
  const dir = path.join(workspace, ...FRAGMENT_DIR.split("/"));
  const fragments = {};
  for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const f = entry.name;
    if (f.startsWith(".")) continue;
    const rel = `${FRAGMENT_DIR}/${f}`;
    if (!entry.isFile() || !f.endsWith(FRAGMENT_SUFFIX) || f === FRAGMENT_SUFFIX) {
      errors.push(`${rel}: only <agent>${FRAGMENT_SUFFIX} add-on fragments belong in ${FRAGMENT_DIR}/`);
      continue;
    }
    const name = f.slice(0, -FRAGMENT_SUFFIX.length);
    if (!names.includes(name)) {
      errors.push(`${rel}: the framework has no agent '${name}' to add to`);
      continue;
    }
    const text = readFileSync(path.join(dir, f), "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
    const before = errors.length;
    if (LEADING_FRONTMATTER.test(text)) errors.push(`${rel}: an add-on fragment has no frontmatter (a leading '---' block); its agent's identity, tools, model and MCP servers come only from the framework and config/`);
    if (INCLUDE_LINE.test(text)) errors.push(`${rel}: an add-on fragment cannot include ${SHARED_DIR}/ files`);
    if (!text) errors.push(`${rel}: empty; delete it or add text`);
    if (errors.length === before) fragments[name] = text;
  }
  return fragments;
}

// body + fragment -> the combined body: the source's body, one blank line, the fixed heading, one blank line, the
// fragment, a final newline, all in the source's line endings.
export function appendFragment(name, body, fragment, eol) {
  return [body.replace(/(\r?\n)+$/, ""), "", fragmentHeading(name), "", fragment.replace(/\n/g, eol)].join(eol) + eol;
}

// -> { sources: { [name]: { meta, body, eol, fragment? } }, errors }. `names` = the agents in config/permissions.yaml.
// `workspace`, when given, is where `atf/agents/` add-on fragments are read from (the build's workspace root; the
// framework's own directory when the two are one); without it no fragment is read, as before. `fragment` is the
// fragment's workspace-relative path, for errors that measure the combined body.
export function loadSources(root, names, { workspace } = {}) {
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
      const split = splitFrontmatter(text, rel);
      const { meta } = split;
      const errs = validate(name, meta, rel);
      const body = expandIncludes(root, rel, split.body, errs);
      if (errs.length) errors.push(...errs);
      else sources[name] = { meta, body, eol: text.includes("\r\n") ? "\r\n" : "\n" };
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (workspace !== undefined)
    for (const [name, fragment] of Object.entries(loadFragments(workspace, names, errors))) {
      const s = sources[name];
      if (!s) continue; // its source is missing or broken: already an error
      s.body = appendFragment(name, s.body, fragment, s.eol);
      s.fragment = fragmentRel(name);
    }
  return { sources, errors };
}
