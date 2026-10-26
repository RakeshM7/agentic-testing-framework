// Claude Code subagent file (.claude/agents/<name>.md): comma-separated `tools`, `mcpServers` for browser agents,
// `model`, `color`.
import { assemble, generatedNote } from "./common.mjs";

export function render({ name, meta, body, eol, tools, caps, model, browserServer, fw = "" }) {
  const lines = [generatedNote(name, fw), `name: ${name}`, `description: ${JSON.stringify(meta.description.trim())}`, `tools: ${tools.join(", ")}`];
  if (caps.browser !== "none") lines.push("mcpServers:", `  - ${browserServer}`);
  lines.push(`model: ${model}`);
  if (meta.color) lines.push(`color: ${meta.color}`);
  return assemble(lines, body, eol);
}
