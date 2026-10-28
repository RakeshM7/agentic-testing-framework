// Google Antigravity agent file (.agents/agents/<name>.md), read by the Antigravity App, the agy CLI and the IDE. Entry
// agents are the main agent (`mainAgent: true`) and cannot be invoked as subagents; every other agent is a subagent
// only. `model` comes from config/models.yaml (`inherit`: the human picks the model in Antigravity's picker).
// `commandExecutionPolicy` is defence in depth, never the authority (the guard is, through .agents/hooks.json): an
// agent runs its commands unsandboxed (`auto`) when its permissions row gives it any live target (browser, HTTP or
// load not `none`) or its shell allow-list names a command that needs the network (npm, npx, playwright, k6, or
// foundation.mjs install, which runs `npm install` and `npx playwright install chromium`); every other agent runs in
// Antigravity's sandbox (AG.md decision 6, provisional until the spike shows what the sandbox blocks). There is no
// subagent allow-list key, so the guard enforces `spawns`.
// No per-agent `mcpServers` (the workspace's .agents/mcp_config.json starts the servers) and no identity hook yet
// (config/platforms.yaml says why).
import { assemble, generatedNote } from "./common.mjs";

// UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/): the frontmatter keys mainAgent, subagent, model and
// commandExecutionPolicy, and the values auto | sandbox, are as antigravity.google/docs describe them.
// The program an allow-list entry runs (its first word, a path to it allowed; never an argument such as `--side k6`),
// or the framework script that installs packages.
const NETWORK_COMMAND = /^\s*(?:\S*[/\\])?(?:npm|npx|playwright|k6)(?:\.cmd|\.exe)?(?:\s|$)|\bfoundation\.mjs install\b/i;
export const needsNetworkShell = (shellAllow = []) => shellAllow.some((c) => NETWORK_COMMAND.test(c));
export const commandExecutionPolicy = (caps) =>
  [caps.browser, caps.http, caps.load].some((level) => level !== "none") || needsNetworkShell(caps.shellAllow) ? "auto" : "sandbox";

export function render({ name, meta, body, eol, tools, caps, model, fw = "", installed = false, dev }) {
  const entry = meta.user_invocable === true;
  const lines = [generatedNote(name, fw, installed, dev), `name: ${name}`, `description: ${JSON.stringify(meta.description.trim())}`, "tools:", ...tools.map((t) => `  - ${JSON.stringify(t)}`)];
  lines.push(`mainAgent: ${entry}`, `subagent: ${!entry}`, `model: ${JSON.stringify(model)}`, `commandExecutionPolicy: ${commandExecutionPolicy(caps)}`);
  return assemble(lines, body, eol);
}
