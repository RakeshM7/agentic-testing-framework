// The browser server's init page (D-076). Playwright MCP runs it for every new tab (`--init-page` in config/mcp.yaml,
// resolved against the server's working directory, the repo root). Once per browser context it
//   - loads the active run's saved session: when the run-config the run started from (state/config.resolved.json) has
//     authenticated_crawl on, the cookies of its session_state_file and the localStorage of each of its origins. One
//     product-neutral browser server serves every product, and a fresh login reaches the next new browser context
//     without a new agent session. With no active run, or several, no session is loaded;
//   - routes every request of the context (popups included): a method other than GET, HEAD or OPTIONS is aborted when it
//     goes to a host of an active readonly run (target.url, target.api_urls, or a subdomain of one), and to any host
//     when no run is active or a run's state is unreadable. The run state is read again for each such request, so a run
//     that starts or ends while the browser lives counts. It is what lets readonly agents type, select and press keys
//     (scripts/lib/browser-tools.mjs BROWSER_INPUT): a click or a key that submits still reaches nothing that writes.
// Anything that goes wrong reading the run state aborts the request (fails closed).
// Known limit: a service worker's own requests are not routed by Playwright.
"use strict";
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..", "..");
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const DONE = Symbol.for("atf.init-page");

let guard;
// The guard's own lookup of the active runs (one definition of which runs are active, their mode and their hosts).
const activeRuns = async (root) => {
  guard ??= await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "guard.mjs")).href);
  return guard.findActiveRuns(root);
};
const under = (host, hosts) => hosts.some((h) => host === h || host.endsWith(`.${h}`));

// -> null when the request may go, otherwise why it may not. runs: findActiveRuns() of the guard.
function refusal(method, url, runs) {
  if (SAFE.has(String(method).toUpperCase())) return null;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "the request has no URL a host can be read from";
  }
  if (!host) return null; // data:, blob: and about: carry nothing to a server
  if (!runs.length) return "no product run is active, so the browser is readonly";
  const broken = runs.find((r) => r.broken);
  if (broken) return `the run state of ${broken.product} cannot be read`;
  const readonly = runs.find((r) => r.mode !== "full-run" && under(host, r.targetHosts));
  return readonly ? `${host} belongs to ${readonly.product}, whose run is readonly` : null;
}

// The active run's saved session, added to the context: cookies, and localStorage set on each of its origins.
async function loadSession(context, run, root) {
  const config = path.join(run.stateDir ?? path.join(root, "artifacts", run.product, "state"), "config.resolved.json");
  if (!existsSync(config)) return false;
  const auth = JSON.parse(readFileSync(config, "utf8")).authorizations ?? {};
  if (!auth.authenticated_crawl || !auth.session_state_file) return false;
  const file = path.resolve(root, auth.session_state_file);
  if (!existsSync(file)) return false;
  const state = JSON.parse(readFileSync(file, "utf8"));
  if (state.cookies?.length) await context.addCookies(state.cookies);
  for (const o of state.origins ?? [])
    if (o.localStorage?.length)
      await context.addInitScript(({ origin, items }) => {
        if (location.origin === origin) for (const { name, value } of items) localStorage.setItem(name, value);
      }, { origin: o.origin, items: o.localStorage });
  return true;
}

async function initPage({ page }, root = ROOT) {
  const context = page.context();
  if (context[DONE]) return;
  context[DONE] = true;
  // the session's environment (ATF_ENV, D-081) picks the run when several environments of a product are active
  const all = await activeRuns(root);
  const env = process.env.ATF_ENV || "default";
  const runs = all.length > 1 ? all.filter((r) => r.environment === env) : all;
  if (runs.length === 1 && !runs[0].broken) await loadSession(context, runs[0], root);
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (SAFE.has(request.method().toUpperCase())) return route.fallback();
    let why;
    try {
      why = refusal(request.method(), request.url(), await activeRuns(root));
    } catch {
      why = "the run state could not be read";
    }
    return why ? route.abort("blockedbyclient") : route.fallback();
  });
}

module.exports = { default: initPage, refusal, loadSession };
