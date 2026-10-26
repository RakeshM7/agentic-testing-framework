// Guarded GET probes of the product's API (api-discoverer only; config/permissions.yaml `http: read`). The guard
// cannot see requests made inside a script, so every rule is enforced here and fails closed:
//   - GET only; no method-override parameters; never a request body
//   - credentials only to first-party hosts (target.url + target.api_urls); other hosts only for a spec document and
//     always anonymous
//   - no path or query token that suggests a side effect (logout, delete, export, confirm, ...), no action=/do=/cmd=
//   - path ids never guessed: only taken, in memory, from a list response this session already received
//   - one request at a time, a fixed delay, a per-module budget; 429 honors Retry-After once, then stops; three 5xx
//     in a row stop; redirects are recorded, never followed
//   - only shapes are recorded: status, content type, JSON key names, rate-limit numbers. Never values, URLs with
//     ids, cookies or tokens. Credential values are read from the files a human prepared (D-012) and never printed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DENY_TOKENS = new Set(
  ("logout log-out logoff signout sign-out delete destroy remove purge cancel revoke unsubscribe confirm verify activate " +
    "deactivate approve reject reset send invite export download generate execute trigger sync impersonate archive " +
    "restore disable enable toggle callback webhook unlock lock subscribe checkout pay charge refund")
    .split(/\s+/)
    .flatMap((t) => [t, t.replace("-", "")])
);
const DENY_QUERY_KEYS = new Set(["action", "do", "cmd", "op", "method", "_method", "x-http-method-override"]);
const RATE_HEADERS = ["ratelimit-limit", "x-ratelimit-limit", "ratelimit-policy", "x-ratelimit-reset", "ratelimit-reset"];

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};

// The product's own hosts: where credentials may go and where the guard treats a fetch as touching the target.
export function firstPartyHosts(cfg) {
  return [...new Set([cfg.target?.url, ...(cfg.target?.api_urls ?? [])].map(hostOf).filter(Boolean))];
}

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const tokens = (s) =>
  safeDecode(s)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// -> null when the URL may be probed, otherwise the reason it may not.
export function denyReason(url, { allowHosts, anyHost = false } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "not an absolute URL";
  }
  if (!["http:", "https:"].includes(u.protocol)) return `protocol ${u.protocol} is not probed`;
  if (u.username || u.password) return "credentials in the URL";
  if (!anyHost && !allowHosts.includes(u.hostname.toLowerCase())) return `host ${u.hostname} is not a first-party host of this product`;
  const pathTokens = tokens(u.pathname);
  const hit = pathTokens.find((t) => DENY_TOKENS.has(t));
  if (hit) return `path contains '${hit}', which suggests a side effect`;
  for (const [k] of u.searchParams) {
    if (DENY_QUERY_KEYS.has(k.toLowerCase())) return `query parameter '${k}' selects an action`;
    const t = tokens(k).find((x) => DENY_TOKENS.has(x));
    if (t) return `query parameter '${k}' suggests a side effect`;
  }
  return null;
}

// ---------- credentials (paths from the run-config; values never leave this module) ----------

function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const cookieMatches = (c, host, pathname) => {
  const d = String(c.domain ?? "").toLowerCase().replace(/^\./, "");
  const domainOk = host === d || host.endsWith(`.${d}`);
  const pathOk = pathname.startsWith(c.path ?? "/");
  const fresh = c.expires === undefined || c.expires === -1 || c.expires * 1000 > Date.now();
  return domainOk && pathOk && fresh;
};

// -> {describe, headersFor(url)}. describe names what is used (never values).
export function loadAuth(cfg, root) {
  const a = cfg.authorizations ?? {};
  const resolve = (f) => (f ? path.resolve(root, f) : null);
  const stateFile = resolve(a.session_state_file);
  const cookies = stateFile && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")).cookies ?? [] : [];
  const header = cfg.api?.auth_header ?? null; // {name, env, prefix?}
  let headerValue = null;
  if (header) {
    const credFile = resolve(a.credentials_file);
    const env = credFile && existsSync(credFile) ? parseEnv(readFileSync(credFile, "utf8")) : {};
    if (env[header.env]) headerValue = `${header.prefix ?? ""}${env[header.env]}`;
  }
  const allow = firstPartyHosts(cfg);
  return {
    describe: {
      session: stateFile ? (existsSync(stateFile) ? `${cookies.length} cookie(s) from session_state_file` : "session_state_file not found") : "no session_state_file",
      header: header ? (headerValue ? `${header.name} from ${header.env} in credentials_file` : `${header.env} not found in credentials_file`) : "no api.auth_header",
    },
    headersFor(url) {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (!allow.includes(host)) return {};
      const h = {};
      const jar = cookies.filter((c) => cookieMatches(c, host, u.pathname));
      if (jar.length) h.cookie = jar.map((c) => `${c.name}=${c.value}`).join("; ");
      if (headerValue) h[header.name.toLowerCase()] = headerValue;
      return h;
    },
  };
}

// ---------- response shapes (key names only) ----------

const objectKeys = (items) => [...new Set(items.filter((x) => x && typeof x === "object" && !Array.isArray(x)).flatMap(Object.keys))].sort();

export function shapeOf(json) {
  if (Array.isArray(json)) return { isArray: true, keys: [], itemKeys: objectKeys(json.slice(0, 5)) };
  if (!json || typeof json !== "object") return { isArray: false, keys: [] };
  const keys = Object.keys(json).sort();
  const arrayKey = keys.find((k) => Array.isArray(json[k]) && json[k].some((x) => x && typeof x === "object"));
  return { isArray: false, keys, ...(arrayKey ? { arrayKey, itemKeys: objectKeys(json[arrayKey].slice(0, 5)) } : {}) };
}

// The first list item's id, used only in memory to probe the item endpoint. Never recorded.
export function firstItemId(json) {
  const items = Array.isArray(json) ? json : Object.values(json ?? {}).find((v) => Array.isArray(v) && v.some((x) => x && typeof x === "object"));
  const item = items?.find((x) => x && typeof x === "object" && (typeof x.id === "string" || typeof x.id === "number"));
  return item ? String(item.id) : null;
}

// ---------- the client ----------

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ cfg, auth, fetchImpl = globalThis.fetch, sleep = defaultSleep, budget, delayMs, timeoutMs = 15000 }) {
  const allowHosts = firstPartyHosts(cfg);
  const state = { budget, used: 0, stopped: null, serverErrors: 0 };
  async function once(url, headers) {
    const res = await fetchImpl(url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    return res;
  }
  return {
    state,
    allowHosts,
    // -> {status, contentType, json?, rateLimit?, link?} | {skipped: reason}
    async get(url, { anyHost = false } = {}) {
      if (state.stopped) return { skipped: `probing stopped: ${state.stopped}` };
      const why = denyReason(url, { allowHosts, anyHost });
      if (why) return { skipped: why };
      if (state.used >= state.budget) return { skipped: `probe budget of ${state.budget} requests used` };
      const headers = { accept: "application/json, application/yaml;q=0.9, */*;q=0.1", ...auth.headersFor(url) };
      if (state.used > 0) await sleep(delayMs);
      state.used += 1;
      let res;
      try {
        res = await once(url, headers);
        if (res.status === 429) {
          const wait = Math.min(Number(res.headers.get("retry-after")) || 5, 30) * 1000;
          await sleep(wait);
          if (state.used >= state.budget) return { skipped: `probe budget of ${state.budget} requests used` };
          state.used += 1;
          res = await once(url, headers);
          if (res.status === 429) state.stopped = "rate limited (429 after Retry-After)";
        }
      } catch (e) {
        return { error: e.name === "TimeoutError" ? "timeout" : "network error" };
      }
      state.serverErrors = res.status >= 500 ? state.serverErrors + 1 : 0;
      if (state.serverErrors >= 3) state.stopped = "three server errors in a row";
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      const out = { status: res.status, contentType };
      const rl = Object.fromEntries(RATE_HEADERS.filter((h) => res.headers.get(h)).map((h) => [h, res.headers.get(h)]));
      if (Object.keys(rl).length) out.rateLimit = rl;
      if (/\brel="?next"?/.test(res.headers.get("link") ?? "")) out.link = true;
      if (res.status >= 200 && res.status < 300) {
        const text = await res.text();
        if (text.length <= 5_000_000) {
          try {
            out.json = JSON.parse(text);
          } catch {
            out.text = text; // YAML specs, Swagger UI pages; never written to disk by the probe recorder
          }
        }
      }
      return out;
    },
  };
}

// ---------- probing the catalogue's documented GETs ----------

const PARAM = /^\{[^}]+\}$/;
const segs = (p) => p.split("/").filter(Boolean);

// endpoints: catalogue entries. -> {results: {<key>: record}, meta}
export async function probeEndpoints(endpoints, client) {
  const results = {};
  const lists = new Map(); // collection key -> first item id (memory only)
  const candidates = endpoints
    .filter((e) => e.kind === "rest" && e.method === "GET" && e.server)
    .sort((a, b) => segs(a.path).length - segs(b.path).length || a.key.localeCompare(b.key));
  for (const e of candidates) {
    const parts = segs(e.path);
    const paramIdx = parts.map((s, i) => (PARAM.test(s) ? i : -1)).filter((i) => i >= 0);
    const requiredQuery = (e.params ?? []).filter((p) => p.in === "query" && p.required);
    if (requiredQuery.length) {
      results[e.key] = { skipped: `required query parameter(s): ${requiredQuery.map((p) => p.name).join(", ")}` };
      continue;
    }
    let concrete = parts;
    let paramsFrom;
    if (paramIdx.length > 1) {
      results[e.key] = { skipped: "more than one path parameter" };
      continue;
    }
    if (paramIdx.length === 1) {
      const i = paramIdx[0];
      const parentPath = "/" + parts.slice(0, i).join("/");
      const parent = endpoints.find((x) => x.kind === "rest" && x.method === "GET" && x.server === e.server && x.path === parentPath);
      const id = parent ? lists.get(parent.key) : null;
      if (!id) {
        results[e.key] = { skipped: "no id available from a probed list response (ids are never guessed)" };
        continue;
      }
      concrete = parts.map((s, j) => (j === i ? encodeURIComponent(id) : s));
      paramsFrom = parent.id ?? parent.key;
    }
    const r = await client.get(`${e.server}/${concrete.join("/")}`);
    if (r.skipped || r.error) {
      results[e.key] = r.skipped ? { skipped: r.skipped } : { error: r.error };
      continue;
    }
    const rec = { status: r.status, contentType: r.contentType, ...(r.rateLimit ? { rateLimit: r.rateLimit } : {}), ...(r.link ? { link: true } : {}), ...(paramsFrom ? { paramsFrom } : {}) };
    if (r.json !== undefined) {
      Object.assign(rec, shapeOf(r.json));
      if (!paramIdx.length) {
        const id = firstItemId(r.json);
        if (id) lists.set(e.key, id);
      }
    }
    results[e.key] = rec;
  }
  return { results, meta: { budget: client.state.budget, used: client.state.used, stopped: client.state.stopped } };
}
