// The Playwright MCP browser tools, by what they can do to the product under test. One list, used by the agent build
// (which tools an agent with `live_target.browser: read | mutate` gets) and by the guard (which calls are mutating).
// Names are the tool's short name, without the platform's prefix (mcp__playwright__browser_<name>, playwright/browser_<name>).
// Dependency-free: the guard imports it on every hook call.

import { readFileSync } from "node:fs";
import path from "node:path";

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

// The init page the browser server must run for readonly input (scripts/browser/init-page.cjs), and whether
// config/mcp.yaml -- the one source of every host's MCP config (D-028) -- passes it. Read as text: the guard stays
// dependency-free. Any failure reads as "not guarded" (fails closed).
export const INIT_PAGE = "scripts/browser/init-page.cjs";
const INIT_PAGE_ARG = /^[ \t]*-[ \t]*["']?--init-page(?:["']?[ \t]*\r?\n[ \t]*-[ \t]*|=)["']?scripts\/browser\/init-page\.cjs["']?[ \t]*\r?$/m;
export function networkGuarded(root) {
  try {
    return INIT_PAGE_ARG.test(readFileSync(path.join(root, "config", "mcp.yaml"), "utf8"));
  } catch {
    return false;
  }
}
