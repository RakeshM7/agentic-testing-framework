// The Playwright MCP browser tools, by what they can do to the product under test. One list, used by the agent build
// (which tools an agent with `live_target.browser: read | mutate` gets) and by the guard (which calls are mutating).
// Names are the tool's short name, without the platform's prefix (mcp__playwright__browser_<name>, playwright/browser_<name>).
// Dependency-free: the guard imports it on every hook call.

// Navigate and observe. `click` is here on purpose: navigation needs it.
export const BROWSER_READ = ["navigate", "navigate_back", "snapshot", "click", "hover", "take_screenshot", "wait_for", "tabs", "resize", "console_messages", "network_requests"];

// Type, submit or run code. Granted only with `browser: mutate`.
export const BROWSER_MUTATE = ["type", "fill_form", "select_option", "press_key", "file_upload", "drag", "drop", "handle_dialog", "evaluate"];

// Ends the agent's own browser session, so the next call starts a clean one from the saved login state. Changes nothing
// in the product. Granted only with `browser_session: fresh` in config/permissions.yaml (D-047).
export const BROWSER_SESSION = ["close"];

// Never granted to any agent; still classified, so a call that reaches the guard anyway is treated as mutating.
const NEVER_GRANTED = ["run_code_unsafe"];

const MUTATING = new Set([...BROWSER_MUTATE, ...NEVER_GRANTED]);
export const isMutatingBrowserTool = (name) => MUTATING.has(name);
