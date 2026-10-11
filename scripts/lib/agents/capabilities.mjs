// A resolved permissions row (scripts/lib/permissions.mjs) -> the agent's neutral capabilities, and those capabilities
// -> one platform's ordered tool names (data from config/platforms.yaml). Shared by every renderer, so a prompt can
// never grant an agent a tool its permissions row does not allow, on any platform.
import { BROWSER_MUTATE, BROWSER_READ } from "../browser-tools.mjs";

// Order of the capabilities in a rendered `tools:` list.
export const CAPABILITIES = ["read", "search", "write", "shell", "web_fetch", "web_search", "spawn", "browser", "ask"];

export function capabilitiesFor(row) {
  return {
    read: true,
    search: true,
    write: row.filesystem.write.length > 0,
    shell: row.shell !== "none",
    web_fetch: row.web_research === "allowed" || row.live_target.http !== "none",
    web_search: row.web_research === "allowed",
    spawn: row.spawns, // [] = cannot spawn
    browser: row.live_target.browser, // none | read | mutate
    ask: row.ask_user === "allowed",
  };
}

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? values[k] : m));

export function browserTools(level) {
  if (level === "none") return [];
  return level === "mutate" ? [...BROWSER_READ, ...BROWSER_MUTATE] : BROWSER_READ;
}

// -> ordered, de-duplicated tool names for `platform` (a config/platforms.yaml entry).
export function toolNames(caps, platform, browserServer) {
  const map = platform.tools ?? {};
  const out = [];
  for (const c of CAPABILITIES) {
    if (c === "spawn") {
      if (caps.spawn.length) out.push(fill(map.spawn, { agents: caps.spawn.join(", ") }));
    } else if (c === "browser") {
      for (const tool of browserTools(caps.browser)) out.push(fill(map.browser, { server: browserServer, tool }));
    } else if (caps[c]) {
      if (!Array.isArray(map[c])) throw new Error(`config/platforms.yaml: tools.${c} must be a list`);
      out.push(...map[c]);
    }
  }
  return [...new Set(out)];
}
