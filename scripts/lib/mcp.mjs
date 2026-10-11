// config/mcp.yaml -> one platform's MCP config file (`mcp_config` in config/platforms.yaml): the same servers under
// the key that platform expects (.mcp.json: mcpServers, .vscode/mcp.json: servers).

export function validateMcp(mcp) {
  const errors = [];
  if (!mcp || typeof mcp.servers !== "object") return ["config/mcp.yaml: needs a 'servers' mapping"];
  if (!mcp.servers[mcp.browser_server]) errors.push(`config/mcp.yaml: browser_server '${mcp.browser_server}' is not in servers`);
  return errors;
}

export const renderMcpConfig = (mcp, key) => JSON.stringify({ [key]: mcp.servers }, null, 2) + "\n";
