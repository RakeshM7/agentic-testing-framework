// The human's login (D-069), behind `run.mjs login <config.yaml>` (make login, or the orchestrator after the human
// confirms). It opens a real browser window on the target, Microsoft Edge when installed (else Google Chrome, else
// Playwright's own Chromium), with a persistent profile in playwright-tests/<product>/.auth/browser-profile. The human
// signs in there themselves (single sign-on, MFA and CAPTCHA included) within a fixed window; the window then closes by
// itself and the session is saved as the run-config's session_state_file. Some single sign-on providers refuse an
// automated Chromium (`playwright codegen`); a branded browser with its own profile gets through, and the profile keeps
// the identity provider's sign-in for the next login.
//
// The script navigates once, to the target URL, and never types or clicks: everything on the page is the human's. It
// snapshots the session every few seconds, so a window closed early still leaves the last session it saw.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loginChannel, runChecks } from "./doctor.mjs";
import { writeAtomic, writeJson } from "./files.mjs";

export const LOGIN_SECONDS = 60;
const SNAPSHOT_MS = 2000;
const BROWSER_NAMES = { msedge: "Microsoft Edge", chrome: "Google Chrome" };
const slash = (p) => String(p ?? "").replaceAll("\\", "/").replace(/^\.\//, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const loginPaths = (cfg) => ({
  state: slash(cfg.authorizations?.session_state_file || `playwright-tests/${cfg.product}/.auth/state.json`),
  // under playwright-tests/*/.auth/, which .gitignore covers: the profile holds live cookies too
  profile: `playwright-tests/${cfg.product}/.auth/browser-profile`,
});

async function launchBrowser(profileDir, channel) {
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(profileDir, { headless: false, viewport: null, ...(channel ? { channel } : {}) });
}

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
// rewritten config before it is written. -> {saved, url, browser, seconds, closedEarly, cookies, session, configUpdated,
// next?} | {errors, fix?}
export async function login({ cfg, configFile, text, validate, root, seconds = LOGIN_SECONDS, launch = launchBrowser, wait = sleep, log = (m) => console.error(m), sys, exists = existsSync, now = Date.now }) {
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) return { errors: [`--seconds must be a whole number from 10 to 600 (got ${seconds})`] };
  const url = cfg.target?.url;
  const p = loginPaths(cfg);
  const channel = loginChannel({ sys, exists });
  const name = BROWSER_NAMES[channel] ?? "Playwright's Chromium";

  let ctx;
  try {
    mkdirSync(path.resolve(root, p.profile), { recursive: true });
    ctx = await launch(path.resolve(root, p.profile), channel);
  } catch (e) {
    const why = String(e?.message ?? e).split("\n")[0];
    return { errors: [`could not open ${name}: ${why}`], fix: /already running|in use|ProcessSingleton|lock/i.test(why) ? `close the other login window (it uses ${p.profile}), then run the login again` : "install Microsoft Edge (or Google Chrome), then run the login again" };
  }
  let closed = false;
  ctx.on("close", () => (closed = true));
  let state = null;
  let closedEarly = false;
  const snapshot = async () => {
    try {
      state = await ctx.storageState();
    } catch {}
  };
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    // a slow single sign-on redirect is no reason to stop: the window stays open for the human either way
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    log(`${name} is open on ${url}: sign in within ${seconds} seconds. The window closes by itself and saves the session; do not close it yourself.`);
    for (let left = seconds * 1000; left > 0 && !closed; left -= SNAPSHOT_MS) {
      await wait(Math.min(SNAPSHOT_MS, left));
      if (!closed) await snapshot();
    }
  } finally {
    closedEarly = closed;
    if (!closed) await snapshot();
    await ctx.close().catch(() => {});
  }
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
  const result = { saved: p.state, url, browser: channel ?? "chromium", seconds, closedEarly, cookies: (state.cookies ?? []).length, session: { ok: check.ok, ...(check.level === "warn" ? { warn: true } : {}), detail: check.detail }, configUpdated, ...(next.length ? { next } : {}) };
  return check.ok ? result : { ...result, errors: [`${check.detail}: sign in within the window, then let it close by itself (run the login again${seconds < 120 ? ", with --seconds 120 for more time" : ""})`] };
}
