// What a run left behind, kept per run (D-078). Working files under artifacts/<product>/ (knowledge, modules, foundation)
// and the product's test code are overwritten by later runs; `run.mjs end` records a manifest of them -- the sha256 and
// size of every file -- in results/<run>/manifest.json, and `run.mjs diff` compares two runs' manifests. It can show
// what changed between runs, not restore an old file. Secrets stay out: no .auth/ or .env file is read, and no
// installed or generated-at-run-time folder (node_modules, test-results, reports) is walked.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./files.mjs";

export const MANIFEST = "manifest.json";
const SKIP_DIRS = new Set(["node_modules", "test-results", "playwright-report", "blob-report", ".auth", ".git", "results"]);
const SKIP_FILE = /(^|[\\/])\.env(\.|$)/;

// The areas a manifest covers, each a folder relative to the repo root.
export const areas = (product) => ({
  knowledge: `artifacts/${product}/knowledge`,
  modules: `artifacts/${product}/modules`,
  foundation: `artifacts/${product}/foundation`,
  playwright: `playwright-tests/${product}`,
  k6: `k6-tests/${product}`,
});

function walk(dir, base, out) {
  if (!existsSync(dir)) return out;
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const f = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) walk(f, base, out);
    } else if (d.isFile() && !SKIP_FILE.test(d.name)) {
      const buf = readFileSync(f);
      out[path.relative(base, f).replaceAll("\\", "/")] = { sha256: createHash("sha256").update(buf).digest("hex"), size: buf.length };
    }
  }
  return out;
}

// -> {runId, at, files: {<repo-relative path>: {sha256, size}}}
export function buildManifest(root, product, runId, at = new Date().toISOString()) {
  const files = {};
  for (const rel of Object.values(areas(product))) walk(path.join(root, rel), root, files);
  return { runId, at, files };
}

export function writeManifest(root, product, resultsDir, runId) {
  const m = buildManifest(root, product, runId);
  writeJson(path.join(resultsDir, MANIFEST), m);
  return { file: path.relative(root, path.join(resultsDir, MANIFEST)).replaceAll("\\", "/"), files: Object.keys(m.files).length };
}

export const readManifest = (resultsDir) => readJson(path.join(resultsDir, MANIFEST), null);

// What changed from manifest `a` to manifest `b`, per area. -> {from, to, areas: {<area>: {added, removed, changed}}, totals}
export function diffManifests(a, b, product) {
  const out = {};
  const totals = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const areaOf = (f) => Object.entries(areas(product)).find(([, rel]) => f === rel || f.startsWith(`${rel}/`))?.[0] ?? "other";
  const bump = (f, kind) => {
    const k = areaOf(f);
    out[k] ??= { added: [], removed: [], changed: [] };
    out[k][kind].push(f);
    totals[kind]++;
  };
  for (const f of Object.keys(b.files).sort()) {
    if (!(f in a.files)) bump(f, "added");
    else if (a.files[f].sha256 !== b.files[f].sha256) bump(f, "changed");
    else totals.unchanged++;
  }
  for (const f of Object.keys(a.files).sort()) if (!(f in b.files)) bump(f, "removed");
  return { from: a.runId, to: b.runId, areas: out, totals };
}
