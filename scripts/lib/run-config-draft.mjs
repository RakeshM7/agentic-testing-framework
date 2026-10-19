// Turns the answers of the orchestrator's short run-config interview into a run-config (D-063).
// Pure: no file writes (scripts/run-config.mjs `draft` validates and writes). Answers hold paths and URLs, never secret
// values (D-012), and the draft is always `authorizations.mode: readonly` (D-004): full-run is a human edit, never inferred.
//
// answers: { name, visibility: public|internal, description?, url, overview_url?, api?: [url|path],
//            modules: [name | {name, url?, references?}], references?: [url|path],
//            login?: { needed: bool, credentials_file?, session_state_file? } }

import { existsSync } from "node:fs";
import path from "node:path";
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
    modules.push(entry);
  });

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
    if (!existsSync(path.resolve(root, sessionFile))) next.push(`make login PRODUCT=${product}   # a browser opens: log in yourself (MFA/CAPTCHA included), then close the window`);
  }

  const config = {
    product,
    about: { name, visibility, ...(str(a.description) ? { description: str(a.description) } : {}) },
    target: { url, ...(apiHosts.length ? { api_urls: apiHosts } : {}) },
    ...(specs.length ? { api: { specs } } : {}),
    ...(refs.files.length ? { feature: { requirement_docs: refs.files } } : {}),
    knowledge: { references: uniq([url, ...refs.links]) },
    modules,
    // These four keys keep their indentation and one-line shape: `make login` rewrites two of them with sed.
    authorizations: { mode: "readonly", authenticated_crawl: needsLogin, credentials_file: credFile, session_state_file: sessionFile },
  };

  const target = `config/${product}.yaml`;
  if (product && exists(path.resolve(root, target))) errors.push(`${target} already exists: edit it, or pick another product name`);
  return { errors, warnings, product, file: target, config, next };
}
