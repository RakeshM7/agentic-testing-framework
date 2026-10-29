// Claude Code subagent file (.claude/agents/<name>.md): comma-separated `tools`, `mcpServers` for browser agents,
// `model`, `color`.
// The Claude Code plugin renders its agents through here too (scripts/build-plugin.mjs, docs/packaging.md §3.12), with
// two differences only it asks for: its own generated `note` (the file is in the plugin, not in a workspace, so neither
// atf sync nor a fragment changes it), and no `mcpServers` (Claude Code ignores the key in a plugin agent; the plugin's
// own .mcp.json starts the server). Both default to a workspace file's rendering.
import { assemble, generatedNote } from "./common.mjs";

export function render({ name, meta, body, eol, tools, caps, model, browserServer, fw = "", installed = false, dev, note, mcpServers = true }) {
  const lines = [note ?? generatedNote(name, fw, installed, dev), `name: ${name}`, `description: ${JSON.stringify(meta.description.trim())}`, `tools: ${tools.join(", ")}`];
  if (mcpServers && caps.browser !== "none") lines.push("mcpServers:", `  - ${browserServer}`);
  lines.push(`model: ${model}`);
  if (meta.color) lines.push(`color: ${meta.color}`);
  return assemble(lines, body, eol);
}
