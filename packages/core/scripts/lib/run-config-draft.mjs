// Turns the answers of the orchestrator's short run-config interview into a run-config (D-063).
// Pure: no file writes (scripts/run-config.mjs `draft` validates and writes). Answers hold paths and URLs, never secret
// values (D-012), and the draft is always `authorizations.mode: readonly` (D-004): full-run is a human edit, never inferred.
//
// answers: { name, visibility: public|internal, description?, url, overview_url?, api?: [url|path],
//            modules: [name | {name, url?, references?, testcases_file?}], references?: [url|path],
//            login?: { needed: bool, credentials_file?, session_state_file? },
//            steps?: [step], testcases_files?: {<module name or slug>: path}, testcases_import?: path,
//            testcases_types?: [ui|api|performance] }
// steps, test case files and types are checked by validateRunConfig (scripts/run-config.mjs); a file must exist.
//
// Also the narrow rewrite of an existing config behind `run-config.mjs set` (applyChanges, rewriteKeys): only `steps`,
// `modules[].testcases_file`, `testcases.import` and `testcases.types` change; every other byte, comments included, stays.

import { existsSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { SLUG_RE } from "./contract.mjs";

export const VISIBILITIES = ["public", "internal"];
const URL_RE = /^https?:\/\//i;
// Spec-like API inputs; any other http(s) URL is an API host.
const SPEC_RE = /openapi|swagger|\.(json|ya?ml)(\?|#|$)/i;
// Documents the agents' file reader cannot open as text.
const OPAQUE_RE = /\.(xlsx?|docx?|pptx?)$/i;

export function slugify(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const uniq = (a) => [...new Set(a)];

// Splits mixed references into links and local files; a file that does not exist is an error so the human fixes the path.
function splitRefs(refs, where, { root, errors, warnings }) {
  const links = [];
  const files = [];
  for (const r of refs) {
    if (URL_RE.test(r)) links.push(r);
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(r)) errors.push(`${where}: '${r}' is not an http(s) link or a file path`);
    else if (!existsSync(path.resolve(root, r))) errors.push(`${where}: file not found: ${r} (give the path from the repo root, or an absolute path)`);
    else {
      files.push(r);
      if (OPAQUE_RE.test(r)) warnings.push(`${where}: ${r} is an Office file the agents cannot read as text; export it to .md, .csv or .pdf and give that path`);
    }
  }
  return { links, files };
}

export function buildDraft(answers, { root = process.cwd(), exists = (p) => existsSync(p) } = {}) {
  const errors = [];
  const warnings = [];
  const a = answers && typeof answers === "object" && !Array.isArray(answers) ? answers : {};
  const ctx = { root, errors, warnings };

  const name = str(a.name);
  const product = slugify(name);
  if (!name || !SLUG_RE.test(product)) errors.push("name: the product name is required (it becomes the folder name under artifacts/, e.g. 'Acme CRM' -> acme-crm)");
  const visibility = str(a.visibility).toLowerCase();
  if (!VISIBILITIES.includes(visibility)) errors.push(`visibility: must be one of [${VISIBILITIES}] (public = vendor docs on the web may be researched; internal = only what you reference)`);
  const url = str(a.url);
  if (!URL_RE.test(url)) errors.push("url: the product's address to test, an http(s) URL, is required");

  const refs = splitRefs(uniq([str(a.overview_url), ...list(a.references)].filter(Boolean)), "references", ctx);
  if (visibility === "internal" && !refs.links.length && !refs.files.length && !str(a.description))
    errors.push("description: an internal product has no public docs, so give a short description, a link or a file path");

  const slugs = new Set();
  const modules = [];
  const rawModules = Array.isArray(a.modules) ? a.modules : [];
  if (!rawModules.length) errors.push("modules: list at least one module to run (e.g. Contacts, Deals)");
  rawModules.forEach((m, i) => {
    const mod = typeof m === "string" ? { name: m } : m && typeof m === "object" ? m : {};
    const mname = str(mod.name);
    let slug = slugify(mname);
    if (slug === "product") slug = "product-module"; // 'product' is reserved (D-051)
    if (!mname || !SLUG_RE.test(slug)) return errors.push(`modules[${i}].name: a module name is required`);
    if (slugs.has(slug)) return errors.push(`modules[${i}]: duplicate module '${mname}'`);
    slugs.add(slug);
    const entry = { slug, name: mname };
    const murl = str(mod.url);
    if (murl && !URL_RE.test(murl)) errors.push(`modules[${i}].url: not an http(s) URL`);
    else if (murl) entry.entry_url = murl;
    entry.nav_path = [mname]; // reach it by its menu label; module-explorer finds it from there
    const mrefs = splitRefs(list(mod.references), `modules[${i}].references`, ctx);
    if (mrefs.links.length || mrefs.files.length) entry.references = [...mrefs.links, ...mrefs.files];
    const tcFile = str(mod.testcases_file);
    if (tcFile) entry.testcases_file = tcFile;
    modules.push(entry);
  });
  // The human's own test case files, per module (by its name or slug) and product-wide.
  const tcFiles = a.testcases_files && typeof a.testcases_files === "object" && !Array.isArray(a.testcases_files) ? a.testcases_files : {};
  for (const [k, f] of Object.entries(tcFiles)) {
    const mod = modules.find((m) => m.slug === k || m.slug === slugify(k));
    if (!mod) errors.push(`testcases_files.${k}: not one of the modules (${modules.map((m) => m.slug).join(", ")})`);
    else if (str(f)) mod.testcases_file = str(f);
  }
  const testcases = {
    ...(str(a.testcases_import) ? { import: str(a.testcases_import) } : {}),
    ...(list(a.testcases_types).length ? { types: list(a.testcases_types) } : {}),
  };

  const apiHosts = [];
  const specs = [];
  for (const r of list(a.api)) {
    if (URL_RE.test(r)) (SPEC_RE.test(r) ? specs : apiHosts).push(r);
    else if (existsSync(path.resolve(root, r))) specs.push(r);
    else errors.push(`api: '${r}' is not an http(s) URL and no such file exists`);
  }

  const login = a.login && typeof a.login === "object" ? a.login : {};
  const needsLogin = login.needed === true || !!str(login.session_state_file) || !!str(login.credentials_file);
  const next = [];
  let sessionFile = str(login.session_state_file) || null;
  const credFile = str(login.credentials_file) || null;
  for (const [k, f] of [["session_state_file", sessionFile], ["credentials_file", credFile]]) if (f && !existsSync(path.resolve(root, f))) warnings.push(`login.${k}: ${f} does not exist yet`);
  if (needsLogin && !sessionFile) {
    sessionFile = `playwright-tests/${product}/.auth/state.json`;
    if (!existsSync(path.resolve(root, sessionFile))) next.push(`npx atf login ${product}   # Microsoft Edge opens on the target: sign in yourself (SSO/MFA included) within 60 seconds; it closes by itself and saves the session`);
  }

  const config = {
    product,
    about: { name, visibility, ...(str(a.description) ? { description: str(a.description) } : {}) },
    // the step menu's answer; `run-config.mjs set` rewrites only this key when the human changes it later
    ...(Array.isArray(a.steps) ? { steps: list(a.steps) } : {}),
    target: { url, ...(apiHosts.length ? { api_urls: apiHosts } : {}) },
    ...(specs.length ? { api: { specs } } : {}),
    ...(refs.files.length ? { feature: { requirement_docs: refs.files } } : {}),
    knowledge: { references: uniq([url, ...refs.links]) },
    modules,
    ...(Object.keys(testcases).length ? { testcases } : {}),
    // These four keys keep their indentation and one-line shape: the login (lib/login.mjs) rewrites two of them in place.
    authorizations: { mode: "readonly", authenticated_crawl: needsLogin, credentials_file: credFile, session_state_file: sessionFile },
  };

  const target = `config/${product}.yaml`;
  if (product && exists(path.resolve(root, target))) errors.push(`${target} already exists: edit it, or pick another product name`);
  return { errors, warnings, product, file: target, config, next };
}

// ---------- `run-config.mjs set`: the step menu's answer and the human's test case files, written into a config ----------
// changes: { steps?: [step], testcasesFiles?: {<slug>: path|null}, testcasesImport?: path|null, testcasesTypes?: [type] }

// The config object with the changes applied (what validateRunConfig checks before anything is written). -> {config, errors}
export function applyChanges(cfg, changes) {
  const config = structuredClone(cfg ?? {});
  const errors = [];
  if (changes.steps !== undefined) config.steps = changes.steps;
  for (const [slug, file] of Object.entries(changes.testcasesFiles ?? {})) {
    const m = Array.isArray(config.modules) ? config.modules.find((x) => x?.slug === slug) : null;
    if (!m) errors.push(`--testcases-file ${slug}: not a module of this config (${(config.modules ?? []).map((x) => x?.slug).join(", ")})`);
    else m.testcases_file = file;
  }
  if (changes.testcasesImport !== undefined || changes.testcasesTypes !== undefined) {
    config.testcases = { ...(config.testcases ?? {}) };
    if (changes.testcasesImport !== undefined) config.testcases.import = changes.testcasesImport;
    if (changes.testcasesTypes !== undefined) config.testcases.types = changes.testcasesTypes;
  }
  return { config, errors };
}

const indentOf = (l) => /^ */.exec(l)[0].length;
const skippable = (l) => /^\s*(#.*)?$/.test(l); // a blank or comment line
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The key at this indent, also as the first key of a sequence item ("  - slug: x" has slug at indent 4).
const keyAt = (line, indent, key) => /^ *(- )?$/.test(line.slice(0, indent)) && line.length > indent && new RegExp(`^${escapeRe(key)}:(\\s|$)`).test(line.slice(indent));
// End (exclusive) of the value of the key on line i at `indent`: the deeper lines that follow, or sequence items at the
// same indent; blank and comment lines count only inside the block.
function blockEnd(lines, i, indent) {
  let end = i + 1;
  for (let j = i + 1; j < lines.length; j++) {
    if (skippable(lines[j])) continue;
    const n = indentOf(lines[j]);
    if (n > indent || (n === indent && /^ *-( |$)/.test(lines[j]))) end = j + 1;
    else break;
  }
  return end;
}
// Where the inline comment of a line starts (a # after whitespace, outside quotes), or -1.
function commentAt(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === "'" || c === '"') q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}
// The value after "key:" on a line, without its comment and quotes.
const inlineValue = (line, indent, key) => {
  const rest = line.slice(indent + key.length + 1);
  const c = commentAt(rest);
  return (c < 0 ? rest : rest.slice(0, c)).trim().replace(/^(['"])(.*)\1$/, "$2");
};
// A YAML value for a list of slugs, a path or null.
const PLAIN_RE = /^[A-Za-z0-9_][A-Za-z0-9_./\\:@+-]*$/;
const RESERVED_RE = /^(null|~|true|false|yes|no|on|off|[-+]?[0-9.]+(e[-+]?[0-9]+)?)$/i;
export const yamlValue = (v) => (v === null ? "null" : Array.isArray(v) ? `[${v.map(yamlValue).join(", ")}]` : PLAIN_RE.test(v) && !RESERVED_RE.test(v) && !/:$/.test(v) ? v : JSON.stringify(v));

// Sets `key: value` among lines [from, to) at `indent`: replaces the key's line and its value block (the line's prefix
// and its inline comment kept, the comment at its column), or inserts the key at `insertAt`.
function setKey(lines, { from, to, indent, key, value, insertAt }) {
  for (let i = from; i < to; i++) {
    if (!keyAt(lines[i], indent, key)) continue;
    const end = blockEnd(lines, i, indent);
    const at = commentAt(lines[i].slice(indent + key.length + 1));
    const head = `${lines[i].slice(0, indent)}${key}: ${value}`;
    const col = at < 0 ? -1 : indent + key.length + 1 + at;
    lines.splice(i, end - i, at < 0 ? head : `${head.padEnd(col - 1)} ${lines[i].slice(col)}`);
    return;
  }
  // after the comment lines that continue the line before (indented deeper than the new key)
  while (insertAt < lines.length && /^\s*#/.test(lines[insertAt]) && indentOf(lines[insertAt]) > indent) insertAt++;
  lines.splice(insertAt, 0, `${" ".repeat(indent)}${key}: ${value}`);
}

const topKey = (lines, key) => lines.findIndex((l) => keyAt(l, 0, key));
// A block mapping's child indent (its first child line's), or the default.
function childIndent(lines, i, fallback = 2) {
  for (let j = i + 1; j < blockEnd(lines, i, 0); j++) if (!skippable(lines[j])) return indentOf(lines[j]);
  return fallback;
}
// A one-line flow-style item `- {slug: x, ...}` (an optional comment after it): its prefix, the {...} text, the rest.
const FLOW_ITEM = /^( *- )(\{.*\})(\s*(?:#.*)?)$/;
function flowSlug(text) {
  try {
    const v = yaml.load(text);
    return v && typeof v === "object" && !Array.isArray(v) && typeof v.slug === "string" ? v.slug : null;
  } catch {
    return null;
  }
}
// Sets `key: value` inside a one-line {...} mapping: the key's value replaced, or `, key: value` added before the
// closing brace; every other character stays. -> the new line
function setFlowKey(line, key, value) {
  const [, pre, map, post] = FLOW_ITEM.exec(line);
  const at = new RegExp(`([{,]\\s*${escapeRe(key)}:[ \\t]*)("(?:[^"\\\\]|\\\\.)*"|'(?:[^']|'')*'|[^,}]*?)(\\s*[,}])`).exec(map);
  const next = at ? `${map.slice(0, at.index)}${at[1]}${value}${at[3]}${map.slice(at.index + at[0].length)}` : `${map.slice(0, -1).replace(/\s*$/, "")}, ${key}: ${value}}`;
  return `${pre}${next}${post}`;
}
// The items of the top-level `modules` sequence: [{start, end, keyIndent, slug, flow}] (flow: a one-line {...} item).
function moduleItems(lines) {
  const mi = topKey(lines, "modules");
  if (mi < 0) return [];
  const mEnd = blockEnd(lines, mi, 0);
  const starts = [];
  for (let j = mi + 1; j < mEnd; j++) if (!skippable(lines[j]) && /^ *- /.test(lines[j]) && (!starts.length || indentOf(lines[j]) === indentOf(lines[starts[0]]))) starts.push(j);
  return starts.map((start, n) => {
    const end = starts[n + 1] ?? mEnd;
    const keyIndent = indentOf(lines[start]) + 2;
    const f = FLOW_ITEM.exec(lines[start]);
    if (f && end - start === 1 + lines.slice(start + 1, end).filter(skippable).length) return { start, end, keyIndent, slugLine: start, slug: flowSlug(f[2]), flow: true };
    let slugLine = -1;
    for (let j = start; j < end; j++) if (keyAt(lines[j], keyIndent, "slug")) slugLine = j;
    return { start, end, keyIndent, slugLine, slug: slugLine < 0 ? null : inlineValue(lines[slugLine], keyIndent, "slug") };
  });
}

// Rewrites only the changed keys of a config's text: `steps` (inserted after `product` when absent), a module's
// `testcases_file` (after its slug), `testcases.import` and `testcases.types` (a `testcases:` block appended when
// absent). A module item may also be one {...} mapping on a single line (the key set inside it); a {...} mapping over
// several lines, or an inline `testcases: {...}`, is reported, not rewritten. -> {text, errors}
export function rewriteKeys(text, changes) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const errors = [];
  if (changes.steps !== undefined) {
    const p = topKey(lines, "product");
    setKey(lines, { from: 0, to: lines.length, indent: 0, key: "steps", value: yamlValue(changes.steps), insertAt: p < 0 ? 0 : blockEnd(lines, p, 0) });
  }
  for (const [slug, file] of Object.entries(changes.testcasesFiles ?? {})) {
    const item = moduleItems(lines).find((x) => x.slug === slug);
    if (!item) {
      errors.push(`modules: no item with slug ${slug} that set can rewrite (one key per line, or one {...} mapping on a single line); nothing was written. Add \`testcases_file: ${yamlValue(file)}\` to that module's item by hand, or use --testcases-import <path> with the cases tagged @module:${slug}`);
      continue;
    }
    if (item.flow) {
      lines[item.start] = setFlowKey(lines[item.start], "testcases_file", yamlValue(file));
      continue;
    }
    setKey(lines, { from: item.start, to: item.end, indent: item.keyIndent, key: "testcases_file", value: yamlValue(file), insertAt: item.slugLine + 1 });
  }
  const tc = [["import", changes.testcasesImport], ["types", changes.testcasesTypes]].filter(([, v]) => v !== undefined);
  if (tc.length) {
    let ti = topKey(lines, "testcases");
    if (ti >= 0 && inlineValue(lines[ti], 0, "testcases").startsWith("{")) errors.push("testcases: written inline as {...}; give it one key per line, then run set again");
    else {
      if (ti < 0) {
        while (lines.length && lines.at(-1) === "") lines.pop();
        lines.push("", "testcases:", "");
        ti = lines.length - 2;
      }
      const indent = childIndent(lines, ti);
      for (const [key, v] of tc) setKey(lines, { from: ti + 1, to: blockEnd(lines, ti, 0), indent, key, value: yamlValue(v), insertAt: blockEnd(lines, ti, 0) });
    }
  }
  return { text: lines.join(eol), errors };
}
