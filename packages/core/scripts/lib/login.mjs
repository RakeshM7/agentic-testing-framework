// The human's login (D-069, D-118), behind `run.mjs login <config.yaml>` (atf login, or the orchestrator after the human
// confirms). It opens a real browser window on the target: the OS default browser when it is Chromium-based (Chrome,
// Edge, Brave, Arc, Vivaldi, Chromium), else Microsoft Edge, else Google Chrome, else Playwright's own Chromium, with a
// persistent profile in playwright-tests/<product>/.auth/browser-profile. The human signs in there themselves (single
// sign-on, MFA and CAPTCHA included). The window closes by itself once the session is saved: a cookie for the target's
// host is new or changed, stays so for about 3 seconds, and the page has left the login page. A 5-minute ceiling ends
// it otherwise, and the human may close the window sooner: what was captured so far is saved. The session is saved as
// the run-config's session_state_file. Some single sign-on providers refuse an automated Chromium (`playwright
// codegen`); a real browser with its own profile gets through, and the profile keeps the identity provider's sign-in
// for the next login.
//
// The script navigates once, to the target URL, and never types or clicks: everything on the page is the human's. It
// snapshots the session every few seconds, so a window closed early still leaves the last session it saw.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loginBrowser, runChecks } from "./doctor.mjs";
import { writeAtomic, writeJson } from "./files.mjs";

export const LOGIN_SECONDS = 300; // the ceiling
export const STABLE_MS = 3000;
const SNAPSHOT_MS = 2000;
const slash = (p) => String(p ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const loginPaths = (cfg) => ({
  state: slash(cfg.authorizations?.session_state_file || `playwright-tests/${cfg.product}/.auth/state.json`),
  // under playwright-tests/*/.auth/, which .gitignore covers: the profile holds live cookies too
  profile: `playwright-tests/${cfg.product}/.auth/browser-profile`,
});

// browser: {channel?, executablePath?} (neither = Playwright's own Chromium)
async function launchBrowser(profileDir, browser = {}) {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, { headless: false, viewport: null, ...(browser.channel ? { channel: browser.channel } : {}), ...(browser.executablePath ? { executablePath: browser.executablePath } : {}) });
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};
// the hosts whose cookies mean "signed in": the target's, and each module's entry host
export const loginHosts = (cfg) => [...new Set([cfg.target?.url, ...(cfg.modules ?? []).map((m) => m.entry_url)].map(hostOf).filter(Boolean))];
// a cookie belongs to a host when its domain is that host or a parent of it (".acme.test" covers "app.acme.test")
const covers = (domain, hosts) => {
  const d = String(domain ?? "").replace(/^\./, "").toLowerCase();
  return !!d && hosts.some((h) => h === d || h.endsWith(`.${d}`));
};
// name|domain|path -> value and expiry, for the cookies of the target's hosts (values are compared, never logged)
export function targetCookies(state, hosts) {
  const out = new Map();
  for (const c of state?.cookies ?? []) if (covers(c.domain, hosts)) out.set(`${c.name}|${c.domain}|${c.path ?? "/"}`, `${c.value ?? ""}|${c.expires ?? ""}`);
  return out;
}
// the keys of cookies in `now` that are new or changed against `base`, sorted
export const changedCookies = (base, now) => [...now].filter(([k, v]) => base.get(k) !== v).map(([k]) => k).sort();
const pageKey = (u) => {
  try {
    const x = new URL(u);
    return x.origin + x.pathname;
  } catch {
    return null;
  }
};

// Sets authorizations.authenticated_crawl: true and session_state_file: <file> in the run-config's text, value only
// (indentation and comments stay). -> {text, changed} | {missing: [key]} when the config does not have the key's line.
export function setLoginKeys(text, stateFile) {
  const keys = [["authenticated_crawl", "true"], ["session_state_file", stateFile]];
  let out = text;
  const missing = [];
  for (const [key, value] of keys) {
    const re = new RegExp(`^(  ${key}:)([ \\t]*)("[^"\\n]*"|'[^'\\n]*'|[^\\s#]+)?`, "m");
    if (!re.test(out)) missing.push(key);
    // an empty value keeps a space before a comment that follows it
    else out = out.replace(re, (m, k, sp, _v, at, all) => `${k}${sp || " "}${value}${all[at + m.length] === "#" ? " " : ""}`);
  }
  return missing.length ? { missing } : { text: out, changed: out !== text };
}

// cfg: the validated run-config read from configFile (text: its source). validate(text) -> [errors] re-checks the
// rewritten config before it is written. seconds is the ceiling (default 5 minutes); run is the default-browser
// detection's command runner (injectable). -> {saved, url, browser, seconds, closedBy, closedEarly, cookies, session,
// configUpdated, next?} | {errors, fix?}   closedBy: "signed-in" | "window" (the human closed it) | "timeout"
export async function login({ cfg, configFile, text, validate, root, seconds = LOGIN_SECONDS, launch = launchBrowser, wait = sleep, log = (m) => console.error(m), sys, exists = existsSync, run, now = Date.now }) {
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 900) return { errors: [`--seconds must be a whole number from 10 to 900 (got ${seconds})`] };
  const url = cfg.target?.url;
  const p = loginPaths(cfg);
  const picked = loginBrowser({ sys, exists, run });
  const { name } = picked;
  const hosts = loginHosts(cfg);

  let ctx;
  try {
    mkdirSync(path.resolve(root, p.profile), { recursive: true });
    ctx = await launch(path.resolve(root, p.profile), { ...(picked.channel ? { channel: picked.channel } : {}), ...(picked.executablePath ? { executablePath: picked.executablePath } : {}) });
  } catch (e) {
    const why = String(e?.message ?? e).split("\n")[0];
    return { errors: [`could not open ${name}: ${why}`], fix: /already running|in use|ProcessSingleton|lock/i.test(why) ? `close the other login window (it uses ${p.profile}), then run the login again` : "install Microsoft Edge (or Google Chrome), then run the login again" };
  }
  let closed = false;
  ctx.on("close", () => (closed = true));
  let state = null;
  let closedBy = "timeout";
  const snapshot = async () => {
    try {
      state = await ctx.storageState();
    } catch {}
  };
  try {
    // what the profile already holds is not a sign-in: only a cookie new or changed against this counts
    // (not kept as `state`: a window closed before the first snapshot saves nothing)
    const base = targetCookies(await ctx.storageState().catch(() => null), hosts);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // a slow single sign-on redirect is no reason to stop: the window stays open for the human either way
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    const landing = pageKey(page.url?.());
    log(`${name} is open on ${url}: sign in there. The window closes by itself and saves the session once you are signed in (or after ${seconds >= 60 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`} at most); you can also close it yourself when you are done.`);
    const away = () => !!landing && ctx.pages().some((pg) => { const k = pageKey(pg.url?.()); return k && k !== landing; });
    let elapsed = 0;
    let sig = "";
    let changedAt = 0;
    while (elapsed < seconds * 1000 && !closed) {
      const step = Math.min(SNAPSHOT_MS, seconds * 1000 - elapsed);
      await wait(step);
      elapsed += step;
      if (closed) break;
      await snapshot();
      const now2 = changedCookies(base, targetCookies(state, hosts)).join(",");
      if (now2 !== sig) (sig = now2), (changedAt = elapsed);
      if (sig && elapsed - changedAt >= STABLE_MS && away()) {
        closedBy = "signed-in";
        break;
      }
    }
    if (closed) closedBy = "window";
  } finally {
    if (!closed) await snapshot();
    await ctx.close().catch(() => {});
  }
  const closedEarly = closedBy === "window";
  if (!state) return { errors: ["the browser closed before a session could be saved: run the login again and leave the window open until it closes by itself"] };

  const stateFile = path.resolve(root, p.state);
  writeJson(stateFile, state);
  log(`Saved ${p.state} (git-ignored; it holds live cookies, never share it).`);

  const keys = setLoginKeys(text, p.state);
  let configUpdated = false;
  const next = [];
  if (keys.missing) next.push(`add authorizations.${keys.missing.join(" and authorizations.")} to ${slash(configFile)}: authenticated_crawl: true, session_state_file: ${p.state}`);
  else if (keys.changed) {
    const errors = validate(keys.text);
    if (errors.length) next.push(`set authorizations.authenticated_crawl: true and session_state_file: ${p.state} in ${slash(configFile)} (not written: ${errors.join("; ")})`);
    else writeAtomic(configFile, keys.text), (configUpdated = true);
  }
  if (configUpdated) next.push("a run already active keeps the config it started with: the login applies to it only if it already used this session file");

  const authed = { ...cfg, authorizations: { ...cfg.authorizations, authenticated_crawl: true, session_state_file: p.state } };
  const [check] = (await runChecks(authed, ["session"], { root, now: now() })).filter((c) => c.id === "session");
  const result = { saved: p.state, url, browser: picked.channel ?? (picked.executablePath ? picked.name : "chromium"), defaultBrowser: picked.source === "default", seconds, closedBy, closedEarly, cookies: (state.cookies ?? []).length, session: { ok: check.ok, ...(check.level === "warn" ? { warn: true } : {}), detail: check.detail }, configUpdated, ...(next.length ? { next } : {}) };
  return check.ok ? result : { ...result, errors: [`${check.detail}: sign in in the window and wait for it to close by itself (run the login again${closedBy === "timeout" ? "; the window waited the full time without a session change" : ""})`] };
}
