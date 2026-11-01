import test from "node:test";
import assert from "node:assert/strict";
import { inSandbox, networkError, proxyConfigured, proxyUnsupported, useEnvProxy } from "./lib/net.mjs";
import { runChecks, unreachable } from "./lib/doctor.mjs";

const PROXY = { HTTPS_PROXY: "http://user:pass@127.0.0.1:9" };
const withApi = () => {
  const calls = [];
  return { calls, api: { setGlobalProxyFromEnv: (env) => calls.push(env) } };
};

test("useEnvProxy: routes through the proxy only when one is set, by the Node.js API or NODE_USE_ENV_PROXY", () => {
  const a = withApi();
  assert.deepEqual(useEnvProxy({ env: {}, api: a.api, once: false }), { proxy: false });
  assert.equal(a.calls.length, 0, "no proxy, nothing changes");
  assert.deepEqual(useEnvProxy({ env: PROXY, api: a.api, once: false }), { proxy: true, via: "setGlobalProxyFromEnv" });
  assert.deepEqual(a.calls, [PROXY], "the environment given is the one applied");
  assert.deepEqual(useEnvProxy({ env: { ...PROXY, NODE_USE_ENV_PROXY: "1" }, api: {}, once: false }), { proxy: true, via: "NODE_USE_ENV_PROXY" });
  assert.deepEqual(useEnvProxy({ env: PROXY, api: {}, once: false }), { proxy: false, unsupported: true });
  assert.equal(proxyConfigured({ http_proxy: "http://p:8080" }), true);
  assert.equal(proxyConfigured({ HTTPS_PROXY: "  " }), false);
  assert.equal(proxyUnsupported(PROXY, {}), true);
  assert.equal(proxyUnsupported(PROXY, withApi().api), false);
  assert.equal(inSandbox({ SANDBOX_RUNTIME: "1" }), true);
  assert.equal(inSandbox({}), false);
});

test("networkError: the system code and a proxy's refusal, from anywhere in the cause chain", () => {
  const dns = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" }) });
  assert.deepEqual(networkError(dns), { code: "ENOTFOUND", message: "ENOTFOUND" });
  const refused = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("Request was cancelled."), { code: 0, cause: Object.assign(new Error("Proxy response (403) !== 200 when HTTP Tunneling"), { code: "UND_ERR_ABORTED" }) }) });
  assert.deepEqual(networkError(refused), { proxyStatus: 403, message: "the proxy answered 403" });
  const loop = new Error("x");
  loop.cause = loop;
  assert.equal(networkError(loop).message, "x", "a cyclic cause chain ends");
});

test("doctor target (D-117): the fix names the sandbox or the proxy, not the VPN, when they are the cause", async () => {
  const url = "https://app.acme.test/";
  const sandbox = { SANDBOX_RUNTIME: "1", ...PROXY };
  const ok = withApi().api;
  let r = unreachable(url, { proxyStatus: 403, message: "x" }, sandbox, ok);
  assert.match(r.detail, /Claude Code's sandbox does not allow app\.acme\.test \(its proxy answered 403\)/);
  assert.match(r.fix, /\/sandbox/);
  r = unreachable(url, { proxyStatus: 407, message: "x" }, PROXY, ok);
  assert.match(r.detail, /the network proxy \(HTTPS_PROXY\) refused app\.acme\.test/);
  assert.match(r.fix, /NO_PROXY/);
  r = unreachable(url, { code: "ENOTFOUND", message: "ENOTFOUND" }, PROXY, {});
  assert.match(r.fix, /Node\.js 24 or newer, or start the command with NODE_USE_ENV_PROXY=1/);
  r = unreachable(url, { code: "ENOTFOUND", message: "ENOTFOUND" }, { SANDBOX_RUNTIME: "1" }, ok);
  assert.match(r.detail, /from inside Claude Code's sandbox/);
  r = unreachable(url, { code: "ENOTFOUND", message: "ENOTFOUND" }, {}, ok);
  assert.match(r.fix, /your network or VPN/, "outside a sandbox and without a proxy, the host itself");

  const cfg = { product: "acme", target: { url, api_urls: [] }, authorizations: { mode: "readonly", identities: [] } };
  const down = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("Proxy response (403) !== 200 when HTTP Tunneling") }); };
  const [check] = await runChecks(cfg, ["target"], { env: sandbox, httpApi: ok, fetchImpl: down });
  assert.equal(check.level, "fail");
  assert.match(check.detail, /sandbox does not allow/);
});

test("doctor base (D-117): inside the sandbox, a warning that never blocks", async () => {
  const cfg = { product: "acme", target: { url: "https://app.acme.test" }, authorizations: { mode: "readonly", identities: [] } };
  const sandboxed = (await runChecks(cfg, ["base"], { env: { SANDBOX_RUNTIME: "1" }, nodeVersion: "24.1.0", exists: () => true })).find((c) => c.id === "sandbox");
  assert.deepEqual([sandboxed.ok, sandboxed.level], [false, "warn"]);
  assert.match(sandboxed.fix, /npx atf doctor acme --fix/);
  assert.equal((await runChecks(cfg, ["base"], { env: {}, nodeVersion: "24.1.0", exists: () => true })).find((c) => c.id === "sandbox"), undefined);
});
