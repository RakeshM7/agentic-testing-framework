// A module's endpoint catalogue: artifacts/<product>/modules/<m>/api/ (docs/agent-handoffs.md §4, decision D-045).
//
//   discovered-endpoints.json   the catalogue (schema discovered-endpoints) -- written only by build()
//   coverage.json               every input mapped to an EP id or excluded with a reason (schema api-coverage)
//   drift.json                  documented vs observed differences, one stable id each
//   registry.json               endpoint key -> EP id, assigned once and never reused (stable across runs)
//   overlay.json                the api-discoverer's judgments (schema api-overlay): scope, docs-only endpoints,
//                               annotations, links, exclusions -- the only file the agent writes itself
//   sources/                    fetched specs and introspection results, index.json, probes.json (script-owned)
//
// Rules enforced here (not in prompts):
//   - an endpoint's key is its method + path with parameter names erased ("GET /api/contacts/{}"), prefixed with the
//     host when it is not the target's; GraphQL operations are "GQL <query|mutation|subscription> <root field>"
//   - ids come from the registry: EP-<m>-<n>, assigned in key order, never renumbered; endpoints that disappear are
//     marked gone and their ids are never reused
//   - every spec operation, network-inventory entry, docs endpoint and GraphQL root field is either mapped to an id or
//     excluded with a reason code; build() fails if any input is unaccounted for
//   - non-GET REST operations always mutate; the overlay can raise `mutates`, never lower it
//   - traffic gives key names only, so types and schemas come only from a spec

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { writeAtomic, withFileLock } from "./csv.mjs";
import { operationsFromIntrospection } from "./graphql.mjs";
import { parseSpec, specVersion } from "./openapi.mjs";
import { assignIds } from "./registry.mjs";

export const EXCLUSION_REASONS = ["third_party", "static_asset", "preflight", "telemetry", "health", "auth_plumbing", "page_navigation", "out_of_module", "duplicate", "deprecated", "not_api"];
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const VERSION_RE = /^v\d+(\.\d+)*$/i;
const PREFIXES = new Set(["api", "apis", "rest", "services", "service", "public", "internal", "ajax", "json", "rpc", "data", "graphql"]);
const ACTION_WORDS = new Set(["search", "filter", "filtered_search", "bulk", "merge", "export", "import", "upload", "count", "batch", "query", "autocomplete", "lookup", "suggest", "clone", "copy", "move", "assign", "convert"]);
const QUERY_WORDS = new Set(["search", "filter", "filtered_search", "query", "autocomplete", "lookup", "suggest", "count"]);
const AUTH_RESOURCES = new Set(["login", "logout", "signin", "signout", "oauth", "oauth2", "token", "tokens", "session", "sessions", "sso", "saml", "csrf", "auth", "authorize", "openid", ".well-known", "refresh"]);
const HEALTH = new Set(["health", "healthz", "healthcheck", "ping", "status", "ready", "readyz", "livez", "alive"]);
const TELEMETRY = new Set(["collect", "analytics", "telemetry", "tracking", "beacon", "rum", "sentry", "envelope", "gtm", "pixel", "heartbeat", "metrics"]);
const STATIC_RE = /\.(m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|txt|html?)$/i;
const PAGINATION = {
  cursor: ["cursor", "after", "before", "page_token", "pagetoken", "next_token", "nexttoken", "continuation", "starting_after", "ending_before"],
  offset: ["offset", "skip", "start"],
  page: ["page", "page_number", "pagenumber"],
  size: ["per_page", "perpage", "page_size", "pagesize", "limit", "size", "count", "top"],
};

export function apiPaths(productDir, module) {
  const m = path.join(productDir, "modules", module);
  const dir = path.join(m, "api");
  const sources = path.join(dir, "sources");
  return {
    dir,
    catalogue: path.join(dir, "discovered-endpoints.json"),
    coverage: path.join(dir, "coverage.json"),
    drift: path.join(dir, "drift.json"),
    registry: path.join(dir, "registry.json"),
    overlay: path.join(dir, "overlay.json"),
    sources,
    sourcesIndex: path.join(sources, "index.json"),
    probes: path.join(sources, "probes.json"),
    inventory: path.join(m, "explore", "network-inventory.json"),
    sitemap: path.join(m, "explore", "sitemap.json"),
  };
}

export const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback);
export const writeJson = (f, data) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeAtomic(f, JSON.stringify(data, null, 2) + "\n");
};
const uniq = (xs) => [...new Set(xs)];
const sortNum = (xs) => uniq(xs.map(Number).filter(Number.isFinite)).sort((a, b) => a - b);

// ---------- paths, keys, names ----------

const PARAM = /^\{[^}]*\}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Segments that are ids, not names: numbers, UUIDs, long hex, long mixed tokens with digits. `literals` (overlay
// pathRules.literals) are never parameterized.
export function isIdSegment(s, literals = []) {
  if (literals.includes(s) || VERSION_RE.test(s)) return false;
  return /^\d+$/.test(s) || UUID.test(s) || /^[0-9a-f]{16,}$/i.test(s) || (s.length >= 20 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s));
}

// A path (or absolute URL) -> {origin|null, path}: no query or fragment, single slashes, no trailing slash, ids as {id}.
export function normalizePath(raw, { literals = [] } = {}) {
  let origin = null;
  let p = String(raw).trim();
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    origin = u.origin.toLowerCase();
    p = u.pathname;
  }
  p = p.split(/[?#]/)[0].replace(/\/{2,}/g, "/");
  const segs = p.split("/").filter(Boolean).map((s) => (PARAM.test(s) ? s : isIdSegment(s, literals) ? "{id}" : s));
  return { origin, path: "/" + segs.join("/") };
}

export const erase = (p) => p.replace(/\{[^}]*\}/g, "{}");
export const segments = (p) => p.split("/").filter(Boolean);

export function restKey(method, origin, p, primaryOrigin) {
  const host = origin && origin !== primaryOrigin ? "//" + new URL(origin).host : "";
  return `${method.toUpperCase()} ${host}${erase(p)}`;
}
export const graphqlKey = (operationType, field) => `GQL ${operationType} ${field}`;

// Lowercase, no separators, singular -- so "Sales Accounts", "sales_accounts" and "salesAccount" compare equal.
export function nameKey(s) {
  const n = String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.endsWith("ies") && n.length > 4) return n.slice(0, -3) + "y";
  if (/(sses|xes|ches|shes)$/.test(n)) return n.slice(0, -2);
  if (n.endsWith("s") && !n.endsWith("ss") && n.length > 3) return n.slice(0, -1);
  return n;
}
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);

// Literal resource segments after leading api/version prefixes.
export function literalSegments(p) {
  const segs = segments(p);
  let i = 0;
  while (i < segs.length && (PREFIXES.has(segs[i].toLowerCase()) || VERSION_RE.test(segs[i]))) i++;
  return segs.slice(i).filter((s) => !PARAM.test(s));
}
export const rootResource = (p) => literalSegments(p)[0] ?? null;

// The resource an operation acts on: the last literal that is not an action word.
export function leafResource(p) {
  const lits = literalSegments(p).filter((s) => !ACTION_WORDS.has(s.toLowerCase()));
  return lits.at(-1) ?? null;
}

export function crudOf(method, p) {
  const segs = segments(p);
  const last = segs.at(-1) ?? "";
  const lastIsParam = PARAM.test(last);
  const action = !lastIsParam && (ACTION_WORDS.has(last.toLowerCase()) || (segs.length > 1 && PARAM.test(segs.at(-2)) && literalSegments(p).length > 1 && method === "POST"));
  if (action) return "action";
  if (method === "GET") return lastIsParam ? "read" : "list";
  if (method === "POST") return lastIsParam ? "action" : "create";
  if (method === "PUT" || method === "PATCH") return "update";
  if (method === "DELETE") return "delete";
  return "action";
}

// ---------- module scope ----------

export function moduleNames(module, cfg, overlay) {
  const entry = (cfg.modules ?? []).find((m) => m.slug === module) ?? {};
  return new Set([module, entry.name ?? "", ...(overlay.scope?.resources ?? []), ...(overlay.scope?.tags ?? [])].filter(Boolean).map(nameKey));
}

function otherModules(module, cfg) {
  const out = new Map();
  for (const m of cfg.modules ?? []) if (m.slug !== module) for (const n of [m.slug, m.name]) if (n) out.set(nameKey(n), m.slug);
  return out;
}

// overlay matchers: an EP id, an exact key, a path prefix ending in "*", or "tag:<name>"
function matcher(pattern) {
  if (pattern.startsWith("tag:")) {
    const t = nameKey(pattern.slice(4));
    return (x) => (x.tags ?? []).some((g) => nameKey(g) === t);
  }
  if (pattern.endsWith("*")) {
    const pre = pattern.slice(0, -1);
    return (x) => x.key.startsWith(pre) || (x.path ?? "").startsWith(pre);
  }
  return (x) => x.key === pattern || x.id === pattern;
}

// ---------- noise in the network inventory ----------

function isGraphqlEntry(e, cfg) {
  const p = normalizePath(e.pathTemplate ?? "").path;
  const configured = (cfg.api?.graphql ?? []).map((g) => normalizePath(g).path);
  return segments(p).at(-1)?.toLowerCase() === "graphql" || configured.includes(p) || (Array.isArray(e.graphql) && e.graphql.length > 0) || ((e.requestKeys ?? []).includes("query") && ((e.requestKeys ?? []).includes("variables") || (e.requestKeys ?? []).includes("operationName")));
}

export function noiseReason(e, { origin, p }, ctx) {
  const method = String(e.method ?? "").toUpperCase();
  if (method === "OPTIONS") return { reason: "preflight" };
  if (origin && !ctx.firstParty.includes(new URL(origin).hostname)) return { reason: "third_party", detail: new URL(origin).host };
  if (STATIC_RE.test(p)) return { reason: "static_asset" };
  const lits = literalSegments(p).map((s) => s.toLowerCase());
  const own = (s) => ctx.names.has(nameKey(s));
  if (segments(p).some((s) => TELEMETRY.has(s.toLowerCase()))) return { reason: "telemetry" };
  if (lits.length === 1 && HEALTH.has(lits[0]) && !own(lits[0])) return { reason: "health" };
  if (lits[0] && AUTH_RESOURCES.has(lits[0]) && !own(lits[0])) return { reason: "auth_plumbing" };
  if (method === "GET" && !(e.responseKeys ?? []).length && ctx.pagePaths.has(p)) return { reason: "page_navigation" };
  const root = lits[0];
  if (root && !own(root) && ctx.others.has(nameKey(root))) return { reason: "out_of_module", detail: `belongs to module '${ctx.others.get(nameKey(root))}'` };
  return null;
}

// ---------- overlay ----------

export const EMPTY_OVERLAY = { scope: { resources: [], tags: [], include: [], exclude: [] }, pathRules: { literals: [] }, endpoints: [], annotations: {}, links: { add: [], remove: [] }, defaults: {}, blocked: null };

export function readOverlay(file) {
  const o = readJson(file, {});
  return {
    ...EMPTY_OVERLAY,
    ...o,
    scope: { ...EMPTY_OVERLAY.scope, ...(o.scope ?? {}) },
    pathRules: { ...EMPTY_OVERLAY.pathRules, ...(o.pathRules ?? {}) },
    links: { ...EMPTY_OVERLAY.links, ...(o.links ?? {}) },
  };
}

// ---------- sources ----------

export function readSources(ap) {
  const index = readJson(ap.sourcesIndex, []);
  const specs = [];
  const graphql = [];
  const problems = [];
  for (const s of index) {
    if (!s.file) continue;
    const f = path.join(ap.sources, s.file);
    if (!existsSync(f)) {
      problems.push(`sources/index.json: ${s.id} points to missing ${s.file}`);
      continue;
    }
    if (s.kind === "openapi") specs.push({ ...s, doc: readJson(f) });
    else if (s.kind === "graphql") graphql.push({ ...s, result: readJson(f) });
  }
  return { index, specs, graphql, problems };
}

// Text of a spec document (JSON or YAML) -> object, or null if it is not a spec.
export function parseSpecText(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = yaml.load(text);
    } catch {
      return null;
    }
  }
  return specVersion(doc) ? doc : null;
}

// Register (or refresh) a fetched source: same location => same id. -> the index entry
export function saveSource(ap, { kind, location, content, ...meta }) {
  return withFileLock(ap.sourcesIndex, () => {
    const index = readJson(ap.sourcesIndex, []);
    let entry = index.find((s) => s.kind === kind && s.location === location);
    if (!entry) {
      const n = index.filter((s) => s.kind === kind).reduce((x, s) => Math.max(x, Number(s.id.split("-")[1])), 0) + 1;
      entry = { id: `${kind === "openapi" ? "spec" : "graphql"}-${n}`, kind, location };
      index.push(entry);
    }
    Object.assign(entry, meta);
    if (content !== undefined) {
      entry.file = `${entry.id}.json`;
      writeJson(path.join(ap.sources, entry.file), content);
    }
    writeJson(ap.sourcesIndex, index);
    return entry;
  });
}

const idNum = (id) => Number(id.split("-").at(-1));

// ---------- schema helpers ----------

const success = (status) => /^2(\d\d|XX)$/i.test(String(status));
function topProps(schema) {
  if (!schema || typeof schema !== "object") return null;
  const s = schema.type === "array" || schema.items ? schema.items ?? {} : schema;
  const all = [s, ...(s.allOf ?? [])];
  const props = Object.assign({}, ...all.map((x) => x?.properties ?? {}));
  const required = all.flatMap((x) => x?.required ?? []);
  return Object.keys(props).length ? { keys: Object.keys(props).sort(), required: uniq(required).sort(), array: schema.type === "array" } : null;
}
const statusMatches = (documented, s) => documented.some((d) => String(d) === String(s) || (/^\dXX$/i.test(d) && String(d)[0] === String(s)[0]));

function authOf(alternatives) {
  if (!alternatives) return null;
  if (!alternatives.length || alternatives.every((a) => !a.length)) return "none";
  const s = alternatives.find((a) => a.length)[0];
  if (s.type === "http") return s.scheme === "bearer" ? "bearer" : s.scheme === "basic" ? "basic" : "unknown";
  if (s.type === "apiKey") return s.in === "cookie" ? "session" : "api-key";
  if (s.type === "oauth2" || s.type === "openIdConnect") return "oauth2";
  return "unknown";
}

function paginationOf(params, keys, probe) {
  const names = params.filter((p) => p.in === "query").map((p) => String(p.name).toLowerCase());
  const k = (keys ?? []).map((x) => String(x).toLowerCase());
  const has = (list) => names.filter((n) => list.includes(n));
  if (has(PAGINATION.cursor).length || k.some((x) => /^next_?(cursor|page_?token)$|^nextcursor$/.test(x))) return { style: "cursor", params: [...has(PAGINATION.cursor), ...has(PAGINATION.size)] };
  if (has(PAGINATION.offset).length) return { style: "offset", params: [...has(PAGINATION.offset), ...has(PAGINATION.size)] };
  if (has(PAGINATION.page).length) return { style: "page", params: [...has(PAGINATION.page), ...has(PAGINATION.size)] };
  if (probe?.link) return { style: "link", params: [] };
  return null;
}

// ---------- build ----------

// ctx: {module, cfg, runId}. Reads everything from disk, writes catalogue, coverage, drift, registry.
// -> {problems[], summary}
export function build(ap, { module, cfg, runId }) {
  const problems = [];
  const overlay = readOverlay(ap.overlay);
  const literals = overlay.pathRules.literals ?? [];
  const primaryOrigin = new URL(cfg.target.url).origin.toLowerCase();
  const firstParty = uniq([cfg.target.url, ...(cfg.target.api_urls ?? [])].map((u) => new URL(u).hostname.toLowerCase()));
  const names = moduleNames(module, cfg, overlay);
  const ctx = {
    firstParty,
    names,
    others: otherModules(module, cfg),
    pagePaths: new Set(readJson(ap.sitemap, []).map((pg) => {
      try {
        return normalizePath(pg.url, { literals }).path;
      } catch {
        return null;
      }
    })),
  };
  const inventoryExists = existsSync(ap.inventory);
  const inventory = readJson(ap.inventory, []);
  const { index, specs, graphql, problems: srcProblems } = readSources(ap);
  problems.push(...srcProblems);
  const probes = readJson(ap.probes, { results: {} }).results ?? {};
  const graphqlGet = new Map(index.filter((s) => s.kind === "graphql").map((s) => [s.id, !!s.getSupported]));

  const mapped = []; // {input, key}
  const excluded = []; // {input, reason, detail?}
  const acc = new Map(); // key -> accumulator
  const get = (key, init) => {
    if (!acc.has(key)) acc.set(key, { key, specOps: [], inv: [], docs: [], gql: [], originFallback: false, ...init });
    return acc.get(key);
  };
  const excludeByOverlay = (x) => (overlay.scope.exclude ?? []).find((r) => matcher(r.match)(x));
  const includeByOverlay = (x) => (overlay.scope.include ?? []).some((p) => matcher(p)(x));

  // 0. classify the network inventory first: a spec operation the UI called in this module is in scope by definition
  const protocol = new URL(cfg.target.url).protocol;
  const inv = inventory.map((e, i) => {
    const method = String(e.method ?? "").toUpperCase();
    const input = `inventory:${i}:${method} ${e.pathTemplate}`;
    let n;
    try {
      n = normalizePath(e.host && !/^https?:/i.test(e.pathTemplate) ? `${protocol}//${e.host}${e.pathTemplate}` : e.pathTemplate, { literals });
    } catch {
      return { input, e, i, drop: { reason: "not_api", detail: "unparseable path" } };
    }
    const origin = n.origin ?? primaryOrigin;
    const item = { key: restKey(method, origin, n.path, primaryOrigin), path: n.path, tags: [] };
    const ex = excludeByOverlay(item);
    const noise = includeByOverlay(item) ? null : noiseReason(e, { origin: n.origin, p: n.path }, ctx);
    const drop = ex ? { reason: ex.reason, ...(ex.detail ? { detail: ex.detail } : {}) } : noise;
    return { input, e, i, method, origin, path: n.path, key: item.key, drop, graphql: !drop && isGraphqlEntry(e, cfg) };
  });
  const observedRest = inv.filter((x) => !x.drop && !x.graphql);
  const observedKeys = new Set(observedRest.map((x) => x.key));
  const observedNoOrigin = new Set(observedRest.map((x) => `${x.method} ${erase(x.path)}`));

  // 1. spec operations
  const specKeys = new Map(); // "METHOD erasedPath" (no origin) -> [keys], for the origin fallback
  for (const s of specs) {
    let parsed;
    try {
      parsed = parseSpec(s.doc, { location: s.location, fallbackOrigin: primaryOrigin });
    } catch (e) {
      problems.push(`${s.id} (${s.location}): ${e.message}`);
      continue;
    }
    for (const op of parsed.operations) {
      const origin = op.server?.origin ?? primaryOrigin;
      const full = ((op.server?.basePath ?? "") + op.path).replace(/\/{2,}/g, "/") || "/";
      const key = restKey(op.method, origin, full, primaryOrigin);
      const input = `spec:${s.id}:${op.method} ${op.path}`;
      const item = { key, path: full, tags: op.tags };
      const ex = excludeByOverlay(item);
      const inScope =
        includeByOverlay(item) ||
        observedKeys.has(key) ||
        observedNoOrigin.has(`${op.method} ${erase(full)}`) ||
        op.tags.some((t) => names.has(nameKey(t))) ||
        literalSegments(full).some((seg) => names.has(nameKey(seg)));
      if (ex) excluded.push({ input, reason: ex.reason, ...(ex.detail ? { detail: ex.detail } : {}) });
      else if (op.method === "OPTIONS" || op.method === "TRACE") excluded.push({ input, reason: "not_api", detail: `${op.method} is not tested` });
      else if (!inScope) excluded.push({ input, reason: "out_of_module" });
      else {
        const a = get(key, { kind: "rest", method: op.method, origin, path: full, basePath: op.server?.basePath ?? "" });
        if (a.specOps.length) excluded.push({ input, reason: "duplicate", detail: `same key as ${a.specOps[0].input}` });
        else {
          a.path = full; // spec parameter names win
          a.basePath = op.server?.basePath ?? "";
          a.specOps.push({ ...op, input, sourceId: s.id });
          mapped.push({ input, key });
        }
      }
      const k2 = `${op.method} ${erase(full)}`;
      specKeys.set(k2, [...(specKeys.get(k2) ?? []), key]);
    }
  }

  // 2. GraphQL root fields from introspection
  for (const g of graphql) {
    let ops;
    try {
      ops = operationsFromIntrospection(g.result);
    } catch (e) {
      problems.push(`${g.id} (${g.location}): ${e.message}`);
      continue;
    }
    const { origin, path: gpath } = normalizePath(g.location);
    for (const op of ops) {
      const key = graphqlKey(op.operationType, op.field);
      const input = `graphql:${g.id}:${op.operationType}.${op.field}`;
      const item = { key, path: gpath, tags: [] };
      const ex = excludeByOverlay(item);
      const inScope = includeByOverlay(item) || words(op.field).some((w) => names.has(nameKey(w))) || names.has(nameKey(op.field));
      if (ex) excluded.push({ input, reason: ex.reason, ...(ex.detail ? { detail: ex.detail } : {}) });
      else if (op.operationType === "subscription") excluded.push({ input, reason: "not_api", detail: "subscriptions need a WebSocket; not probed or tested over HTTP" });
      else if (!inScope) excluded.push({ input, reason: "out_of_module" });
      else {
        get(key, { kind: "graphql", method: "POST", origin: origin ?? primaryOrigin, path: gpath, basePath: "" }).gql.push({ ...op, input, sourceId: g.id, getSupported: graphqlGet.get(g.id) });
        mapped.push({ input, key });
      }
    }
  }

  // 3. network inventory (what the UI called)
  for (const { input, e, i, method, origin, path: p, key: own, drop, graphql: isGql } of inv) {
    if (drop) {
      excluded.push({ input, ...drop });
      continue;
    }
    if (isGql) {
      const ops = (e.graphql ?? [])
        .filter((g) => (g.operationType ?? "query") !== "subscription")
        .flatMap((g) => (g.fields?.length ? g.fields.map((f) => [g.operationType ?? "query", f]) : g.operationName ? [[g.operationType ?? "query", `op:${g.operationName}`]] : []));
      if (!ops.length) {
        excluded.push({ input, reason: "not_api", detail: "GraphQL request without query/mutation operations (module-explorer records graphql[].fields)" });
        continue;
      }
      const keys = uniq(ops.map(([t, f]) => graphqlKey(t, f)));
      for (const [t, f] of ops) get(graphqlKey(t, f), { kind: "graphql", method: "POST", origin, path: p, basePath: "" }).inv.push({ ...e, input, index: i });
      mapped.push({ input, key: keys[0], ...(keys.length > 1 ? { also: keys.slice(1) } : {}) });
      continue;
    }
    let key = own;
    let fallback = false;
    if (!acc.has(key)) {
      const alt = specKeys.get(`${method} ${erase(p)}`)?.find((k) => acc.has(k));
      if (alt) {
        key = alt;
        fallback = true;
      }
    }
    const a = get(key, { kind: "rest", method, origin, path: p, basePath: "" });
    if (fallback) a.originFallback = origin;
    a.inv.push({ ...e, input, index: i });
    mapped.push({ input, key });
  }

  // 4. docs-only endpoints from the overlay (the agent's reading of the vendor docs)
  overlay.endpoints.forEach((d, i) => {
    const input = `docs:${i}:${String(d.method).toUpperCase()} ${d.path}`;
    const method = String(d.method).toUpperCase();
    const n = normalizePath(d.server ? `${d.server.replace(/\/$/, "")}${d.path}` : d.path, { literals });
    const origin = n.origin ?? primaryOrigin;
    const key = restKey(method, origin, n.path, primaryOrigin);
    const a = get(key, { kind: "rest", method, origin, path: n.path, basePath: "" });
    a.docs.push({ ...d, input });
    mapped.push({ input, key });
  });

  // 5. ids
  const reg = assignIds(ap.registry, [...acc.keys()], { module, runId, prefix: "EP", field: "endpoints" });
  const idOf = (k) => reg.endpoints[k].id;

  // 6. finalize each endpoint
  const endpoints = [...acc.values()].map((a) => finalize(a, { idOf, probes }));
  endpoints.sort((x, y) => idNum(x.id) - idNum(y.id));

  // 7. annotations from the overlay (targets must exist)
  const byTarget = (t) => endpoints.find((e) => e.id === t || e.key === t);
  for (const [t, ann] of Object.entries(overlay.annotations ?? {})) {
    const e = byTarget(t);
    if (!e) {
      problems.push(`overlay.json annotations: '${t}' is not an endpoint id or key of this catalogue`);
      continue;
    }
    applyAnnotation(e, ann);
  }
  if (overlay.defaults?.auth) for (const e of endpoints) if (e.auth === "unknown") e.auth = overlay.defaults.auth;

  // 8. links: inferred, then the overlay's additions and removals
  inferLinks(endpoints);
  for (const l of overlay.links.add ?? []) {
    const to = byTarget(l.to);
    const from = byTarget(l.from);
    if (!to || !from) problems.push(`overlay.json links.add: unknown endpoint '${!to ? l.to : l.from}'`);
    else if (!to.links.some((x) => x.from === from.id && x.param === l.param)) to.links.push({ from: from.id, pointer: l.pointer, param: l.param, source: "overlay" });
  }
  for (const l of overlay.links.remove ?? []) {
    const to = byTarget(l.to);
    const from = byTarget(l.from);
    if (to && from) to.links = to.links.filter((x) => !(x.from === from.id && x.param === l.param));
  }

  // 9. drift
  const drift = endpoints.flatMap((e) => driftOf(e, acc.get(e.key), { specLoaded: specs.length > 0 })).sort((x, y) => x.id.localeCompare(y.id));

  // 10. coverage: every input accounted for exactly once
  const inputs = [
    ...specs.flatMap((s) => {
      try {
        return parseSpec(s.doc, { location: s.location, fallbackOrigin: primaryOrigin }).operations.map((op) => `spec:${s.id}:${op.method} ${op.path}`);
      } catch {
        return [];
      }
    }),
    ...graphql.flatMap((g) => {
      try {
        return operationsFromIntrospection(g.result).map((op) => `graphql:${g.id}:${op.operationType}.${op.field}`);
      } catch {
        return [];
      }
    }),
    ...inventory.map((e, i) => `inventory:${i}:${String(e.method ?? "").toUpperCase()} ${e.pathTemplate}`),
    ...overlay.endpoints.map((d, i) => `docs:${i}:${String(d.method).toUpperCase()} ${d.path}`),
  ];
  const accounted = new Map();
  for (const x of [...mapped, ...excluded]) accounted.set(x.input, (accounted.get(x.input) ?? 0) + 1);
  for (const i of inputs) if (accounted.get(i) !== 1) problems.push(`coverage: input '${i}' is accounted for ${accounted.get(i) ?? 0} times (expected once)`);
  for (const x of excluded) if (!EXCLUSION_REASONS.includes(x.reason)) problems.push(`coverage: '${x.input}' has unknown exclusion reason '${x.reason}'`);

  const candidateResources = Object.entries(
    endpoints
      .filter((e) => e.kind === "rest" && e.observed.ui)
      .map((e) => rootResource(e.path))
      .filter((r) => r && !names.has(nameKey(r)))
      .reduce((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {})
  )
    .map(([resource, observedEndpoints]) => ({ resource, observedEndpoints }))
    .sort((a, b) => a.resource.localeCompare(b.resource));

  const status = endpoints.length ? (overlay.blocked ? "partial" : "complete") : overlay.blocked || (!inventoryExists && !specs.length && !overlay.endpoints.length) ? "blocked" : "empty";
  const blockedReason = overlay.blocked ?? (status === "blocked" ? "no network inventory (explore/network-inventory.json is missing) and no spec or docs endpoints" : undefined);
  const idByKey = idOf;
  const coverage = {
    module,
    status,
    ...(blockedReason ? { blockedReason } : {}),
    inputs: { spec: inputs.filter((i) => i.startsWith("spec:")).length, graphql: inputs.filter((i) => i.startsWith("graphql:")).length, inventory: inventory.length, docs: overlay.endpoints.length },
    counts: {
      endpoints: endpoints.length,
      bySource: Object.fromEntries(["openapi", "graphql", "network", "docs"].map((s) => [s, endpoints.filter((e) => e.source === s).length])),
      mutating: endpoints.filter((e) => e.mutates).length,
      observed: endpoints.filter((e) => e.observed.ui || e.observed.probe).length,
      unobserved: endpoints.filter((e) => !e.observed.ui && !e.observed.probe).length,
      drift: drift.length,
    },
    sources: index.map(({ id, kind, location, version, status: st, getSupported }) => ({ id, kind, location, ...(version ? { version } : {}), ...(st ? { status: st } : {}), ...(getSupported !== undefined ? { getSupported } : {}) })),
    mapped: mapped.map((m) => ({ input: m.input, id: idByKey(m.key), ...(m.also ? { also: m.also.map(idByKey) } : {}) })).sort((a, b) => a.input.localeCompare(b.input)),
    excluded: excluded.sort((a, b) => a.input.localeCompare(b.input)),
    candidateResources,
    retired: Object.values(reg.endpoints).filter((e) => e.status === "gone").map((e) => e.id).sort((a, b) => idNum(a) - idNum(b)),
  };

  writeJson(ap.catalogue, endpoints);
  writeJson(ap.coverage, coverage);
  writeJson(ap.drift, drift);
  return { problems, summary: { status, ...(blockedReason ? { blockedReason } : {}), ...coverage.counts, excluded: excluded.length, candidateResources: candidateResources.map((c) => c.resource), retired: coverage.retired.length } };
}

function applyAnnotation(e, ann) {
  const cite = ann.citation ? [{ source: "docs", ref: ann.citation }] : [];
  if (ann.auth) e.auth = ann.auth;
  if (ann.pagination) e.pagination = { ...ann.pagination, source: "docs" };
  if (ann.rateLimit) e.rateLimit = { ...ann.rateLimit, source: "docs" };
  if (ann.queryLike) e.queryLike = { evidence: ann.queryLike.evidence, source: "overlay" };
  if (ann.mutates === true) e.mutates = true; // never lowered
  if (ann.notes) e.notes = [e.notes, ann.notes].filter(Boolean).join(" ");
  for (const c of cite) if (!e.sources.some((s) => s.source === c.source && s.ref === c.ref)) e.sources.push(c);
}

function finalize(a, { idOf, probes }) {
  const id = idOf(a.key);
  const spec = a.specOps[0];
  const probe = probes[a.key];
  const probed = !!(probe && probe.status);
  const sources = [
    ...a.specOps.map((o) => ({ source: "openapi", ref: `sources/${o.sourceId}.json${o.ref}` })),
    ...a.gql.map((g) => ({ source: "graphql", ref: `sources/${g.sourceId}.json#${g.operationType}.${g.field}` })),
    ...a.inv.map((x) => ({ source: "network", ref: `explore/network-inventory.json#/${x.index}` })),
    ...a.docs.map((d) => ({ source: "docs", ref: d.citation })),
    ...(probed ? [{ source: "probe", ref: "sources/probes.json" }] : []),
  ];
  const source = a.specOps.length ? "openapi" : a.gql.length ? "graphql" : a.inv.length ? "network" : "docs";
  const docs = a.docs[0];

  if (a.kind === "graphql") {
    const g = a.gql[0];
    const operationType = g?.operationType ?? a.key.split(" ")[1];
    const field = g?.field ?? a.key.split(" ").slice(2).join(" ");
    const getSupported = !!g?.getSupported;
    return {
      id,
      key: a.key,
      kind: "graphql",
      method: "POST",
      path: a.path,
      server: a.origin,
      basePath: "",
      graphql: { operationType, field, args: g?.args ?? [], returnType: g?.returnType ?? "unknown", getSupported },
      resource: field,
      crud: operationType,
      observed: { ui: a.inv.length > 0, probe: false },
      source,
      sources,
      auth: "unknown",
      params: [],
      contentTypes: { request: ["application/json"], response: ["application/json"] },
      statusCodes: sortNum(a.inv.flatMap((x) => x.statusCodes ?? [])),
      statuses: { documented: [], observed: sortNum(a.inv.flatMap((x) => x.statusCodes ?? [])) },
      requestKeys: [],
      responseKeys: [],
      pagination: null,
      rateLimit: null,
      links: [],
      mutates: operationType !== "query",
      safeMethod: operationType === "query" && getSupported,
      ...(g?.deprecated ? { deprecated: true } : {}),
    };
  }

  const params = [];
  const seen = new Set();
  for (const p of [...(spec?.params ?? []).map((p) => ({ ...p, source: "openapi" })), ...(docs?.params ?? []).map((p) => ({ ...p, source: "docs" }))]) {
    const k = `${p.in}:${p.name}`;
    if (!seen.has(k)) {
      seen.add(k);
      params.push(p);
    }
  }
  for (const s of segments(a.path).filter((s) => PARAM.test(s))) {
    const name = s.slice(1, -1) || "id";
    if (!seen.has(`path:${name}`)) {
      seen.add(`path:${name}`);
      params.push({ in: "path", name, required: true, source: "network" });
    }
  }
  const documented = uniq(a.specOps.flatMap((o) => Object.keys(o.responses ?? {})).filter((s) => s !== "default")).sort();
  const observedStatuses = sortNum([...a.inv.flatMap((x) => x.statusCodes ?? []), ...(probed ? [probe.status] : [])]);
  const okResponse = spec && Object.entries(spec.responses).find(([s, r]) => success(s) && r.schema)?.[1];
  const errorSchemas = spec ? Object.fromEntries(Object.entries(spec.responses).filter(([s, r]) => !success(s) && r.schema).map(([s, r]) => [s, r.schema])) : {};
  const responseKeys = uniq([...a.inv.flatMap((x) => x.responseKeys ?? []), ...(probed ? (probe.isArray ? probe.itemKeys ?? [] : probe.keys ?? []) : [])]).sort();
  const requestKeys = uniq(a.inv.flatMap((x) => x.requestKeys ?? [])).sort();
  const security = spec?.security ?? null;
  const auth = docs?.auth ?? authOf(security) ?? "unknown";
  const queryLike = a.method === "POST" && literalSegments(a.path).some((s) => QUERY_WORDS.has(s.toLowerCase())) ? { evidence: `path segment '${literalSegments(a.path).find((s) => QUERY_WORDS.has(s.toLowerCase()))}'`, source: "name" } : undefined;
  const crud = crudOf(a.method, a.path);
  const rate = probe?.rateLimit ? { headers: probe.rateLimit, source: "probe" } : docs?.rateLimit ? { ...docs.rateLimit, source: "docs" } : null;
  const pagination = crud === "list" ? (docs?.pagination ? { ...docs.pagination, source: "docs" } : paginationOf(params, responseKeys, probe)) : null;
  const out = {
    id,
    key: a.key,
    kind: "rest",
    method: a.method,
    path: a.path,
    server: a.origin,
    basePath: a.basePath,
    ...(spec?.operationId ? { operationId: spec.operationId } : {}),
    ...(spec?.summary ?? docs?.summary ? { summary: spec?.summary ?? docs.summary } : {}),
    ...(spec?.tags?.length ? { tags: spec.tags } : {}),
    resource: leafResource(a.path),
    crud,
    observed: { ui: a.inv.length > 0, probe: probed },
    source,
    sources,
    auth,
    ...(security ? { security: { alternatives: security } } : {}),
    params,
    contentTypes: {
      request: uniq(spec?.requestBody?.contentTypes ?? (requestKeys.length ? ["application/json"] : [])),
      response: uniq([...Object.entries(spec?.responses ?? {}).filter(([s]) => success(s)).flatMap(([, r]) => r.contentTypes), ...(probed && probe.contentType ? [probe.contentType] : [])]),
    },
    ...(spec?.requestBody?.schema ? { requestSchema: spec.requestBody.schema } : {}),
    ...(okResponse?.schema ? { responseSchema: okResponse.schema } : {}),
    ...(Object.keys(errorSchemas).length ? { errorSchemas } : {}),
    requestKeys,
    responseKeys,
    statusCodes: sortNum([...documented.filter((s) => /^\d+$/.test(s)), ...observedStatuses]),
    statuses: { documented, observed: observedStatuses },
    pagination,
    rateLimit: rate,
    links: [],
    mutates: !SAFE.has(a.method) || docs?.mutates === true,
    safeMethod: SAFE.has(a.method),
    ...(queryLike ? { queryLike } : {}),
    ...(spec?.deprecated ? { deprecated: true } : {}),
    ...(docs?.notes ? { notes: docs.notes } : {}),
  };
  // The probed response shape feeds link inference; it is not part of the catalogue (non-enumerable).
  Object.defineProperty(out, "probeShape", { value: probed ? probe : null, enumerable: false });
  return out;
}

// Producer -> consumer: an item endpoint's path parameter is fed by the id that creating (POST) or listing (GET) its
// collection returns -- RESTler-style name/position matching, within this catalogue.
export function inferLinks(endpoints) {
  const rest = endpoints.filter((e) => e.kind === "rest");
  const idPointer = (e) => {
    const props = topProps(e.responseSchema);
    if (props?.keys.includes("id")) return props.array ? "/0/id" : "/id";
    if (e.responseSchema?.properties) {
      for (const [k, v] of Object.entries(e.responseSchema.properties)) {
        const inner = topProps(v);
        if (inner?.keys.includes("id")) return inner.array ? `/${k}/0/id` : `/${k}/id`;
      }
    }
    const shape = e.probeShape;
    if (shape?.isArray && shape.itemKeys?.includes("id")) return "/0/id";
    if (shape?.arrayKey && shape.itemKeys?.includes("id")) return `/${shape.arrayKey}/0/id`;
    if (e.responseKeys.includes("id")) return e.crud === "list" ? null : "/id";
    return null;
  };
  for (const e of rest) {
    const segs = segments(e.path);
    segs.forEach((s, i) => {
      if (!PARAM.test(s)) return;
      const collection = "/" + segs.slice(0, i).join("/");
      const param = s.slice(1, -1) || "id";
      for (const p of rest.filter((x) => x.server === e.server && erase(x.path) === erase(collection) && (x.crud === "create" || x.crud === "list"))) {
        const ptr = idPointer(p);
        if (ptr && !e.links.some((l) => l.from === p.id && l.param === param)) e.links.push({ from: p.id, pointer: ptr, param, source: "inferred" });
      }
    });
    e.links.sort((a, b) => a.param.localeCompare(b.param) || idNum(a.from) - idNum(b.from));
  }
}

function driftOf(e, a, { specLoaded }) {
  const out = [];
  const add = (type, detail, evidence) => out.push({ id: `${type}|${e.key}${detail ? "|" + detail : ""}`, type, endpoint: e.id, ...(detail ? { detail } : {}), ...(evidence ? { evidence } : {}) });
  if (e.kind !== "rest") return out;
  const documentedOp = a.specOps.length > 0;
  if (specLoaded && !documentedOp && (e.observed.ui || e.observed.probe)) add("undocumented_endpoint", null, { sources: e.sources.map((s) => s.source) });
  if (documentedOp && !e.observed.ui && !e.observed.probe) add("unobserved_documented_endpoint");
  if (a.originFallback) add("server_mismatch", new URL(a.originFallback).host, { documented: e.server, observed: a.originFallback });
  if (!documentedOp) return out;
  const documented = e.statuses.documented;
  if (documented.length) for (const s of e.statuses.observed) if (!statusMatches(documented, s)) add("undocumented_status", String(s), { documented });
  const props = topProps(e.responseSchema);
  const observedKeys = e.responseKeys;
  if (props && observedKeys.length) {
    for (const k of observedKeys) if (!props.keys.includes(k)) add("undocumented_response_key", k);
    for (const k of props.required) if (!observedKeys.includes(k)) add("missing_required_key", k);
  }
  const reqProps = topProps(e.requestSchema);
  if (reqProps) for (const k of e.requestKeys) if (!reqProps.keys.includes(k)) add("undocumented_request_key", k);
  const probeStatus = e.statuses.observed;
  if (e.auth === "none" && probeStatus.some((s) => s === 401 || s === 403)) add("auth_mismatch", null, { documented: "none", observed: probeStatus.filter((s) => s === 401 || s === 403) });
  return out;
}

// The same checks build() enforces, for a catalogue already on disk. -> problems[]
export async function check(ap, validateData) {
  const problems = [];
  for (const [file, schema] of [[ap.catalogue, "discovered-endpoints"], [ap.coverage, "api-coverage"]]) {
    if (!existsSync(file)) {
      problems.push(`${path.basename(file)}: missing (run endpoints.mjs build)`);
      continue;
    }
    for (const e of await validateData(schema, readJson(file))) problems.push(`${path.basename(file)}: ${e}`);
  }
  if (existsSync(ap.overlay)) for (const e of await validateData("api-overlay", readJson(ap.overlay))) problems.push(`overlay.json: ${e}`);
  if (problems.length) return problems;
  const cat = readJson(ap.catalogue);
  const ids = new Set(cat.map((e) => e.id));
  if (ids.size !== cat.length) problems.push("discovered-endpoints.json: duplicate ids");
  const reg = readJson(ap.registry, { endpoints: {} });
  for (const e of cat) if (reg.endpoints[e.key]?.id !== e.id) problems.push(`${e.id}: does not match registry.json for '${e.key}' (rebuild; never edit ids by hand)`);
  for (const e of cat) for (const l of e.links) if (!ids.has(l.from)) problems.push(`${e.id}: link from unknown endpoint ${l.from}`);
  const cov = readJson(ap.coverage);
  for (const m of cov.mapped) if (!ids.has(m.id)) problems.push(`coverage.json: '${m.input}' maps to unknown ${m.id}`);
  return problems;
}
