// Worker requests (G10): shared-file change requests for pw-repo-owner, missing page-object or client methods and lib
// exports, foundation gaps. A worker adds them through `scripts/requests.mjs add`, which assigns the stable id, dedupes
// and validates; `orchestration.mjs next` turns the pending ones into steps (handler agent, prompt, once-limits, repo-owner
// lock) and records how each ended. File: results/<run>/<module>/<domain>/requests.json, schemas/requests.schema.json.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { SLUG_RE } from "./contract.mjs";
import { withFileLock, writeAtomic } from "./csv.mjs";

export const KINDS = ["repo-change", "missing-method", "lib-export", "foundation-gap"];
export const STATUSES = ["pending", "handled", "declined"];
export const REPO_OWNER = "pw-repo-owner";

// Which agent handles which kind, per domain. A kind absent from a domain's row is refused when added.
export const HANDLERS = {
  "playwright-ui": { "repo-change": REPO_OWNER, "missing-method": "pw-ui-pom-writer", "foundation-gap": "pw-ui-scaffolder" },
  "playwright-api": { "repo-change": REPO_OWNER, "missing-method": "pw-api-client-writer", "foundation-gap": "pw-api-scaffolder" },
  k6: { "lib-export": "k6-lib-writer", "foundation-gap": "k6-lib-writer" },
};
// Handler rounds a domain spends per kind in one run (D-011): a foundation gap gets one round per build.
export const KIND_LIMITS = { "foundation-gap": 1, "repo-change": 2, "missing-method": 2, "lib-export": 2 };

export const requestsPath = (productDir, runId, module, domain) => path.join(productDir, "results", runId, module, domain, "requests.json");

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[\s.;:!]+$/, "").trim();
export const requestKey = (r) => [r.kind, norm(r.target), norm(r.summary)].join("|");
export const requestId = (r) => `RQ-${createHash("sha1").update(requestKey(r)).digest("hex").slice(0, 8)}`;

export function readRequests(file, domain, module) {
  const empty = { version: 1, domain, module, requests: [] };
  if (!existsSync(file)) return empty;
  const d = JSON.parse(readFileSync(file, "utf8"));
  return { ...empty, ...d, requests: Array.isArray(d.requests) ? d.requests : [] };
}

const text = (v, max) => typeof v === "string" && v.trim() && v.length <= max;

// Problems with one new entry ({kind, target, summary, detail?, files?}) for a domain, as strings.
export function entryProblems(domain, e, from) {
  const out = [];
  const handlers = HANDLERS[domain];
  if (!handlers) return [`domain must be one of [${Object.keys(HANDLERS)}]`];
  if (!SLUG_RE.test(from ?? "")) out.push("from must be the asking agent's name (kebab-case)");
  if (!KINDS.includes(e?.kind)) out.push(`kind must be one of [${KINDS}]`);
  else if (!handlers[e.kind]) out.push(`${domain} has no handler for kind '${e.kind}' (its kinds: ${Object.keys(handlers)})`);
  if (!text(e?.target, 300)) out.push("target is required (at most 300 characters)");
  if (!text(e?.summary, 300)) out.push("summary is required (at most 300 characters)");
  if (e?.detail !== undefined && !text(e.detail, 4000)) out.push("detail must be text of at most 4000 characters");
  if (e?.files !== undefined && !(Array.isArray(e.files) && e.files.every((f) => typeof f === "string" && f))) out.push("files must be a list of paths");
  return out;
}

// Appends the valid entries; a request whose dedupe key exists already (whatever its status) is not added again and is
// reported with the existing id and status. -> {added: [id], duplicates: [{id, status}], errors: [string]}
export function addRequests(file, domain, module, entries, { from, now = () => new Date().toISOString() } = {}) {
  const errors = [];
  const valid = [];
  entries.forEach((e, i) => {
    const p = entryProblems(domain, e, from);
    if (p.length) errors.push(...p.map((m) => `request ${i + 1}: ${m}`));
    else valid.push(e);
  });
  if (errors.length) return { added: [], duplicates: [], errors };
  return withFileLock(file, () => {
    const doc = readRequests(file, domain, module);
    const byId = new Map(doc.requests.map((r) => [r.id, r]));
    const added = [];
    const duplicates = [];
    for (const e of valid) {
      const id = requestId(e);
      if (byId.has(id)) {
        duplicates.push({ id, status: byId.get(id).status });
        continue;
      }
      const r = { id, kind: e.kind, from, target: e.target.trim(), summary: e.summary.trim(), ...(e.detail ? { detail: e.detail } : {}), ...(e.files?.length ? { files: e.files } : {}), status: "pending", addedAt: now() };
      doc.requests.push(r);
      byId.set(id, r);
      added.push(id);
    }
    if (added.length) writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
    return { added, duplicates, errors: [] };
  });
}

// Sets the status of pending requests (handled or declined) with the step and a note.
export function resolveRequests(file, domain, module, ids, status, { step, note } = {}) {
  if (!STATUSES.includes(status) || status === "pending") throw new Error("status must be handled|declined");
  return withFileLock(file, () => {
    const doc = readRequests(file, domain, module);
    for (const r of doc.requests) if (ids.includes(r.id) && r.status === "pending") Object.assign(r, { status, ...(step ? { step } : {}), ...(note ? { note } : {}) });
    writeAtomic(file, JSON.stringify(doc, null, 2) + "\n");
    return doc;
  });
}

// ---------- the pw-repo-owner lock: one change-request step at a time per product, across the UI and API domains ----------
// {runId, holder: "<domain>/<module>", step}. Free when absent, from another run, or when `isActive(lock)` says its holder's
// step is no longer running (a crashed or abandoned holder cannot block the product for good).
export function acquireRepoOwner(file, runId, holder, step, { isActive = () => true } = {}) {
  return withFileLock(file, () => {
    const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    if (cur && cur.runId === runId && cur.holder !== holder && isActive(cur)) return { acquired: false, heldBy: cur };
    writeAtomic(file, JSON.stringify({ runId, holder, step, at: new Date().toISOString() }, null, 2) + "\n");
    return { acquired: true };
  });
}

export function releaseRepoOwner(file, runId, holder) {
  return withFileLock(file, () => {
    const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
    if (!cur || cur.runId !== runId || cur.holder !== holder) return false;
    unlinkSync(file);
    return true;
  });
}

export const pendingRequests = (file, domain, module) => readRequests(file, domain, module).requests.filter((r) => r.status === "pending");

// What done reports: counts and the entries that did not end handled.
export function requestsSummary(file, domain, module) {
  const rs = readRequests(file, domain, module).requests;
  const count = (s) => rs.filter((r) => r.status === s).length;
  return { total: rs.length, handled: count("handled"), declined: count("declined"), pending: count("pending"), open: rs.filter((r) => r.status !== "handled").map(({ id, kind, from, target, summary, status, note }) => ({ id, kind, from, target, summary, status, ...(note ? { note } : {}) })) };
}
