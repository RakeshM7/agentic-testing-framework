// The framework's own HTTP requests (D-117): the doctor's target check, the API discovery probes, the knowledge
// snapshots and the leftover sweep all default to netFetch, which is the global fetch routed through the environment's
// proxy (HTTPS_PROXY, HTTP_PROXY, NO_PROXY) when one is set.
//
// Why: Node's fetch and http(s) ignore those variables unless told otherwise, so behind a corporate proxy, and in a
// sandboxed agent session (Claude Code's sandbox gives the session only a proxy, no DNS), every request failed with
// ENOTFOUND although the target answers. http.setGlobalProxyFromEnv() (Node.js 24) switches both on for the process;
// a process started with NODE_USE_ENV_PROXY=1 already has it. On a Node.js without either, requests go out directly,
// as before, and the doctor names the cause (proxyUnsupported).
//
// Dependency-free; tests pass their own environment and http module.
import http from "node:http";

export const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];

export const proxyConfigured = (env = process.env) => PROXY_VARS.some((k) => typeof env[k] === "string" && env[k].trim() !== "");

// Claude Code's sandbox runtime marks the processes it runs.
export const inSandbox = (env = process.env) => env.SANDBOX_RUNTIME === "1";

// Route fetch and http(s) through the environment's proxy, once per process. -> {proxy, via?, unsupported?}
let applied = null;
export function useEnvProxy({ env = process.env, api = http, once = true } = {}) {
  if (once && applied) return applied;
  let out;
  if (!proxyConfigured(env)) out = { proxy: false };
  else if (env.NODE_USE_ENV_PROXY === "1") out = { proxy: true, via: "NODE_USE_ENV_PROXY" };
  else if (typeof api.setGlobalProxyFromEnv !== "function") out = { proxy: false, unsupported: true };
  else {
    api.setGlobalProxyFromEnv(env);
    out = { proxy: true, via: "setGlobalProxyFromEnv" };
  }
  if (once) applied = out;
  return out;
}

// A proxy is set but this Node.js can't route through it.
export const proxyUnsupported = (env = process.env, api = http) =>
  proxyConfigured(env) && env.NODE_USE_ENV_PROXY !== "1" && typeof api.setGlobalProxyFromEnv !== "function";

export async function netFetch(url, init) {
  useEnvProxy();
  return fetch(url, init);
}

// What a failed request says, from its cause chain: the system error code (ENOTFOUND, ECONNREFUSED, ...) and, when the
// proxy refused the tunnel, its HTTP status. -> {code?, proxyStatus?, message}
export function networkError(e) {
  let code, proxyStatus;
  const seen = new Set();
  for (let c = e; c && typeof c === "object" && !seen.has(c); c = c.cause) {
    seen.add(c);
    if (!code && typeof c.code === "string" && /^E[A-Z_]+$/.test(c.code)) code = c.code;
    const m = /Proxy response \((\d{3})\)/.exec(String(c.message ?? ""));
    if (m && !proxyStatus) proxyStatus = Number(m[1]);
  }
  return { ...(code ? { code } : {}), ...(proxyStatus ? { proxyStatus } : {}), message: code ?? (proxyStatus ? `the proxy answered ${proxyStatus}` : e?.cause?.message ?? e?.message ?? String(e)) };
}
