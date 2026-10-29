// The live steps of API discovery, all through the guarded GET client of probe.mjs (the guard cannot see inside a
// script). Each takes the client, so tests run without a network.
//
//   findSpecs(ap, cfg, client, {root, extra})  RFC 9727 api-catalog, configured specs, then well-known paths; Swagger UI
//                                              pages are followed to the document they load. -> {found[], attempts[]}
//   introspect(ap, cfg, client)                GraphQL introspection over GET for configured / observed endpoints
//   runProbes(ap, client)                      the catalogue's documented GETs -> sources/probes.json

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { normalizePath, parseSpecText, saveSource, segments } from "./endpoints.mjs";
import { readJson, writeJson } from "./files.mjs";
import { INTROSPECTION_QUERY } from "./graphql.mjs";
import { specVersion } from "./openapi.mjs";
import { probeEndpoints } from "./probe.mjs";

// Ordered: specific documents first, UI pages last. Derived from the nuclei swagger-api template and Kiterunner lists.
export const WELL_KNOWN_SPEC_PATHS = [
  "/openapi.json", "/openapi.yaml", "/openapi.yml", "/swagger.json", "/swagger.yaml",
  "/v3/api-docs", "/v2/api-docs", "/api-docs", "/api-docs.json",
  "/api/openapi.json", "/api/swagger.json", "/api/v1/openapi.json", "/api/v1/swagger.json", "/api/v2/openapi.json", "/api/v2/swagger.json", "/api/v3/openapi.json",
  "/swagger/v1/swagger.json", "/docs/openapi.json", "/api/docs",
  "/swagger-ui.html", "/swagger-ui/index.html", "/swagger/index.html", "/docs",
];

const isUrl = (s) => /^https?:\/\//i.test(s);

// Swagger UI / Redoc pages name the document they render: url: "...", urls: [{url: "..."}], spec-url="...".
export function specLinksInHtml(html, base) {
  const out = new Set();
  for (const m of html.matchAll(/\burl\s*:\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
  for (const m of html.matchAll(/\bspec-url\s*=\s*["']([^"']+)["']/g)) out.add(m[1]);
  for (const m of html.matchAll(/\bconfigUrl\s*:\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
  return [...out].map((u) => {
    try {
      return new URL(u, base).toString();
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function bases(cfg) {
  const out = [];
  for (const u of [cfg.target.url, ...(cfg.target.api_urls ?? [])]) {
    const x = new URL(u);
    out.push(x.origin);
    const p = x.pathname.replace(/\/+$/, "");
    if (p) out.push(x.origin + p);
  }
  return [...new Set(out)];
}

export async function findSpecs(ap, cfg, client, { root, extra = [] } = {}) {
  const found = [];
  const attempts = [];
  const seen = new Set();
  const record = (location, doc, via) => {
    const entry = saveSource(ap, { kind: "openapi", location, content: doc, version: specVersion(doc), title: doc.info?.title ?? "", fetchedVia: via, status: "ok" });
    found.push({ id: entry.id, location, version: entry.version });
  };
  const fetchDoc = async (url, { anyHost = false, depth = 0 } = {}) => {
    if (seen.has(url)) return false;
    seen.add(url);
    const r = await client.get(url, { anyHost });
    attempts.push({ url: new URL(url).pathname === "/" ? url : `${new URL(url).origin}${new URL(url).pathname}`, ...(r.skipped ? { skipped: r.skipped } : r.error ? { error: r.error } : { status: r.status }) });
    if (!r.status || r.status < 200 || r.status >= 300) return false;
    if (r.json && specVersion(r.json)) return record(url, r.json, "get"), true;
    if (r.json?.linkset && depth < 2) {
      // RFC 9727 api-catalog: linkset[].service-desc[].href are the API descriptions
      let any = false;
      for (const set of r.json.linkset) for (const d of set["service-desc"] ?? []) if (d.href) any = (await fetchDoc(new URL(d.href, url).toString(), { anyHost, depth: depth + 1 })) || any;
      return any;
    }
    if (r.text) {
      const doc = parseSpecText(r.text);
      if (doc) return record(url, doc, "get"), true;
      if (depth < 2 && /swagger-ui|redoc|SwaggerUIBundle/i.test(r.text)) {
        let any = false;
        for (const link of specLinksInHtml(r.text, url)) any = (await fetchDoc(link, { anyHost, depth: depth + 1 })) || any;
        return any;
      }
    }
    return false;
  };

  // 1. specs a human configured or the agent passed: files are read, URLs fetched (credentials only to first-party hosts)
  for (const s of [...(cfg.api?.specs ?? []), ...extra]) {
    if (isUrl(s)) await fetchDoc(s, { anyHost: true });
    else {
      const abs = path.resolve(root, s);
      if (!existsSync(abs)) {
        attempts.push({ file: s, error: "file not found" });
        continue;
      }
      const doc = parseSpecText(readFileSync(abs, "utf8"));
      if (doc) record(s.replaceAll("\\", "/"), doc, "file");
      else attempts.push({ file: s, error: "not an OpenAPI 3.x / Swagger 2.0 document" });
    }
  }
  // 2. the API catalog, then the well-known paths, per base; stop at a base once it yielded a document
  for (const base of bases(cfg)) {
    if (await fetchDoc(`${new URL(base).origin}/.well-known/api-catalog`)) continue;
    for (const p of WELL_KNOWN_SPEC_PATHS) if (await fetchDoc(base + p)) break;
  }
  return { found, attempts, requests: client.state.used, stopped: client.state.stopped };
}

// GraphQL endpoints: configured (api.graphql) or observed (network inventory entries on a .../graphql path).
export function graphqlEndpoints(ap, cfg) {
  const origin = new URL(cfg.target.url).origin;
  const out = new Set((cfg.api?.graphql ?? []).map((g) => (isUrl(g) ? g : origin + normalizePath(g).path)));
  for (const e of readJson(ap.inventory, [])) {
    const p = normalizePath(e.host && !isUrl(e.pathTemplate) ? `${new URL(cfg.target.url).protocol}//${e.host}${e.pathTemplate}` : e.pathTemplate);
    if (segments(p.path).at(-1)?.toLowerCase() === "graphql" || (e.graphql ?? []).length) out.add((p.origin ?? origin) + p.path);
  }
  return [...out].sort();
}

export async function introspect(ap, cfg, client) {
  const results = [];
  for (const ep of graphqlEndpoints(ap, cfg)) {
    const r = await client.get(`${ep}?query=${encodeURIComponent(INTROSPECTION_QUERY)}`);
    const ok = r.status >= 200 && r.status < 300 && r.json?.data?.__schema;
    if (ok) {
      const e = saveSource(ap, { kind: "graphql", location: ep, content: { data: { __schema: r.json.data.__schema } }, getSupported: true, status: "ok" });
      results.push({ id: e.id, location: ep, status: "ok" });
    } else {
      const why = r.skipped ?? r.error ?? (r.json?.errors ? `introspection refused (${r.status}); it may be disabled in production` : `status ${r.status}`);
      saveSource(ap, { kind: "graphql", location: ep, getSupported: false, status: `unavailable: ${why}`, file: undefined }); // never build from a stale schema
      results.push({ location: ep, status: `unavailable: ${why}` });
    }
  }
  return { results, requests: client.state.used };
}

export async function runProbes(ap, client) {
  const catalogue = readJson(ap.catalogue, null);
  if (!catalogue) throw new Error("no discovered-endpoints.json yet: run `endpoints.mjs build` before `probe`");
  const { results, meta } = await probeEndpoints(catalogue, client);
  writeJson(ap.probes, { meta, results });
  const vals = Object.values(results);
  return {
    probed: vals.filter((r) => r.status).length,
    skipped: vals.filter((r) => r.skipped).length,
    errors: vals.filter((r) => r.error).length,
    byStatus: vals.filter((r) => r.status).reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}),
    ...meta,
  };
}
