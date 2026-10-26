// config/mcp.yaml -> one platform's MCP config file (`mcp_config` in config/platforms.yaml): the same servers under
// the key that platform expects (.mcp.json: mcpServers, .vscode/mcp.json: servers), with every `{fw}` in a command or
// argument expanded to the framework's path from the workspace (D-085).
import { expandFw } from "./roots.mjs";

export function validateMcp(mcp) {
  const errors = [];
  if (!mcp || typeof mcp.servers !== "object") return ["config/mcp.yaml: needs a 'servers' mapping"];
  if (!mcp.servers[mcp.browser_server]) errors.push(`config/mcp.yaml: browser_server '${mcp.browser_server}' is not in servers`);
  return errors;
}

export const renderMcpConfig = (mcp, key, fw = "") =>
  JSON.stringify({ [key]: mcp.servers }, (k, v) => (typeof v === "string" ? expandFw(v, fw) : v), 2) + "\n";
