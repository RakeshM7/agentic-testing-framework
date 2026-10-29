// The Playwright MCP browser tools, by what they can do to the product under test. One list, used by the agent build
// (which tools an agent with `live_target.browser: read | mutate` gets) and by the guard (which calls are mutating).
// Names are the tool's short name, without the platform's prefix (mcp__playwright__browser_<name>,
// playwright/browser_<name>, and mcp__plugin_atf_playwright__browser_<name> from the framework's Claude Code plugin,
// read by scripts/hooks/hosts/claude.mjs).
// Dependency-free: the guard imports it on every hook call.

import { configText } from "./config.mjs";
import { frameworkRoot, workspaceRoot } from "./roots.mjs";

// Navigate and observe. `click` is here on purpose: navigation needs it.
export const BROWSER_READ = ["navigate", "navigate_back", "snapshot", "click", "hover", "take_screenshot", "wait_for", "tabs", "resize", "console_messages", "network_requests"];

// Input: type, fill, select and press keys. Part of `browser: mutate`; in a readonly run the guard allows them too, but
// only while the browser server runs the framework's init page, whose network guard aborts every write a key press or a
// click could send to the product (D-076).
export const BROWSER_INPUT = ["type", "fill_form", "select_option", "press_key"];

// Type, submit or run code. Granted only with `browser: mutate`.
export const BROWSER_MUTATE = [...BROWSER_INPUT, "file_upload", "drag", "drop", "handle_dialog", "evaluate"];

// Ends the agent's own browser session, so the next call starts a clean one from the saved login state. Changes nothing
// in the product. Granted only with `browser_session: fresh` in config/permissions.yaml (D-047).
export const BROWSER_SESSION = ["close"];

// Never granted to any agent; still classified, so a call that reaches the guard anyway is treated as mutating.
const NEVER_GRANTED = ["run_code_unsafe"];

const MUTATING = new Set([...BROWSER_MUTATE, ...NEVER_GRANTED]);
export const isMutatingBrowserTool = (name) => MUTATING.has(name);
export const isInputBrowserTool = (name) => BROWSER_INPUT.includes(name);

// The init page the browser server must run for readonly input (scripts/browser/init-page.cjs), and whether the
// effective config/mcp.yaml -- the one source of every host's MCP config (D-028), as the workspace has it (the
// framework's copy, or the workspace's atf/ override of it, scripts/lib/config.mjs) -- passes it, by its path from the
// workspace (`{fw}/`, D-085) or as written in a same-root repo. Read as text: with no override the guard stays
// dependency-free; an override is parsed and dumped (js-yaml). Any failure, a bad override included, reads as "not
// guarded" (fails closed). `framework`: the framework root; `workspace`: the workspace root (the run's).
export const INIT_PAGE = "scripts/browser/init-page.cjs";
const INIT_PAGE_ARG = /^[ \t]*-[ \t]*["']?--init-page(?:["']?[ \t]*\r?\n[ \t]*-[ \t]*|=)["']?(?:\{fw\}\/)?scripts\/browser\/init-page\.cjs["']?[ \t]*\r?$/m;
export function networkGuarded(framework = frameworkRoot, workspace = workspaceRoot) {
  try {
    return INIT_PAGE_ARG.test(configText("mcp.yaml", { framework, workspace }));
  } catch {
    return false;
  }
}

// The effective mcp.yaml's `browser_server` key (the workspace's override counts), read from the text like
// networkGuarded so the guard loads no YAML parser; null when it can't be read. A host adapter whose tool names carry
// the server judges only this server's browser_* tools as the framework's browser (D-070): a `playwright-ext` server
// driving the user's own Chrome is not it.
const BROWSER_SERVER = /^browser_server:[ \t]*(["']?)([A-Za-z0-9_-]+)\1[ \t]*(?:#.*)?\r?$/m;
export function browserServer(framework = frameworkRoot, workspace = workspaceRoot) {
  try {
    return BROWSER_SERVER.exec(configText("mcp.yaml", { framework, workspace }))?.[2] ?? null;
  } catch {
    return null;
  }
}
