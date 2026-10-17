// A module's API test plan: artifacts/<product>/modules/<m>/api/ (docs/agent-handoffs.md §4, decision D-046).
//
//   plan.json            the scenarios (schema api-plan) -- written only by build()
//   plan-coverage.json   every coverage item of the catalogue mapped to scenario ids, excluded with a reason, or
//                        still pending (schema api-plan-coverage); `verified` is stamped by check()
//   plan-registry.json   scenario key -> API id, assigned once and never reused (stable across runs)
//   plan-overlay.json    the api-test-planner's judgments (schema api-plan-overlay) -- the only file the agent writes
//   api-test-plan.md     rendered from the above
//
// Rules enforced here (not in prompts):
//   - scenarios are enumerated from the endpoint catalogue by a fixed rule catalogue (RULES below): equivalence
//     partitions and 2-value boundaries per spec constraint, one fault per negative (single fault assumption), auth
//     per security alternative, object/function/property-level authorization (OWASP API1/3/5), CRUD flows over the
//     catalogue's links, HTTP semantics (RFC 9110), GraphQL-over-HTTP, and one contract scenario per drift finding
//   - a scenario's key is "<endpoint key>|<rule>|<target>"; ids are API-<m>-<n> from the registry, never renumbered
//   - every expectation names its source; a status the spec, an answered clarification or observed traffic does not
//     give is asserted as a status class only, and the module gets one clarification question per fault class
//   - endpoints with the same request schema get field-level negatives once (the lowest EP id) and one smoke negative
//   - the overlay can annotate, link test cases, add cited scenarios, and exclude coverage items with a reason; it can
//     never change what a rule generated
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { withFileLock, writeAtomic } from "./csv.mjs";
import { append, csvPath, isAnswered, readRows } from "./clarifications.mjs";
import { erase, readJson, writeJson } from "./endpoints.mjs";

export const TYPES = ["functional", "negative", "boundary", "auth", "authorization", "lifecycle", "http", "graphql", "contract", "business"];
export const SOURCES = ["spec", "observed", "rfc9110", "graphql-over-http", "class-only"]; // plus clarification:/testcase:/knowledge:
export const EXCLUSION_REASONS = [
  // set by build()
  "deduped", "budget", "not_applicable", "unsupported_schema", "unreachable_status", "needs_identity", "auth_unknown", "public", "no_link", "unsafe_probe", "documentation_finding",
  // set by the overlay (each with a detail, most with a citation)
  "not_testable", "out_of_scope", "covered_elsewhere", "needs_data", "spec_wrong",
];
export const OVERLAY_REASONS = ["not_testable", "out_of_scope", "covered_elsewhere", "needs_data", "spec_wrong", "unreachable_status"];
export const DEFAULT_BUDGET = 300;

// Fault classes and the statuses that answer them (RFC 9110 / RFC 6585).
export const FAULTS = {
  validation: { codes: [400, 422], ask: "a request has a missing, wrongly typed or out-of-range field" },
  auth: { codes: [401], ask: "a request has no credentials or invalid credentials" },
  forbidden: { codes: [403, 404], ask: "a signed-in user requests an object or a function they are not allowed to use" },
  notFound: { codes: [404], ask: "a request names an id that does not exist" },
  pathType: { codes: [400, 404, 422] },
  conflict: { codes: [409] },
  precondition: { codes: [412] },
  media: { codes: [415] },
  notAcceptable: { codes: [406] },
  method: { codes: [405] },
  rateLimit: { codes: [429] },
};
const ASKED = ["validation", "auth", "forbidden", "notFound"];
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function planPaths(productDir, module) {
  const m = path.join(productDir, "modules", module);
  const dir = path.join(m, "api");
  return {
    dir,
    moduleDir: m,
    productDir,
    plan: path.join(dir, "plan.json"),
    coverage: path.join(dir, "plan-coverage.json"),
    registry: path.join(dir, "plan-registry.json"),
    overlay: path.join(dir, "plan-overlay.json"),
    md: path.join(dir, "api-test-plan.md"),
    catalogue: path.join(dir, "discovered-endpoints.json"),
    drift: path.join(dir, "drift.json"),
    epCoverage: path.join(dir, "coverage.json"),
  };
}

export const sha256 = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null);
const uniq = (xs) => [...new Set(xs)];
const numeric = (xs) => uniq(xs).sort((a, b) => a - b);
const idNum = (id) => Number(String(id).split("-").at(-1));
const byId = (a, b) => idNum(a) - idNum(b);
const esc = (s) => String(s).replaceAll("~", "~0").replaceAll("/", "~1");
const glob = (pattern) => new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");

export const EMPTY_OVERLAY = { statusRules: [], values: {}, testcases: {}, scenarios: [], dependencies: [], bfla: [], priorities: {}, exclude: [] };
export function readOverlay(file) {
  return { ...EMPTY_OVERLAY, ...readJson(file, {}) };
}

// ---------- registry: stable ids ----------

export function assignIds(registryFile, module, keys, runId) {
  return withFileLock(registryFile, () => {
    const reg = readJson(registryFile, { module, next: 1, scenarios: {} });
    const present = new Set(keys);
    for (const k of [...keys].sort()) {
      const e = reg.scenarios[k];
      if (e) Object.assign(e, { status: "active", lastSeen: runId });
      else reg.scenarios[k] = { id: `API-${module}-${reg.next++}`, status: "active", firstSeen: runId, lastSeen: runId };
    }
    for (const [k, e] of Object.entries(reg.scenarios)) if (!present.has(k) && e.status === "active") e.status = "gone";
    writeJson(registryFile, reg);
    return reg;
  });
}

// ---------- request schemas -> fields ----------

const MAX_DEPTH = 3;
function merged(schema) {
  if (!schema || typeof schema !== "object") return {};
  const all = [schema, ...(schema.allOf ?? [])];
  return {
    ...Object.assign({}, ...all.map((s) => ({ ...s, properties: undefined, required: undefined, allOf: undefined }))),
    properties: Object.assign({}, ...all.map((s) => s?.properties ?? {})),
    required: uniq(all.flatMap((s) => s?.required ?? [])),
  };
}
const typeOf = (s) => (Array.isArray(s?.type) ? s.type.find((t) => t !== "null") : s?.type) ?? (s?.properties ? "object" : s?.items ? "array" : undefined);
const nullable = (s) => s?.nullable === true || (Array.isArray(s?.type) && s.type.includes("null"));

// Every property of a request body down to MAX_DEPTH, as {pointer, schema, required, parent}. Polymorphic and circular
// nodes are reported, not walked.
export function fieldsOf(schema) {
  const fields = [];
  const unsupported = [];
  const walk = (node, ptr, depth) => {
    const s = merged(node);
    if (node?.["x-circular"] || node?.["x-unresolved"]) return unsupported.push({ pointer: ptr || "/", why: node["x-circular"] ? "circular $ref" : "unresolved $ref" });
    if (node?.oneOf || node?.anyOf) return unsupported.push({ pointer: ptr || "/", why: "oneOf/anyOf" });
    const t = typeOf(s);
    if (t === "array" && s.items && depth < MAX_DEPTH) return walk(s.items, `${ptr}/0`, depth + 1);
    if (t !== "object" || depth >= MAX_DEPTH) return;
    for (const [name, child] of Object.entries(s.properties ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const pointer = `${ptr}/${esc(name)}`;
      fields.push({ pointer, schema: merged(child), required: s.required.includes(name), parent: ptr || "/" });
      walk(child, pointer, depth + 1);
    }
  };
  if (schema) walk(schema, "", 0);
  return { fields, unsupported, object: typeOf(merged(schema)) === "object" ? merged(schema) : null };
}

// ---------- values for mutations ----------

const WRONG_TYPE = { string: 12345, integer: "not-a-number", number: "not-a-number", boolean: "not-a-boolean", array: "not-an-array", object: "not-an-object" };
const BAD_FORMAT = { email: "not-an-email", date: "2026-13-45", "date-time": "not-a-date-time", time: "25:61:61", uuid: "not-a-uuid", uri: "not a uri", url: "not a url", hostname: "-bad-host-", ipv4: "999.999.999.999", ipv6: "not-an-ipv6", int32: 2147483648 };
const MASS = { string: "atf-mass-assignment", integer: 999999, number: 999999, boolean: true };

function patternViolation(pattern, minLength = 1, maxLength = Infinity) {
  let re;
  try {
    re = new RegExp(pattern, "u");
  } catch {
    return null;
  }
  const len = Math.max(minLength ?? 1, 1);
  if (len > maxLength) return undefined;
  return ["!", "a", "0", " ", "Z"].map((c) => c.repeat(len)).find((v) => !re.test(v));
}

function outsideEnum(values) {
  if (values.every((v) => typeof v === "number")) return Math.max(...values) + 1;
  return ["atf-not-in-enum", "ATF_NOT_IN_ENUM", "0"].find((v) => !values.includes(v));
}

// The constraints of a field or parameter schema -> [{item, rule, kind: negative|boundary, mutation, fault?}]
function constraintCases(s, { field, required, location, method }) {
  const out = [];
  const t = typeOf(s);
  const at = (rule, kind, mutation, fault = "validation") => out.push({ rule, kind, mutation: { in: location, [location === "body" ? "pointer" : "name"]: field, ...mutation }, fault: kind === "boundary-valid" ? null : fault });
  if (required && location !== "path" && method !== "PATCH") at("required", "negative", { op: "remove" });
  if (required && location === "body" && !nullable(s) && method !== "PATCH") at("not-null", "negative", { op: "set", value: null });
  if (t && WRONG_TYPE[t] !== undefined && !(location !== "body" && t === "string")) at("type", "negative", { op: "type", value: WRONG_TYPE[t] }, location === "path" ? "pathType" : "validation");
  const step = s.multipleOf ?? (t === "integer" ? 1 : 0.01);
  const exMin = typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum : s.exclusiveMinimum === true ? s.minimum : undefined;
  const exMax = typeof s.exclusiveMaximum === "number" ? s.exclusiveMaximum : s.exclusiveMaximum === true ? s.maximum : undefined;
  if (exMin !== undefined) {
    at("exclusiveMinimum", "boundary-valid", { op: "set", value: exMin + step });
    at("exclusiveMinimum", "boundary", { op: "set", value: exMin });
  } else if (typeof s.minimum === "number") {
    at("minimum", "boundary-valid", { op: "set", value: s.minimum });
    at("minimum", "boundary", { op: "set", value: s.minimum - step });
  }
  if (exMax !== undefined) {
    at("exclusiveMaximum", "boundary-valid", { op: "set", value: exMax - step });
    at("exclusiveMaximum", "boundary", { op: "set", value: exMax });
  } else if (typeof s.maximum === "number") {
    at("maximum", "boundary-valid", { op: "set", value: s.maximum });
    at("maximum", "boundary", { op: "set", value: s.maximum + step });
  }
  if (Number.isInteger(s.minLength) && s.minLength > 0) {
    at("minLength", "boundary-valid", { op: "length", value: s.minLength });
    at("minLength", "boundary", { op: "length", value: s.minLength - 1 });
  }
  if (Number.isInteger(s.maxLength)) {
    at("maxLength", "boundary-valid", { op: "length", value: s.maxLength });
    at("maxLength", "boundary", { op: "length", value: s.maxLength + 1 });
  }
  if (Number.isInteger(s.minItems) && s.minItems > 0) {
    at("minItems", "boundary-valid", { op: "items", value: s.minItems });
    at("minItems", "boundary", { op: "items", value: s.minItems - 1 });
  }
  if (Number.isInteger(s.maxItems)) {
    at("maxItems", "boundary-valid", { op: "items", value: s.maxItems });
    at("maxItems", "boundary", { op: "items", value: s.maxItems + 1 });
  }
  if (s.uniqueItems === true) at("uniqueItems", "negative", { op: "duplicate" });
  if (Array.isArray(s.enum) && s.enum.length) {
    if (s.enum.length > 1) at("enum", "boundary-valid", { op: "each", values: s.enum });
    const bad = outsideEnum(s.enum);
    if (bad !== undefined) at("enum", "negative", { op: "set", value: bad });
  }
  if (typeof s.pattern === "string") {
    const bad = patternViolation(s.pattern, s.minLength, s.maxLength);
    if (bad === null) out.push({ rule: "pattern", unsupported: `/${s.pattern}/ is not a valid JavaScript regular expression` });
    else if (bad !== undefined) at("pattern", "negative", { op: "set", value: bad });
    else out.push({ rule: "pattern", unsupported: `no fixed value violates /${s.pattern}/ within the length limits` });
  }
  if (typeof s.format === "string") {
    if (BAD_FORMAT[s.format] !== undefined && (t !== "integer" || s.format === "int32")) at("format", s.format === "int32" ? "boundary" : "negative", { op: "set", value: BAD_FORMAT[s.format] });
    else out.push({ rule: "format", unsupported: `format '${s.format}' has no fixed invalid value` });
  }
  return out;
}

// ---------- expectations ----------

const documentedCodes = (e) => (e.statuses?.documented ?? []).map(String);
const successCodes = (e) => documentedCodes(e).filter((s) => /^2\d\d$/.test(s)).map(Number).sort((a, b) => a - b);

// The expected status of a fault on an endpoint: overlay rule (cited) > spec > fallback class. -> {expect, asked?}
function faultExpect(e, fault, overlay, fallbackSource = "class-only") {
  const rules = (overlay.statusRules ?? []).filter((r) => r.fault === fault);
  const rule = rules.find((r) => r.endpoint === e.id) ?? rules.find((r) => !r.endpoint || r.endpoint === "*");
  if (rule) return { expect: { ...(rule.statusIn ? { statusIn: numeric(rule.statusIn) } : { status: rule.status }), source: rule.citation } };
  const doc = documentedCodes(e);
  const hits = FAULTS[fault].codes.filter((c) => doc.includes(String(c)));
  if (hits.length === 1) return { expect: { status: hits[0], source: "spec", ...(e.errorSchemas?.[hits[0]] ? { schema: `error:${hits[0]}` } : {}) } };
  if (hits.length > 1) return { expect: { statusIn: hits, source: "spec" } };
  if (doc.some((s) => /^4XX$/i.test(s))) return { expect: { statusClass: "4xx", source: "spec" } };
  return { expect: { statusClass: "4xx", source: fallbackSource }, asked: ASKED.includes(fault) && fallbackSource === "class-only" ? fault : undefined };
}

function happyExpect(e) {
  const rules = [];
  const ok = successCodes(e);
  const preferred = e.crud === "create" && ok.includes(201) ? [201] : ok;
  let base;
  if (preferred.length === 1) base = { status: preferred[0], source: "spec" };
  else if (preferred.length > 1) base = { statusIn: preferred, source: "spec" };
  else {
    const seen = numeric((e.statuses?.observed ?? []).filter((s) => s >= 200 && s < 300));
    base = seen.length === 1 ? { status: seen[0], source: "observed" } : seen.length ? { statusIn: seen, source: "observed" } : { statusClass: "2xx", source: "class-only" };
  }
  if (e.responseSchema) base.schema = "response";
  else if (e.responseKeys?.length) rules.push({ assert: "keys-present", value: e.responseKeys, source: "observed" });
  for (const f of fieldsOf(e.responseSchema).fields.filter((f) => f.schema.writeOnly)) rules.push({ assert: "absent", pointer: f.pointer, source: "spec" });
  return { ...base, rules };
}

// ---------- the rule catalogue ----------

// ctx: {module, catalogue, drift, overlay, identities[], cases Map}. -> {scenarios: [draft], items: Map item -> {keys[]|excluded}}
export function generate(ctx) {
  const { catalogue, overlay } = ctx;
  const scenarios = new Map(); // key -> draft
  const items = new Map(); // coverage item -> {keys: Set} | {excluded: {reason, detail}}
  const asked = new Map(); // fault -> first endpoint id
  const cover = (item, key) => {
    const x = items.get(item) ?? { keys: new Set() };
    if (x.keys) x.keys.add(key);
    items.set(item, x);
  };
  const exclude = (item, reason, detail) => {
    if (!items.get(item)?.keys?.size) items.set(item, { excluded: { reason, ...(detail ? { detail } : {}) } });
  };
  const rest = catalogue.filter((e) => e.kind === "rest");
  // coverage item ids: "<kind>:<EP id>[:<detail>]", e.g. "param:EP-contacts-1:query.page:maximum"
  const item = (e, suffix) => {
    const [kind, ...detail] = suffix.split(":");
    return [kind, e.id, ...detail].join(":");
  };
  const deleteOf = (e) => rest.find((x) => x.server === e.server && x.crud === "delete" && erase(x.path) === `${erase(e.path)}/{}`);
  const createOf = (e) => rest.find((x) => x.server === e.server && x.crud === "create" && `${erase(x.path)}/{}` === erase(e.path));
  // Where a path id comes from: a read may use a listed entity; anything that can change data gets an entity this run
  // created (D-005), so its producer must be a create.
  const setupOf = (e) =>
    e.links
      .map((l) => ({ ...l, producer: catalogue.find((x) => x.id === l.from) }))
      .filter((l) => l.producer && (e.safeMethod || l.producer.crud === "create"))
      .sort((a, b) => Number(b.producer.safeMethod) - Number(a.producer.safeMethod) || byId(a.from, b.from))
      .filter((l, i, all) => all.findIndex((x) => x.param === l.param) === i)
      .map((l) => ({ endpoint: l.from, pointer: l.pointer, param: l.param }));
  const pathParams = (e) => e.params.filter((p) => p.in === "path");

  const add = (e, rule, target, s, items_) => {
    const key = `${e.key}|${rule}${target ? "|" + target : ""}`;
    // a scenario that creates (on a create endpoint, or a flow step on one) is cleaned up by that resource's delete
    const creator = e.crud === "create" ? e : (s.steps ?? []).map((st) => catalogue.find((x) => x.id === st.endpoint)).find((x) => x?.crud === "create");
    const creates = !!creator && s.request?.method === undefined;
    const del = creates ? deleteOf(creator) : null;
    const mutates = s.mutates ?? (!e.safeMethod || (s.steps ?? []).some((st) => !catalogue.find((x) => x.id === st.endpoint)?.safeMethod) || (s.request?.method && !SAFE.has(s.request.method)));
    const missing = pathParams(e).filter((p) => !s.request?.target && !(s.request?.setup ?? []).some((x) => x.param === p.name) && !(s.steps?.length));
    scenarios.set(key, {
      key,
      endpoint: e.id,
      rule,
      ...s,
      request: { base: "valid", auth: "default", ...s.request },
      mutates: !!mutates,
      requires: uniq([...(mutates ? ["full-run"] : []), ...(s.requires ?? [])]).sort(),
      cleanup: creates ? (del ? { endpoint: del.id } : null) : undefined,
      ...(creates && !del ? { leavesData: true } : {}),
      ...(!e.observed?.ui && !e.observed?.probe ? { documentedOnly: true } : {}),
      ...(s.blocked ? {} : missing.length ? { blocked: e.safeMethod ? `no producer for path parameter ${missing.map((p) => p.name).join(", ")} (no link in the catalogue)` : `path parameter ${missing.map((p) => p.name).join(", ")} needs an entity this run created, and no create operation links to it (D-005)` } : {}),
      testcases: [],
    });
    for (const it of items_) cover(it, key);
    return key;
  };
  const withSetup = (e, req = {}) => {
    const setup = setupOf(e);
    return setup.length ? { ...req, setup } : req;
  };
  const askedFor = (r, e) => {
    if (r.asked && !asked.has(r.asked)) asked.set(r.asked, e);
    return r.expect;
  };
  const title = (e, what, exp) => `${e.method} ${e.path}: ${what} -> ${exp.status ?? exp.statusIn?.join("|") ?? exp.statusClass}`;

  // dedupe groups: endpoints with the same request schema. The canonical one gets the field negatives: a create first
  // (every constraint applies), then a PUT, then the lowest EP id (a PATCH skips required-field negatives).
  const fp = (e) => (e.requestSchema ? createHash("sha1").update(JSON.stringify(e.requestSchema)).digest("hex") : null);
  const rank = (e) => (e.crud === "create" ? 0 : e.method === "PUT" ? 1 : 2);
  const canonical = new Map();
  for (const e of [...rest].sort((a, b) => rank(a) - rank(b) || byId(a.id, b.id))) if (fp(e) && !canonical.has(fp(e))) canonical.set(fp(e), e);
  const firstOf = (pred) => [...catalogue].sort((a, b) => Number(b.safeMethod) - Number(a.safeMethod) || byId(a.id, b.id)).find(pred);

  for (const e of catalogue) {
    // R1 operation coverage: one happy path (TCL2), which also validates the response schema (TCL6)
    const happy = happyExpect(e);
    const values = Object.fromEntries(Object.entries(overlay.values ?? {}).filter(([k]) => k.startsWith(`${e.id}#`)).map(([k, v]) => [k.slice(e.id.length + 1), v.value]));
    if (e.kind === "graphql") {
      generateGraphql(e, { add, item, exclude, firstOf, values });
    } else {
      add(e, "happy-path", "", { type: "functional", title: title(e, "valid request", happy), request: withSetup(e, Object.keys(values).length ? { values } : {}), expect: happy }, [item(e, "op"), ...(e.responseSchema ? [item(e, "schema")] : []), ...fieldsOf(e.responseSchema).fields.filter((f) => f.schema.writeOnly).map((f) => item(e, `field:${f.pointer}:writeOnly`))]);
    }
    if (e.kind !== "rest") continue;

    // R2-R7 parameters: required, type, boundaries, enum, pattern, format -- one fault each
    for (const p of e.params) {
      const s = { type: p.type, format: p.format, enum: p.enum, ...(p.constraints ?? {}) };
      for (const c of constraintCases(s, { field: p.name, required: p.required, location: p.in, method: e.method })) {
        const it = item(e, `param:${p.in}.${p.name}:${c.rule}`);
        if (c.unsupported) {
          exclude(it, "unsupported_schema", c.unsupported);
          continue;
        }
        const target = `${p.in}.${p.name}:${c.rule}:${c.kind === "boundary-valid" ? "valid" : "invalid"}`;
        const exp = c.fault ? askedFor(faultExpect(e, c.fault, overlay), e) : { ...happy, rules: [] };
        add(e, "param", target, { type: c.kind === "negative" ? "negative" : "boundary", title: title(e, `${p.in} ${p.name} ${describe(c)}`, exp), request: withSetup(e, { mutation: c.mutation }), expect: exp }, [it]);
      }
      if (p.in === "path") {
        // unknown id -> not found
        const exp = askedFor(faultExpect(e, "notFound", overlay), e);
        add(e, "unknown-id", p.name, { type: "negative", title: title(e, `unknown ${p.name}`, exp), request: { target: "unknown-id", mutation: { in: "path", name: p.name, op: "unknown-id" } }, expect: exp }, [item(e, `param:path.${p.name}:unknown-id`)]);
      }
    }

    // R2-R7 body fields, deduplicated across endpoints with the same request schema
    const { fields, unsupported, object } = fieldsOf(e.requestSchema);
    for (const u of unsupported) exclude(item(e, `field:${u.pointer}:schema`), "unsupported_schema", u.why);
    const canon = fp(e) ? canonical.get(fp(e)) : e;
    let smoke = false;
    const bodyCases = [
      ...fields.filter((f) => !f.schema.readOnly).flatMap((f) => constraintCases(f.schema, { field: f.pointer, required: f.required, location: "body", method: e.method }).map((c) => ({ ...c, f }))),
      ...(object?.additionalProperties === false ? [{ rule: "additionalProperties", kind: "negative", mutation: { in: "body", pointer: "/atfUnknownField", op: "set", value: "atf" }, fault: "validation", f: { pointer: "" } }] : []),
    ];
    for (const c of bodyCases) {
      const it = item(e, `field:${c.f.pointer || "/"}:${c.rule}`);
      if (c.unsupported) {
        exclude(it, "unsupported_schema", c.unsupported);
        continue;
      }
      if (canon.id !== e.id) {
        if (!smoke && c.kind === "negative") smoke = true;
        else {
          exclude(it, "deduped", `same request schema as ${canon.id}`);
          continue;
        }
      }
      const target = `${c.f.pointer || "/"}:${c.rule}:${c.kind === "boundary-valid" ? "valid" : "invalid"}`;
      const exp = c.fault ? askedFor(faultExpect(e, c.fault, overlay), e) : { ...happy, rules: [] };
      add(e, "field", target, { type: c.kind === "negative" ? "negative" : "boundary", title: title(e, `body ${c.f.pointer || "/"} ${describe(c)}`, exp), request: withSetup(e, { mutation: c.mutation, ...(Object.keys(values).length ? { values } : {}) }), expect: exp }, [it]);
    }

    // R7 property-level authorization (OWASP API3): a readOnly field sent in the request is rejected or ignored
    for (const f of fields.filter((f) => f.schema.readOnly)) {
      const v = MASS[typeOf(f.schema)];
      const it = item(e, `field:${f.pointer}:readOnly`);
      if (v === undefined) {
        exclude(it, "unsupported_schema", "readOnly field of a non-scalar type");
        continue;
      }
      add(e, "mass-assignment", f.pointer, { type: "authorization", title: `${e.method} ${e.path}: readOnly ${f.pointer} is rejected or ignored`, request: withSetup(e, { mutation: { in: "body", pointer: f.pointer, op: "set", value: v } }), expect: { statusClass: "non-5xx", source: "spec", rules: [{ assert: "ignored-if-accepted", pointer: f.pointer, value: v, source: "spec" }] } }, [it]);
    }

    // R8 authentication (OWASP API2): no credentials per endpoint; malformed credentials once per scheme
    const it = (k) => item(e, `auth:${k}`);
    if (e.auth === "none") exclude(it("none"), "public", "the catalogue documents no authentication");
    else if (e.auth === "unknown") exclude(it("none"), "auth_unknown", "the endpoint's authentication is unknown in the catalogue");
    else {
      const exp = askedFor(faultExpect(e, "auth", overlay), e);
      add(e, "auth", "none", { type: "auth", title: title(e, "no credentials", exp), request: withSetup(e, { auth: "none" }), expect: exp }, [it("none")]);
      const schemes = uniq((e.security?.alternatives ?? [[{ scheme: e.auth }]]).flat().map((s) => s.scheme)).sort();
      for (const scheme of schemes) {
        const first = firstOf((x) => x.kind === "rest" && x.auth !== "none" && x.auth !== "unknown" && uniq((x.security?.alternatives ?? [[{ scheme: x.auth }]]).flat().map((s) => s.scheme)).includes(scheme));
        if (first.id !== e.id) exclude(it(`malformed:${scheme}`), "deduped", `malformed ${scheme} credentials are planned once, on ${first.id}`);
        else add(e, "auth", `malformed:${scheme}`, { type: "auth", title: title(e, `malformed ${scheme} credentials`, exp), request: withSetup(e, { auth: `malformed:${scheme}` }), expect: exp }, [it(`malformed:${scheme}`)]);
      }
    }

    // R9 object- and function-level authorization (OWASP API1, API5): needs a second identity from the run-config
    if (pathParams(e).length && ["read", "update", "delete", "action"].includes(e.crud)) {
      const who = ctx.identities[0];
      if (!who) exclude(item(e, "bola"), "needs_identity", "add authorizations.identities to the run-config");
      else {
        const exp = askedFor(faultExpect(e, "forbidden", overlay), e);
        add(e, "bola", who.name, { type: "authorization", title: title(e, `identity '${who.name}' uses another user's object`, exp), request: withSetup(e, { auth: `identity:${who.name}` }), expect: exp, requires: [`identity:${who.name}`] }, [item(e, "bola")]);
      }
    }
    for (const b of (overlay.bfla ?? []).filter((b) => b.match === e.id || b.match === e.key || glob(b.match).test(e.key))) {
      const who = ctx.identities.find((i) => i.name === b.identity);
      const f = faultExpect(e, "forbidden", overlay);
      const exp = { ...f.expect, ...(f.expect.source === "class-only" ? { source: b.citation } : {}) };
      add(e, "bfla", b.identity, { type: "authorization", title: title(e, `identity '${b.identity}' is not allowed this function`, exp), request: withSetup(e, { auth: `identity:${b.identity}` }), expect: exp, requires: [`identity:${b.identity}`], ...(who ? {} : { blocked: `identity '${b.identity}' is not in authorizations.identities` }), citations: [b.citation] }, [item(e, `bfla:${b.identity}`)]);
    }

    // R10 HTTP semantics (RFC 9110): wrong method per path, unsupported media type, conflict, precondition, rate limit
    generateHttp(e, { add, item, exclude, firstOf, rest, overlay, happy, withSetup, title });

    // R11 CRUD flows over the links (TCL7)
    if (e.crud === "create") generateFlows(e, { add, item, exclude, rest, overlay, happy, askedFor });

    // R12 pagination
    if (e.pagination && e.crud === "list") {
      const p = e.pagination;
      const beyond = { page: [p.params[0], 999999], offset: [p.params[0], 1000000] }[p.style];
      if (beyond?.[0]) add(e, "page", "beyond-last", { type: "boundary", title: `${e.method} ${e.path}: page beyond the last -> non-5xx`, request: { mutation: { in: "query", name: beyond[0], op: "set", value: beyond[1] } }, expect: { statusClass: "non-5xx", source: "class-only", rules: [] } }, [item(e, "page:beyond-last")]);
      else if (p.style === "cursor" && p.params[0]) {
        const exp = askedFor(faultExpect(e, "validation", overlay), e);
        add(e, "page", "invalid-cursor", { type: "negative", title: title(e, "invalid cursor", exp), request: { mutation: { in: "query", name: p.params[0], op: "set", value: "atf-invalid-cursor" } }, expect: exp }, [item(e, "page:invalid-cursor")]);
      } else exclude(item(e, "page:beyond-last"), "not_applicable", `pagination style '${p.style}' has no parameter to push past the end`);
    }

    // R9 inter-parameter dependencies (IDL), from the overlay: one valid case and one violation
    for (const [i, d] of (overlay.dependencies ?? []).entries()) {
      if (d.endpoint !== e.id) continue;
      const exp = askedFor(faultExpect(e, "validation", overlay), e);
      const tag = `${d.kind}:${[...d.params].sort().join(",")}`;
      add(e, "dependency", `${tag}:valid`, { type: "boundary", title: `${e.method} ${e.path}: ${d.kind}(${d.params.join(", ")}) satisfied`, request: withSetup(e, { dependency: { kind: d.kind, params: d.params, satisfy: true } }), expect: { ...happy, rules: [] }, citations: [d.citation] }, [item(e, `dependency:${i}`)]);
      add(e, "dependency", `${tag}:violated`, { type: "negative", title: title(e, `${d.kind}(${d.params.join(", ")}) violated`, exp), request: withSetup(e, { dependency: { kind: d.kind, params: d.params, satisfy: false } }), expect: exp, citations: [d.citation] }, [item(e, `dependency:${i}`)]);
    }

  }

  // R14 contract: one scenario per drift finding that a request can check; the rest are documentation findings
  for (const d of ctx.drift) {
    const e = catalogue.find((x) => x.id === d.endpoint);
    const it = `drift:${d.id}`;
    if (!e) continue;
    if (d.type === "undocumented_endpoint") add(e, "contract", d.type, { type: "contract", title: `${e.method} ${e.path}: observed (undocumented) behavior still holds`, request: withSetup(e), expect: { statusClass: "2xx", source: "observed", rules: e.responseKeys?.length ? [{ assert: "keys-present", value: e.responseKeys, source: "observed" }] : [] } }, [it]);
    else if (d.type === "auth_mismatch") add(e, "contract", d.type, { type: "contract", title: `${e.method} ${e.path}: documented as public, works without credentials`, request: withSetup(e, { auth: "none" }), expect: { ...happyExpect(e), rules: [] } }, [it]);
    else if (d.type === "missing_required_key" || d.type === "unobserved_documented_endpoint") cover(it, `${e.key}|happy-path`);
    else exclude(it, "documentation_finding", `${d.type}${d.detail ? " " + d.detail : ""}: reported in api-test-plan.md, not testable by a request`);
  }

  // R15 status coverage: run after the other rules so their expectations count
  for (const e of rest) {
    for (const s of documentedCodes(e)) {
      const it = item(e, `status:${s}`);
      const hit = [...scenarios.values()].filter((x) => x.endpoint === e.id && expects(x.expect, s));
      if (hit.length) for (const x of hit) cover(it, x.key);
      else if (/^5/.test(s)) exclude(it, "unreachable_status", "server errors are never planned as an expected outcome");
      else if (/^2XX$|^4XX$/i.test(s)) exclude(it, "not_applicable", "a status range is covered by the class assertions");
      else if (["401"].includes(s) && e.auth === "none") exclude(it, "public", "documented 401 on an endpoint documented as public");
      else if (s === "403" && !ctx.identities.length) exclude(it, "needs_identity", "add authorizations.identities to the run-config");
      else if (!items.has(it)) items.set(it, { pending: "no rule triggers this documented status: add a cited scenario that covers it, or exclude it" });
    }
  }
  return { scenarios, items, asked };
}

function expects(exp, s) {
  const n = Number(s);
  return exp.status === n || (exp.statusIn ?? []).includes(n);
}

function describe(c) {
  const m = c.mutation;
  if (m.op === "remove") return "missing";
  if (m.op === "type") return "wrong type";
  if (m.op === "set" && m.value === null) return "null";
  if (m.op === "length") return `length ${m.value}`;
  if (m.op === "items") return `${m.value} items`;
  if (m.op === "each") return "each enum value";
  if (m.op === "duplicate") return "duplicate items";
  if (c.rule === "enum") return "outside the enum";
  if (c.rule === "pattern") return "not matching the pattern";
  if (c.rule === "format") return "of an invalid format";
  if (c.rule === "additionalProperties") return "unknown property";
  return `${c.rule} ${JSON.stringify(m.value)}`;
}

function generateHttp(e, { add, item, exclude, firstOf, rest, overlay, withSetup, title }) {
  // 405 once per path: an item path gets an unknown id (a wrongly honored method touches nothing); a collection path
  // only a missing GET (never a destructive method on a collection)
  const samePath = rest.filter((x) => x.server === e.server && erase(x.path) === erase(e.path));
  if (samePath.sort((a, b) => byId(a.id, b.id))[0].id === e.id) {
    const methods = new Set(samePath.map((x) => x.method));
    const isItem = /\{[^}]*\}$/.test(e.path);
    const candidate = isItem ? ["DELETE", "PUT", "PATCH", "POST"].find((m) => !methods.has(m)) : methods.has("GET") ? null : "GET";
    const it = item(e, "http:method");
    if (!candidate) exclude(it, isItem ? "not_applicable" : "unsafe_probe", isItem ? "every method is documented on this path" : "only a missing GET is probed on a collection path");
    else {
      const f = faultExpect(e, "method", overlay, "rfc9110");
      const exp = { ...f.expect, rules: [{ assert: "header-present", name: "Allow", when: 405, source: "rfc9110" }] };
      add(e, "http", "method", { type: "http", title: title(e, `${candidate} is not supported`, exp), request: { method: candidate, ...(isItem ? { target: "unknown-id" } : {}) }, expect: exp, mutates: !SAFE.has(candidate) }, [it]);
    }
  }
  // 415 once per module, on the first endpoint with a JSON body
  if (e.requestSchema || (e.contentTypes?.request ?? []).some((c) => /json/i.test(c))) {
    const first = firstOf((x) => x.kind === "rest" && (x.requestSchema || (x.contentTypes?.request ?? []).some((c) => /json/i.test(c))));
    const it = item(e, "http:media");
    if (first.id !== e.id) exclude(it, "deduped", `an unsupported media type is planned once, on ${first.id}`);
    else {
      const exp = faultExpect(e, "media", overlay).expect;
      add(e, "http", "media", { type: "http", title: title(e, "Content-Type text/plain", exp), request: withSetup(e, { headers: { "Content-Type": "text/plain" } }), expect: exp }, [it]);
    }
  }
  const doc = documentedCodes(e);
  if (doc.includes("406")) add(e, "http", "accept", { type: "http", title: `${e.method} ${e.path}: unacceptable Accept -> 406`, request: withSetup(e, { headers: { Accept: "application/x-atf-unsupported" } }), expect: { status: 406, source: "spec", rules: [] } }, [item(e, "http:accept")]);
  if (doc.includes("409") && e.crud === "create") add(e, "http", "conflict", { type: "http", title: `${e.method} ${e.path}: the same create twice -> 409`, request: { repeat: 2 }, expect: { status: 409, source: "spec", rules: [] } }, [item(e, "http:conflict")]);
  if (doc.includes("412") && ["update", "delete"].includes(e.crud)) add(e, "http", "precondition", { type: "http", title: `${e.method} ${e.path}: stale If-Match -> 412`, request: withSetup(e, { headers: { "If-Match": '"atf-stale"' } }), expect: { status: 412, source: "spec", rules: [] } }, [item(e, "http:precondition")]);
  if (e.rateLimit || doc.includes("429")) {
    const first = firstOf((x) => x.kind === "rest" && (x.rateLimit || documentedCodes(x).includes("429")));
    const it = item(e, "http:rate-limit");
    if (first.id !== e.id) exclude(it, "deduped", `the rate limit is planned once, on ${first.id}`);
    else add(e, "http", "rate-limit", { type: "http", title: `${e.method} ${e.path}: past the rate limit -> 429`, request: withSetup(e, { repeat: "past-rate-limit" }), expect: { status: 429, source: doc.includes("429") ? "spec" : "rfc9110", rules: [{ assert: "header-present", name: "Retry-After", when: 429, source: "rfc9110" }] }, blocked: "exceeds the documented rate limit on purpose; load stays below it (docs/k6-conventions.md), so this runs only when a human opts in" }, [it]);
  }
}

function generateFlows(c, { add, item, exclude, rest, overlay, happy, askedFor }) {
  const itemPath = `${erase(c.path)}/{}`;
  const on = (crud, method) => rest.find((x) => x.server === c.server && x.crud === crud && erase(x.path) === itemPath && (!method || x.method === method));
  const read = on("read");
  const update = on("update", "PUT") ?? on("update");
  const del = on("delete");
  // each later step's path parameter is bound to the created entity through the catalogue's link from the create
  const bind = (target) => {
    const l = target.links.find((x) => x.from === c.id);
    return l ? { param: l.param, from: 0, pointer: l.pointer } : null;
  };
  const ok = (x) => ({ ...happyExpect(x), rules: [] });
  const step = (x, expect, request) => ({ endpoint: x.id, bind: bind(x), ...(request ? { request } : {}), expect });
  const flows = [
    ["create-read", [read], "create, then read it back", () => [step(read, ok(read))]],
    ["create-update-read", [update, read], "create, update, read the change", () => [step(update, ok(update), { base: "changed" }), step(read, { ...ok(read), rules: [{ assert: "reflects-update", source: "spec" }] })]],
    ["create-delete-read", [del, read], "create, delete, read gives not found (use after delete)", () => [step(del, ok(del)), step(read, askedFor(faultExpect(read, "notFound", overlay), read))]],
    ["put-idempotent", [update?.method === "PUT" ? update : null], "the same PUT twice leaves the same state", () => [step(update, ok(update), { base: "changed" }), step(update, ok(update), { base: "changed" })]],
    ["delete-idempotent", [del], "a second DELETE changes nothing more and is not a server error", () => [step(del, ok(del)), step(del, { statusClass: "non-5xx", source: "rfc9110", rules: [] })]],
  ];
  for (const [name, needs, what, later] of flows) {
    const it = item(c, `flow:${name}`);
    if (needs.some((x) => !x)) {
      exclude(it, "not_applicable", `the catalogue has no matching ${name.split("-").slice(1).join("/")} operation on ${itemPath}`);
      continue;
    }
    const steps = [{ endpoint: c.id, expect: { ...happy, rules: [] } }, ...later()];
    if (steps.slice(1).some((st) => !st.bind)) {
      exclude(it, "no_link", `no link from ${c.id} feeds the path parameter of the operations on ${itemPath}`);
      continue;
    }
    add(c, "flow", name, { type: "lifecycle", title: `${c.method} ${c.path}: ${what}`, steps, expect: { ...happy, rules: [] } }, [it]);
  }
}

function generateGraphql(e, { add, item, exclude, firstOf, values }) {
  const g = e.graphql;
  const ok = { status: 200, source: "graphql-over-http", rules: [{ assert: "errors-absent", source: "graphql-over-http" }, { assert: "present", pointer: `/data/${esc(g.field)}`, source: "graphql-over-http" }] };
  const err = { statusIn: [200, 400], source: "graphql-over-http", rules: [{ assert: "errors-present", source: "graphql-over-http" }] };
  add(e, "happy-path", "", { type: "functional", title: `${g.operationType} ${g.field}: valid operation -> data, no errors`, request: Object.keys(values).length ? { values } : {}, expect: ok }, [item(e, "op")]);
  for (const a of g.args) {
    if (a.required) add(e, "gql-arg", `${a.name}:missing`, { type: "graphql", title: `${g.operationType} ${g.field}: required argument ${a.name} missing -> errors`, request: { mutation: { in: "graphql", name: a.name, op: "remove" } }, expect: err }, [item(e, `arg:${a.name}:required`)]);
    const base = a.type.replace(/[!\[\]]/g, "");
    const wrong = { String: 12345, ID: { atf: true }, Int: "not-a-number", Float: "not-a-number", Boolean: "not-a-boolean" }[base];
    if (wrong !== undefined) add(e, "gql-arg", `${a.name}:type`, { type: "graphql", title: `${g.operationType} ${g.field}: argument ${a.name} of the wrong type -> errors`, request: { mutation: { in: "graphql", name: a.name, op: "type", value: wrong } }, expect: err }, [item(e, `arg:${a.name}:type`)]);
    else exclude(item(e, `arg:${a.name}:type`), "unsupported_schema", `input type ${a.type} has no fixed wrong value`);
  }
  const firstQuery = firstOf((x) => x.kind === "graphql" && x.graphql.operationType === "query");
  if (firstQuery?.id === e.id) add(e, "gql", "unknown-field", { type: "graphql", title: `${g.operationType} ${g.field}: unknown field selected -> errors`, request: { select: "atfUnknownField" }, expect: err }, [item(e, "gql:unknown-field")]);
  const firstMutation = firstOf((x) => x.kind === "graphql" && x.graphql.operationType === "mutation");
  if (firstMutation?.id === e.id) add(e, "gql", "mutation-over-get", { type: "graphql", title: `mutation ${g.field} over GET is refused (GraphQL-over-HTTP)`, request: { method: "GET" }, expect: { statusClass: "4xx", source: "graphql-over-http", rules: [] }, mutates: true }, [item(e, "gql:mutation-over-get")]);
}

// ---------- overlay ----------

// A citation is checked against the module's own files: clarification:<answered id>, testcase:<TC id>,
// knowledge:<path under knowledge/>, spec:<path under api/>, observation:<path under the module>.
export function citationProblem(c, ctx) {
  const [kind, ...restParts] = String(c).split(":");
  const ref = restParts.join(":");
  const file = ref.split("#")[0];
  if (kind === "clarification") {
    const row = ctx.rows.find((r) => r.id.trim() === ref);
    if (!row) return `'${c}': no such row in clarifications.csv`;
    return isAnswered(row) ? null : `'${c}': the row is not answered yet`;
  }
  if (kind === "testcase") return ctx.cases.has(ref) ? null : `'${c}': no such test case`;
  if (kind === "knowledge") return existsSync(path.join(ctx.pp.productDir, "knowledge", file)) ? null : `'${c}': no such file under knowledge/`;
  if (kind === "spec") return existsSync(path.join(ctx.pp.dir, file)) ? null : `'${c}': no such file under api/`;
  if (kind === "observation") return existsSync(path.join(ctx.pp.moduleDir, file)) ? null : `'${c}': no such file under the module`;
  return `'${c}': a citation is clarification:<id>, testcase:<id>, knowledge:<path>, spec:<path> or observation:<path>`;
}

// ---------- build ----------

// ctx: {module, cfg, runId, cases: Map TC id -> {api, priority}}. Reads the catalogue, drift and overlay from disk;
// writes plan.json, plan-coverage.json, plan-registry.json, api-test-plan.md and appends questions to
// clarifications.csv. -> {problems[], summary}
export function build(pp, { module, cfg, runId, cases }) {
  const problems = [];
  const catalogue = readJson(pp.catalogue, null);
  if (!catalogue) return { problems: ["discovered-endpoints.json is missing (run endpoints.mjs build first)"], summary: {} };
  const drift = readJson(pp.drift, []);
  const epCoverage = readJson(pp.epCoverage, {});
  const overlay = readOverlay(pp.overlay);
  const csv = csvPath(pp.productDir, module);
  let rows = readRows(csv);
  const identities = [...(cfg.authorizations?.identities ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const cctx = { rows, cases, pp };
  const cite = (where, c) => {
    const p = citationProblem(c, cctx);
    if (p) problems.push(`plan-overlay.json ${where}: ${p}`);
  };
  const epIds = new Set(catalogue.map((e) => e.id));
  for (const [i, r] of overlay.statusRules.entries()) {
    cite(`statusRules[${i}]`, r.citation);
    if (r.endpoint && r.endpoint !== "*" && !epIds.has(r.endpoint)) problems.push(`plan-overlay.json statusRules[${i}]: unknown endpoint ${r.endpoint}`);
  }
  for (const [k, v] of Object.entries(overlay.values)) {
    cite(`values['${k}']`, v.citation);
    if (!epIds.has(k.split("#")[0])) problems.push(`plan-overlay.json values: '${k}' is not <EP id>#<JSON pointer> of this catalogue`);
  }
  for (const [i, d] of overlay.dependencies.entries()) {
    cite(`dependencies[${i}]`, d.citation);
    if (!epIds.has(d.endpoint)) problems.push(`plan-overlay.json dependencies[${i}]: unknown endpoint ${d.endpoint}`);
  }
  for (const [i, b] of overlay.bfla.entries()) cite(`bfla[${i}]`, b.citation);
  for (const [i, x] of overlay.exclude.entries()) if (x.citation) cite(`exclude[${i}]`, x.citation);

  const { scenarios, items, asked } = generate({ module, catalogue, drift, overlay, identities, cases });

  // overlay scenarios (cited, keyed by name) -- the planner's business-rule scenarios
  for (const [i, s] of overlay.scenarios.entries()) {
    const e = catalogue.find((x) => x.id === s.endpoint);
    if (!e) {
      problems.push(`plan-overlay.json scenarios[${i}] '${s.name}': unknown endpoint ${s.endpoint}`);
      continue;
    }
    for (const c of s.citations) cite(`scenarios[${i}]`, c);
    for (const r of [s.expect, ...(s.expect.rules ?? [])]) if (!SOURCES.includes(r.source) && !s.citations.includes(r.source)) problems.push(`plan-overlay.json scenarios[${i}] '${s.name}': expectation source '${r.source}' is neither a fixed source nor one of the scenario's citations`);
    const key = `overlay|${s.name}`;
    const mutates = s.mutates ?? (!e.safeMethod || !!(s.request?.method && !SAFE.has(s.request.method)));
    scenarios.set(key, {
      key,
      endpoint: e.id,
      rule: "overlay",
      type: s.type ?? "business",
      title: s.title,
      request: { base: "valid", auth: "default", ...s.request },
      expect: { rules: [], ...s.expect },
      mutates: !!mutates,
      requires: uniq([...(mutates ? ["full-run"] : []), ...(s.requires ?? [])]).sort(),
      priority: s.priority,
      citations: s.citations,
      testcases: [],
    });
    for (const it of s.covers ?? []) {
      const x = items.get(it);
      if (!x) problems.push(`plan-overlay.json scenarios[${i}] '${s.name}': covers unknown coverage item '${it}'`);
      else items.set(it, { keys: new Set([...(x.keys ?? []), key]) });
    }
  }

  // test cases -> scenarios
  const refOf = (ref) => (ref.startsWith("overlay:") ? `overlay|${ref.slice(8)}` : ref);
  const regBefore = readJson(pp.registry, { scenarios: {} });
  const keyOfId = new Map(Object.entries(regBefore.scenarios).map(([k, v]) => [v.id, k]));
  for (const [tc, refs] of Object.entries(overlay.testcases)) {
    if (!cases.has(tc)) {
      problems.push(`plan-overlay.json testcases: '${tc}' is not a test case of this module`);
      continue;
    }
    for (const ref of refs) {
      const key = scenarios.has(refOf(ref)) ? refOf(ref) : keyOfId.get(ref);
      if (!key || !scenarios.has(key)) problems.push(`plan-overlay.json testcases['${tc}']: '${ref}' is not a planned scenario (use an API id, a scenario key or overlay:<name>)`);
      else scenarios.get(key).testcases.push(tc);
    }
  }
  for (const [tc, c] of cases) {
    if (!c.api) continue;
    const it = `testcase:${tc}`;
    const linked = [...scenarios.values()].filter((s) => s.testcases.includes(tc));
    items.set(it, linked.length ? { keys: new Set(linked.map((s) => s.key)) } : { pending: "an @api test case linked to no scenario: link it in plan-overlay.json testcases, or exclude it with a reason" });
  }

  // values a valid request needs but no spec example gives: required pattern fields
  for (const e of catalogue.filter((x) => x.kind === "rest")) {
    for (const f of fieldsOf(e.requestSchema).fields.filter((f) => f.required && typeof f.schema.pattern === "string" && f.schema.example === undefined && f.schema.default === undefined && !f.schema.enum)) {
      const it = `value:${e.id}:${f.pointer}`;
      items.set(it, overlay.values[`${e.id}#${f.pointer}`] ? { keys: new Set([`${e.key}|happy-path`]) } : { pending: `a valid value for /${f.schema.pattern}/ is needed: add it to plan-overlay.json values with a citation` });
    }
  }

  // overlay exclusions: matched coverage items are not planned (their rule scenarios are dropped, with the reason)
  const dropped = new Set();
  for (const [i, x] of overlay.exclude.entries()) {
    const re = glob(x.match);
    const hit = [...items.keys()].filter((k) => re.test(k));
    if (!hit.length) problems.push(`plan-overlay.json exclude[${i}]: '${x.match}' matches no coverage item`);
    for (const k of hit) {
      for (const key of items.get(k).keys ?? []) if (!key.startsWith("overlay|")) dropped.add(key);
      items.set(k, { excluded: { reason: x.reason, detail: x.detail, ...(x.citation ? { citation: x.citation } : {}) } });
    }
  }
  // a dropped scenario that still covers another item stays
  for (const key of [...dropped]) if ([...items.values()].some((x) => x.keys?.has(key))) dropped.delete(key);
  for (const key of dropped) scenarios.delete(key);
  for (const s of scenarios.values()) s.testcases = s.testcases.filter((tc) => !items.get(`testcase:${tc}`)?.excluded);

  // priority: a fixed table by type, raised by linked test cases, overridden by the overlay (with a reason)
  const P = (p) => Number(String(p).slice(1));
  for (const s of scenarios.values()) {
    const e = catalogue.find((x) => x.id === s.endpoint);
    const table = { functional: e.observed?.ui ? 1 : 2, auth: 1, authorization: 1, lifecycle: e.observed?.ui ? 1 : 2, contract: 2, negative: 2, boundary: 2, http: 3, graphql: 3, business: 2 }[s.type];
    let p = s.priority ? P(s.priority) : table;
    for (const tc of s.testcases) if (cases.get(tc)?.priority) p = Math.min(p, P(cases.get(tc).priority));
    s.priority = `p${p}`;
  }

  // budget: drop the lowest priority, least specific scenarios first; their items become `budget` exclusions
  const budget = cfg.api?.plan_budget ?? DEFAULT_BUDGET;
  const order = ["http", "graphql", "boundary", "negative", "contract", "lifecycle", "business", "authorization", "auth", "functional"];
  const ranked = [...scenarios.values()].sort((a, b) => P(b.priority) - P(a.priority) || order.indexOf(a.type) - order.indexOf(b.type) || b.key.localeCompare(a.key));
  const overBudget = new Set();
  for (const s of ranked) {
    if (scenarios.size - overBudget.size <= budget) break;
    if (s.rule === "overlay" || s.testcases.length || s.type === "functional") continue;
    overBudget.add(s.key);
  }
  for (const key of overBudget) scenarios.delete(key);

  // overlay priority overrides
  const reg = assignIds(pp.registry, module, [...scenarios.keys()], runId);
  const idOf = (k) => reg.scenarios[k].id;
  for (const [ref, v] of Object.entries(overlay.priorities)) {
    const key = scenarios.has(refOf(ref)) ? refOf(ref) : Object.keys(reg.scenarios).find((k) => reg.scenarios[k].id === ref);
    if (!key || !scenarios.has(key)) problems.push(`plan-overlay.json priorities: '${ref}' is not a planned scenario`);
    else Object.assign(scenarios.get(key), { priority: v.priority, priorityReason: v.reason });
  }

  // questions: one clarification row per fault class the module could only assert as a status class
  const name = (cfg.modules ?? []).find((m) => m.slug === module)?.name ?? module;
  const questions = [];
  if (asked.size) {
    const items_ = [...asked.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fault, e]) => ({
      fault,
      question: `${name} API: which HTTP status code does the API return when ${FAULTS[fault].ask}?`,
      steps: [`1. Open the ${name} API documentation, or ask the team that owns the API.`, `2. Find the operation ${e.method} ${e.path} (and compare with the module's other operations).`, `3. Note the status code returned when ${FAULTS[fault].ask}, and whether every ${name} operation returns the same one.`].join("\n"),
    }));
    const r = append(csv, module, runId, items_.map(({ question, steps }) => ({ question, steps })));
    rows = readRows(csv);
    const idByQ = new Map([...r.duplicates.map((d) => [d.question, d.existingId]), ...r.added.map((id) => [rows.find((x) => x.id === id).question, id])]);
    for (const q of items_) questions.push({ id: idByQ.get(q.question), fault: q.fault, question: q.question });
  }
  for (const q of questions) {
    const row = rows.find((r) => r.id === q.id);
    q.answered = !!row && isAnswered(row);
    const applied = overlay.statusRules.some((r) => r.citation === `clarification:${q.id}`);
    if (q.answered && !applied) items.set(`question:${q.id}`, { pending: `answered: '${row.answer.trim()}' -- apply it as a statusRules entry citing clarification:${q.id}` });
    else if (q.answered) items.set(`question:${q.id}`, { keys: new Set() });
  }

  // scenarios -> plan.json
  const plan = [...scenarios.values()]
    .map(({ key, ...s }) => ({ id: idOf(key), key, ...s, testcases: uniq(s.testcases).sort() }))
    .map((s) => JSON.parse(JSON.stringify(s)))
    .sort((a, b) => byId(a.id, b.id));
  for (const s of plan) for (const step of s.steps ?? []) if (!step.bind) delete step.bind;

  // coverage
  const mapped = [];
  const excluded = [];
  const pending = [];
  for (const [it, x] of [...items.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (x.pending) pending.push({ item: it, why: x.pending });
    else if (x.excluded) excluded.push({ item: it, ...x.excluded });
    else {
      const kept = [...x.keys].filter((k) => scenarios.has(k));
      if (kept.length || it.startsWith("question:")) mapped.push({ item: it, scenarios: kept.map(idOf).sort(byId) });
      else if ([...x.keys].some((k) => overBudget.has(k))) excluded.push({ item: it, reason: "budget", detail: `over api.plan_budget (${budget})` });
      else pending.push({ item: it, why: "every scenario covering it was excluded by plan-overlay.json: exclude this item too, or keep a scenario" });
    }
  }
  const coverage = {
    module,
    catalogue: sha256(pp.catalogue),
    discovery: { status: epCoverage.status ?? "unknown", ...(epCoverage.blockedReason ? { blockedReason: epCoverage.blockedReason } : {}) },
    budget,
    levels: levels(catalogue, plan, mapped),
    counts: counts(plan),
    mapped,
    excluded,
    pending,
    questions,
    retired: Object.values(reg.scenarios).filter((e) => e.status === "gone").map((e) => e.id).sort(byId),
  };
  writeJson(pp.plan, plan);
  writeJson(pp.coverage, coverage);
  writeAtomic(pp.md, render(module, catalogue, plan, coverage, drift));
  return { problems, summary: { scenarios: plan.length, ...coverage.counts, levels: coverage.levels, excluded: excluded.length, pending: pending.length, questions: questions.map((q) => `${q.id} (${q.fault}${q.answered ? ", answered" : ""})`), retired: coverage.retired.length } };
}


export function counts(plan) {
  const tally = (f) => plan.reduce((m, s) => ({ ...m, [f(s)]: (m[f(s)] ?? 0) + 1 }), {});
  return {
    byType: tally((s) => s.type),
    byPriority: tally((s) => s.priority),
    mutating: plan.filter((s) => s.mutates).length,
    readonly: plan.filter((s) => !s.requires.length && !s.blocked).length,
    fullRunOnly: plan.filter((s) => s.requires.includes("full-run")).length,
    needsIdentity: plan.filter((s) => s.requires.some((r) => r.startsWith("identity:"))).length,
    blocked: plan.filter((s) => s.blocked).length,
    classOnly: plan.filter((s) => s.expect.source === "class-only").length,
    leavesData: plan.filter((s) => s.leavesData).length,
  };
}

// Martin-Lopez et al. test coverage levels (TCL1-7) the plan reaches. -> {reached, levels: {TCLn: bool}}
export function levels(catalogue, plan, mapped) {
  const rest = catalogue.filter((e) => e.kind === "rest");
  const planned = new Set(plan.map((s) => s.endpoint));
  const covered = new Set(mapped.map((m) => m.item));
  const has = (pred) => rest.every(pred);
  const TCL = {
    TCL1: has((e) => rest.filter((x) => erase(x.path) === erase(e.path)).some((x) => planned.has(x.id))),
    TCL2: catalogue.every((e) => planned.has(e.id)),
    TCL3: has((e) => (e.contentTypes?.request ?? []).length <= 1 || covered.has(`http:${e.id}:media`)),
    TCL4: has((e) => e.params.every((p) => [...covered].some((c) => c.startsWith(`param:${e.id}:${p.in}.${p.name}:`)) || p.in === "header") && plan.some((s) => s.endpoint === e.id && (s.expect.statusClass === "4xx" || [s.expect.status, ...(s.expect.statusIn ?? [])].some((x) => x >= 400 && x < 500)))),
    TCL5: has((e) => (e.statuses?.documented ?? []).filter((s) => /^[1-4]\d\d$/.test(s)).every((s) => covered.has(`status:${e.id}:${s}`))),
    TCL6: has((e) => !e.responseSchema || covered.has(`schema:${e.id}`)),
    TCL7: has((e) => e.crud !== "create" || covered.has(`flow:${e.id}:create-read`)),
  };
  let reached = 0;
  for (const n of [1, 2, 3, 4, 5, 6, 7]) if (TCL[`TCL${n}`]) reached = n;
  else break;
  return { reached: reached ? `TCL${reached}` : "none", ...TCL };
}

// ---------- check ----------

// The same checks build() enforces, for a plan already on disk; stamps `verified` into plan-coverage.json when the
// plan passes (orchestration.mjs next requires it before the API code is written). -> problems[]
export async function check(pp, validateData, { cases = new Map() } = {}) {
  const problems = [];
  for (const [file, schema] of [[pp.plan, "api-plan"], [pp.coverage, "api-plan-coverage"]]) {
    if (!existsSync(file)) {
      problems.push(`${path.basename(file)}: missing (run api-plan.mjs build)`);
      continue;
    }
    for (const e of await validateData(schema, readJson(file))) problems.push(`${path.basename(file)}: ${e}`);
  }
  if (existsSync(pp.overlay)) for (const e of await validateData("api-plan-overlay", readJson(pp.overlay))) problems.push(`plan-overlay.json: ${e}`);
  if (problems.length) return problems;
  const plan = readJson(pp.plan);
  const cov = readJson(pp.coverage);
  const catalogue = readJson(pp.catalogue, []);
  const eps = new Set(catalogue.map((e) => e.id));
  const ids = new Set(plan.map((s) => s.id));
  if (ids.size !== plan.length) problems.push("plan.json: duplicate ids");
  const reg = readJson(pp.registry, { scenarios: {} });
  for (const s of plan) {
    if (reg.scenarios[s.key]?.id !== s.id) problems.push(`${s.id}: does not match plan-registry.json for '${s.key}' (rebuild; never edit ids by hand)`);
    if (!eps.has(s.endpoint)) problems.push(`${s.id}: unknown endpoint ${s.endpoint}`);
    for (const st of s.steps ?? []) if (!eps.has(st.endpoint)) problems.push(`${s.id}: step on unknown endpoint ${st.endpoint}`);
    for (const tc of s.testcases) if (cases.size && !cases.has(tc)) problems.push(`${s.id}: unknown test case ${tc}`);
  }
  for (const m of cov.mapped) for (const id of m.scenarios) if (!ids.has(id)) problems.push(`plan-coverage.json: '${m.item}' maps to unknown ${id}`);
  for (const p of cov.pending) problems.push(`pending ${p.item}: ${p.why}`);
  if (cov.catalogue !== sha256(pp.catalogue)) problems.push("plan-coverage.json: the catalogue changed since the plan was built (run api-plan.mjs build again)");
  const { verified, ...rest } = cov;
  writeJson(pp.coverage, problems.length ? rest : { ...rest, verified: { plan: sha256(pp.plan), catalogue: sha256(pp.catalogue) } });
  return problems;
}

// For orchestration.mjs next: null when the plan on disk passed check and nothing changed since, else why not.
export function planUnverified(pp) {
  const cov = readJson(pp.coverage, null);
  if (!cov) return "api/plan-coverage.json is missing: the planner must finish with api-plan.mjs check";
  if (!cov.verified) return "the API plan did not pass api-plan.mjs check";
  if (cov.verified.plan !== sha256(pp.plan) || cov.verified.catalogue !== sha256(pp.catalogue)) return "the API plan or the catalogue changed after api-plan.mjs check";
  return null;
}

// ---------- api-test-plan.md ----------

function render(module, catalogue, plan, cov, drift) {
  const c = cov.counts;
  const exp = (e) => `${e.status ?? e.statusIn?.join("\\|") ?? e.statusClass} (${e.source})`;
  const table = (rows) => ["| Scenario | Endpoint | Type | Priority | Title | Expect | Requires |", "|---|---|---|---|---|---|---|", ...rows.map((s) => `| ${s.id} | ${s.endpoint} | ${s.type} | ${s.priority} | ${s.title.replaceAll("|", "\\|")} | ${exp(s.expect)} | ${s.requires.join(", ") || "readonly"} |`)];
  const ep = (id) => catalogue.find((e) => e.id === id);
  const lines = [
    `# API test plan -- ${module}`,
    "",
    "Generated by `node scripts/api-plan.mjs build` from the endpoint catalogue and `plan-overlay.json` (D-046). Do not edit; change the overlay and rebuild.",
    "",
    `Scenarios: ${plan.length} · mutating: ${c.mutating} · readonly-runnable: ${c.readonly} · full-run only: ${c.fullRunOnly} · needs an identity: ${c.needsIdentity} · blocked: ${c.blocked} · class-only expectations: ${c.classOnly}`,
    "",
    `By type: ${Object.entries(c.byType).sort().map(([k, v]) => `${k} ${v}`).join(", ") || "none"}. By priority: ${Object.entries(c.byPriority).sort().map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.`,
    "",
    `Coverage level reached: ${cov.levels.reached} (${Object.entries(cov.levels).filter(([k]) => k !== "reached").map(([k, v]) => `${k} ${v ? "yes" : "no"}`).join(", ")}). Catalogue status: ${cov.discovery.status}.`,
    "",
    "## Scenarios",
    "",
    ...table(plan),
    "",
    "## Readonly runs",
    "",
    "Scenarios with `Requires: readonly` run in every mode. `full-run` scenarios send a non-GET request or create data and run only in full-run; `identity:<name>` scenarios need that identity in `authorizations.identities`.",
    "",
    "## Documented-only endpoints",
    "",
    ...(catalogue.filter((e) => !e.observed?.ui && !e.observed?.probe).map((e) => `- ${e.id} ${e.method} ${e.path}: in the spec, never seen in the UI or a probe`) || []),
    ...(catalogue.some((e) => !e.observed?.ui && !e.observed?.probe) ? [] : ["- none"]),
    "",
    "## Leaves data",
    "",
    ...(plan.filter((s) => s.leavesData).map((s) => `- ${s.id}: creates through ${s.endpoint}, and the catalogue has no delete operation for it. The entity stays and is recorded in the ledger; a human decides before a full-run.`)),
    ...(plan.some((s) => s.leavesData) ? [] : ["- none"]),
    "",
    "## Blocked",
    "",
    ...plan.filter((s) => s.blocked).map((s) => `- ${s.id}: ${s.blocked}`),
    ...(plan.some((s) => s.blocked) ? [] : ["- none"]),
    "",
    "## Class-only expectations",
    "",
    "No source states the exact status for these; the tests assert the status class (and never a 5xx).",
    "",
    ...plan.filter((s) => s.expect.source === "class-only").map((s) => `- ${s.id}: ${s.title}`),
    ...(plan.some((s) => s.expect.source === "class-only") ? [] : ["- none"]),
    "",
    "## Questions raised",
    "",
    ...cov.questions.map((q) => `- ${q.id} (${q.fault}${q.answered ? ", answered" : ", open"}): ${q.question}`),
    ...(cov.questions.length ? [] : ["- none"]),
    "",
    "## Drift findings",
    "",
    ...drift.map((d) => `- ${d.id} (${ep(d.endpoint)?.method ?? ""} ${ep(d.endpoint)?.path ?? d.endpoint}): ${cov.mapped.find((m) => m.item === `drift:${d.id}`)?.scenarios.join(", ") || "documentation finding, not testable by a request"}`),
    ...(drift.length ? [] : ["- none"]),
    "",
    "## Not covered",
    "",
    ...(cov.discovery.status === "partial" || cov.discovery.status === "blocked" ? [`- Discovery is ${cov.discovery.status}: ${cov.discovery.blockedReason ?? "see coverage.json"}. What discovery could not see is not planned.`] : []),
    ...Object.entries(cov.excluded.reduce((m, x) => ({ ...m, [x.reason]: [...(m[x.reason] ?? []), x] }), {})).sort().flatMap(([reason, xs]) => [`- **${reason}** (${xs.length}):`, ...xs.map((x) => `  - ${x.item}${x.detail ? `: ${x.detail}` : ""}${x.citation ? ` [${x.citation}]` : ""}`)]),
    ...(cov.excluded.length || cov.discovery.status === "partial" || cov.discovery.status === "blocked" ? [] : ["- nothing"]),
    "",
    ...(cov.pending.length ? ["## Pending (check fails until resolved)", "", ...cov.pending.map((p) => `- ${p.item}: ${p.why}`), ""] : []),
  ];
  return lines.join("\n");
}

