// GitHub Copilot custom agent file (.github/agents/<name>.agent.md), read by VS Code Copilot Chat, Copilot CLI and the
// cloud coding agent. `agents` is the subagent allow-list; only entry agents are user-invocable, and they cannot be
// invoked as subagents. The identity hook tells the guard which agent is calling (see config/platforms.yaml).
import { assemble, generatedNote } from "./common.mjs";

const list = (xs) => `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;

export function render({ name, meta, body, eol, tools, caps, model, platform }) {
  const entry = meta.user_invocable === true;
  const lines = [generatedNote(name), `name: ${name}`, `description: ${JSON.stringify(meta.description.trim())}`, `tools: ${list(tools)}`];
  if (caps.spawn.length) lines.push(`agents: ${list(caps.spawn)}`);
  lines.push(`model: ${JSON.stringify(model)}`, `user-invocable: ${entry}`);
  if (entry) lines.push("disable-model-invocation: true");
  const hook = platform.identity_hook;
  if (hook) lines.push("hooks:", `  ${hook.event}:`, "    - type: command", `      command: ${JSON.stringify(hook.command.replaceAll("{name}", name))}`, "      cwd: \".\"");
  return assemble(lines, body, eol);
}
