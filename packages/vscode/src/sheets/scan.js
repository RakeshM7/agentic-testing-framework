// What the two trees show, read from the artifacts: the products, their modules and each module's sheet, with
// counts. Node fs only (no vscode), so the counts are tested with node:test. Reads only.
//
// Paths are the artifact contract's (layout v2): artifacts/<product>/modules/<module>/clarifications.csv and
// artifacts/<product>/modules/<module>/testcases/{approval.csv, coverage.json, approvals.json}. The sheets are shared
// by every environment (D-081), so there is no env level.
import { promises as fsp } from "node:fs";
import path from "node:path";
import * as clar from "./clarifications.js";
import * as appr from "./approval.js";
import { decodeSheet } from "./csv.js";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/; // the contract's product and module slugs; anything else is not ours

export const sheetPaths = (root, product, module) => {
  const dir = path.join(root, "artifacts", product, "modules", module);
  const tc = path.join(dir, "testcases");
  return {
    moduleDir: dir,
    clarifications: path.join(dir, "clarifications.csv"),
    evidenceDir: path.join(dir, "clarification-evidence"),
    approval: path.join(tc, "approval.csv"),
    coverage: path.join(tc, "coverage.json"),
    approvals: path.join(tc, "approvals.json"),
  };
};

async function dirs(dir, fs) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && SLUG.test(d.name)).map((d) => d.name).sort();
  } catch {
    return [];
  }
}
async function readText(file, fs) {
  try {
    return decodeSheet(await fs.readFile(file));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
export async function readJsonFile(file, fs = fsp) {
  const t = await readText(file, fs);
  return t === null ? null : JSON.parse(t.replace(/^﻿/, ""));
}

// -> [{ product, module }] for every module folder of every product
export async function listModules(root, { fs = fsp } = {}) {
  const out = [];
  for (const product of await dirs(path.join(root, "artifacts"), fs)) for (const module of await dirs(path.join(root, "artifacts", product, "modules"), fs)) out.push({ product, module });
  return out;
}

const sum = (xs, keys) => Object.fromEntries(keys.map((k) => [k, xs.reduce((n, x) => n + (x.counts?.[k] ?? 0), 0)]));
function byProduct(mods, keys) {
  const products = new Map();
  for (const m of mods) {
    if (!products.has(m.product)) products.set(m.product, []);
    products.get(m.product).push(m);
  }
  return [...products].map(([product, modules]) => ({ product, modules, counts: sum(modules, keys) }));
}

// The clarifications tree: product -> module -> the rows a human needs to act on (open, or awaiting approval).
// A module whose file can't be read (bad header, mid-save) is listed with its error, so the human sees why.
export async function scanClarifications(root, { fs = fsp } = {}) {
  const mods = [];
  for (const { product, module } of await listModules(root, { fs })) {
    const file = sheetPaths(root, product, module).clarifications;
    let text;
    try {
      text = await readText(file, fs);
    } catch (e) {
      mods.push({ product, module, file, error: e.message, counts: null, rows: [] });
      continue;
    }
    if (text === null) continue;
    try {
      const model = clar.readClarifications(text);
      const rows = model.rows.filter((r) => r.state !== "answered").map((r) => ({ id: r.id.trim(), question: r.question, state: r.state }));
      mods.push({ product, module, file, error: null, counts: clar.counts(model), rows });
    } catch (e) {
      mods.push({ product, module, file, error: e.message, counts: null, rows: [] });
    }
  }
  return byProduct(mods, ["total", "open", "proposed", "answered"]);
}

// The approval tree: product -> module -> the cases with no decision on their current content.
export async function scanApprovals(root, { fs = fsp } = {}) {
  const mods = [];
  for (const { product, module } of await listModules(root, { fs })) {
    const p = sheetPaths(root, product, module);
    try {
      const [text, coverage, approvals] = [await readText(p.approval, fs), await readJsonFile(p.coverage, fs), await readJsonFile(p.approvals, fs)];
      if (text === null && !coverage) continue;
      const sheet = text === null ? null : appr.readApprovalSheet(text);
      const cmp = sheet ? appr.compare(sheet, coverage, approvals) : appr.compare({ rows: [] }, coverage, approvals);
      const titles = new Map((coverage?.cases ?? []).map((c) => [c.id, c.title]));
      mods.push({
        product, module, file: p.approval, exists: !!sheet, built: !!coverage, error: null,
        stale: cmp.stale, counts: { ...cmp.counts, stale: cmp.stale ? 1 : 0 },
        pending: cmp.pending.map((id) => ({ id, title: titles.get(id) ?? "" })),
      });
    } catch (e) {
      mods.push({ product, module, file: p.approval, exists: true, built: false, error: e.message, stale: false, counts: null, pending: [] });
    }
  }
  return byProduct(mods, ["cases", "pending", "approved", "rejected", "changes", "toRecord", "stale"]);
}

// "3 open · 1 awaiting · 5 answered" and "4 pending · 2 approved": the tree items' descriptions.
export function clarificationsLabel(c) {
  if (!c) return "unreadable";
  return [`${c.open} open`, `${c.proposed} awaiting approval`, `${c.answered} answered`].join(" · ");
}
export function approvalsLabel(c, { stale = false } = {}) {
  if (!c) return "unreadable";
  return [`${c.pending} pending`, `${c.approved} approved`, ...(c.rejected ? [`${c.rejected} rejected`] : []), ...(c.changes ? [`${c.changes} changes`] : []), ...(c.toRecord ? [`${c.toRecord} to record`] : []), ...(stale ? ["sheet out of date"] : [])].join(" · ");
}

// ---------- a clarification row's evidence ----------

// Never offered, even inside an evidence folder: credentials and saved sessions (the extension shows no secrets).
const SECRET = /(^|\/)(\.env[^/]*|\.auth)(\/|$)|\.(pem|key|p12|pfx)$/i;

// The files a human can open for a row: the "Evidence:" paths its notes name, then every file in the row's
// clarification-evidence/<ID>/ folder (observation.md, snapshots, network and console captures, screenshots).
// -> module-relative paths with "/" (knowledge/... ones are relative to the product, as the contract writes them)
export async function evidenceFiles(root, product, module, row, { fs = fsp } = {}) {
  const out = new Set(clar.evidenceRefs(row).filter((f) => !SECRET.test(f)));
  const id = String(row.id ?? "").trim();
  if (/^[a-z0-9]+(-[a-z0-9]+)*-\d+$/.test(id)) {
    try {
      const dir = path.join(sheetPaths(root, product, module).evidenceDir, id);
      for (const d of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name)))
        if (d.isFile() && !SECRET.test(d.name)) out.add(`clarification-evidence/${id}/${d.name}`);
    } catch {}
  }
  return [...out];
}

// A path the webview asked to open, resolved only when it is one evidenceFiles() offered for that row and stays inside
// the module's folder (or the product's knowledge/). -> absolute path | null
export function resolveEvidence(root, product, module, offered, rel) {
  if (!offered.includes(rel) || SECRET.test(rel) || path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) return null;
  const base = rel.startsWith("knowledge/") ? path.join(root, "artifacts", product) : sheetPaths(root, product, module).moduleDir;
  const abs = path.resolve(base, ...rel.split("/"));
  const inside = path.relative(base, abs);
  return inside && !inside.startsWith("..") && !path.isAbsolute(inside) ? abs : null;
}
