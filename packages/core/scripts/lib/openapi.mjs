// OpenAPI / Swagger documents -> one operation model, so the endpoint catalogue never depends on the spec's version.
// Swagger 2.0 (host/basePath/schemes, in: body|formData, consumes/produces, securityDefinitions) and OpenAPI 3.0/3.1
// (servers, requestBody.content, components.securitySchemes) are both read here; local $refs are resolved with a depth
// cap, and a circular ref is kept as {$ref, x-circular: true} instead of recursing.
//
//   parseSpec(doc, {location, fallbackOrigin}) -> {version, title, operations: [op]} or throws
//   op: {method, path (template, relative to the server), server: {origin, basePath}, operationId?, summary?, tags[],
//        params[], requestBody?: {required, contentTypes[], schema?}, responses: {<status>: {contentTypes[], schema?}},
//        security: null | [[{scheme, type, in?, name?, scopes[]}]] (null = not declared), ref (JSON Pointer into the doc)}

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace", "query"];
const STANDARD_HEADERS = new Set(["accept", "content-type", "authorization", "cookie", "host", "content-length"]);
const MAX_DEPTH = 8;

export const pointer = (...parts) => "#/" + parts.map((p) => String(p).replaceAll("~", "~0").replaceAll("/", "~1")).join("/");

function lookup(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return undefined; // external refs are not fetched
  return ref
    .slice(2)
    .split("/")
    .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((node, key) => (node == null ? undefined : node[decodeURIComponent(key)]), doc);
}

// Resolve local $refs. `seen` is the chain of refs being expanded (cycle detection); depth caps the number of nested
// ref expansions, so very deep schemas stay bounded.
export function deref(doc, node, seen = [], depth = 0) {
  if (Array.isArray(node)) return node.map((n) => deref(doc, n, seen, depth));
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    if (seen.includes(node.$ref) || depth >= MAX_DEPTH) return { $ref: node.$ref, "x-circular": true };
    const target = lookup(doc, node.$ref);
    if (target === undefined) return { $ref: node.$ref, "x-unresolved": true };
    const { $ref, ...siblings } = node; // 3.1 allows siblings next to $ref
    const resolved = deref(doc, target, [...seen, $ref], depth + 1);
    return Object.keys(siblings).length && resolved && typeof resolved === "object" && !Array.isArray(resolved) ? { ...resolved, ...deref(doc, siblings, seen, depth) } : resolved;
  }
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = deref(doc, v, seen, depth);
  return out;
}

export function specVersion(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (typeof doc.swagger === "string" && doc.swagger.startsWith("2")) return "2.0";
  if (typeof doc.openapi === "string" && /^3\.\d/.test(doc.openapi)) return doc.openapi;
  return null;
}

function splitServer(url, base) {
  try {
    const u = new URL(url, base);
    return { origin: u.origin.toLowerCase(), basePath: u.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

// 3.x server URL with {variables} substituted by their defaults.
const expandServer = (s) => String(s.url ?? "").replace(/\{([^}]+)\}/g, (_, name) => s.variables?.[name]?.default ?? "");

function servers3(list, base) {
  const out = (list ?? []).map((s) => splitServer(expandServer(s), base)).filter(Boolean);
  return out;
}

function schemesOf(doc, location) {
  const fromLocation = /^https?:/i.test(location ?? "") ? new URL(location).protocol.replace(":", "") : null;
  return doc.schemes?.length ? (doc.schemes.includes("https") ? "https" : doc.schemes[0]) : fromLocation ?? "https";
}

function securitySchemes(doc, version) {
  const raw = version === "2.0" ? doc.securityDefinitions ?? {} : doc.components?.securitySchemes ?? {};
  const out = {};
  for (const [name, s0] of Object.entries(raw)) {
    const s = deref(doc, s0);
    if (s.type === "basic") out[name] = { type: "http", scheme: "basic" };
    else out[name] = { type: s.type, ...(s.scheme ? { scheme: String(s.scheme).toLowerCase() } : {}), ...(s.in ? { in: s.in } : {}), ...(s.name ? { name: s.name } : {}) };
  }
  return out;
}

// Security requirement objects -> alternatives (OR) of scheme lists (AND). [] means "no auth"; null "not declared".
function security(reqs, schemes) {
  if (reqs === undefined) return null;
  return reqs.map((req) =>
    Object.entries(req ?? {}).map(([name, scopes]) => ({ scheme: name, ...(schemes[name] ?? { type: "unknown" }), scopes: [...(scopes ?? [])].sort() }))
  );
}

// Value constraints of a parameter, kept for the API test plan's boundary and negative scenarios (D-046).
const CONSTRAINTS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems", "default", "example"];

function param(doc, p0, version) {
  const p = deref(doc, p0);
  const schema = version === "2.0" ? { ...Object.fromEntries(CONSTRAINTS.map((k) => [k, p[k]])), type: p.type, ...(p.format ? { format: p.format } : {}), ...(p.enum ? { enum: p.enum } : {}), ...(p.items ? { items: p.items } : {}) } : { ...(p.example !== undefined ? { example: p.example } : {}), ...(p.schema ?? {}) };
  const constraints = Object.fromEntries(CONSTRAINTS.filter((k) => schema[k] !== undefined).map((k) => [k, schema[k]]));
  return {
    in: p.in,
    name: p.name,
    required: p.in === "path" ? true : !!p.required,
    ...(schema.type ? { type: Array.isArray(schema.type) ? schema.type.filter((t) => t !== "null")[0] : schema.type } : {}),
    ...(schema.format ? { format: schema.format } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(Object.keys(constraints).length ? { constraints } : {}),
  };
}

// Merge path-level and operation-level params (the operation wins on in+name).
function mergeParams(pathParams, opParams) {
  const map = new Map();
  for (const p of [...pathParams, ...opParams]) map.set(`${p.in}:${p.name}`, p);
  return [...map.values()];
}

const jsonish = (ct) => /json/i.test(ct);
const firstJson = (content) => {
  const entries = Object.entries(content ?? {});
  return (entries.find(([ct]) => jsonish(ct)) ?? entries[0])?.[1];
};

function responses(doc, op, version, produces) {
  const out = {};
  for (const [status, r0] of Object.entries(op.responses ?? {})) {
    const r = deref(doc, r0);
    if (version === "2.0") out[status] = { contentTypes: r.schema ? [...produces] : [], ...(r.schema ? { schema: r.schema } : {}) };
    else {
      const media = firstJson(r.content);
      out[status] = { contentTypes: Object.keys(r.content ?? {}), ...(media?.schema ? { schema: media.schema } : {}) };
    }
  }
  return out;
}

function requestBody(doc, op, params2, version, consumes) {
  if (version === "2.0") {
    const body = params2.find((p) => p.in === "body");
    const form = params2.filter((p) => p.in === "formData");
    if (body) return { required: !!body.required, contentTypes: consumes.length ? consumes : ["application/json"], ...(body.schema ? { schema: deref(doc, body.schema) } : {}) };
    if (form.length) {
      const multipart = form.some((p) => p.type === "file") || consumes.includes("multipart/form-data");
      const properties = Object.fromEntries(form.map((p) => [p.name, { type: p.type === "file" ? "string" : p.type, ...(p.type === "file" ? { format: "binary" } : {}) }]));
      const required = form.filter((p) => p.required).map((p) => p.name);
      return { required: required.length > 0, contentTypes: [multipart ? "multipart/form-data" : "application/x-www-form-urlencoded"], schema: { type: "object", properties, ...(required.length ? { required } : {}) } };
    }
    return undefined;
  }
  if (!op.requestBody) return undefined;
  const rb = deref(doc, op.requestBody);
  const media = firstJson(rb.content);
  return { required: !!rb.required, contentTypes: Object.keys(rb.content ?? {}), ...(media?.schema ? { schema: media.schema } : {}) };
}

export function parseSpec(doc, { location = "", fallbackOrigin } = {}) {
  const version = specVersion(doc);
  if (!version) throw new Error("not an OpenAPI 3.x or Swagger 2.0 document (no 'openapi: 3.x' / 'swagger: 2.0' key)");
  const base = /^https?:/i.test(location) ? location : fallbackOrigin;
  const schemes = securitySchemes(doc, version);
  let rootServers;
  if (version === "2.0") {
    const host = doc.host ?? (base ? new URL(base).host : null);
    rootServers = host ? [splitServer(`${schemesOf(doc, location)}://${host}${doc.basePath ?? ""}`)].filter(Boolean) : [];
  } else rootServers = servers3(doc.servers, base);
  if (!rootServers.length && base) rootServers = [splitServer("/", base)];
  const operations = [];
  for (const [p, item0] of Object.entries(doc.paths ?? {})) {
    const item = deref(doc, item0, [], 0);
    const pathServers = version === "2.0" ? rootServers : item.servers?.length ? servers3(item.servers, base) : rootServers;
    const pathParams = item.parameters ?? [];
    const methods = [...METHODS.filter((m) => item[m]), ...Object.keys(item.additionalOperations ?? {}).map((m) => m.toLowerCase())];
    for (const method of methods) {
      const op = item[method] ?? item.additionalOperations?.[method.toUpperCase()] ?? item.additionalOperations?.[method];
      const servers = version !== "2.0" && op.servers?.length ? servers3(op.servers, base) : pathServers;
      const rawParams = mergeParams(pathParams.map((x) => deref(doc, x)), (op.parameters ?? []).map((x) => deref(doc, x)));
      const consumes = op.consumes ?? doc.consumes ?? [];
      const produces = op.produces ?? doc.produces ?? ["application/json"];
      const params = rawParams.filter((x) => x.in !== "body" && x.in !== "formData").map((x) => param(doc, x, version)).filter((x) => !(x.in === "header" && STANDARD_HEADERS.has(String(x.name).toLowerCase())));
      operations.push({
        method: method.toUpperCase(),
        path: p,
        server: servers[0] ?? null,
        ...(op.operationId ? { operationId: op.operationId } : {}),
        ...(op.summary ? { summary: String(op.summary).slice(0, 200) } : {}),
        tags: [...(op.tags ?? [])],
        deprecated: !!op.deprecated,
        params,
        requestBody: requestBody(doc, op, rawParams, version, consumes),
        responses: responses(doc, op, version, produces),
        security: security(op.security ?? doc.security, schemes),
        ref: pointer("paths", p, method),
      });
    }
  }
  return { version, title: doc.info?.title ?? "", operations };
}
