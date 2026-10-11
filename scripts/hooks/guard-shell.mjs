#!/usr/bin/env node
// PreToolUse hook: code-level enforcement of `authorizations.mode`, shared by every platform.
//   Claude Code:                   .claude/settings.json (matcher Bash)
//   GitHub Copilot (VS Code, CLI,  .github/hooks/authorization-guard.json (PascalCase PreToolUse,
//   cloud coding agent):           Claude-shaped payload; VS Code ignores matchers, so this script
//                                  filters by tool name itself)
// Unless AUTHORIZATIONS_MODE=full-run is set in the environment the agent was launched with, block
// live load tests (`k6 run`/`k6 cloud`) and mutating HTTP verbs issued from the shell.
// If AUTHORIZATIONS_CONFIG names a run-config, its authorizations.mode must also be full-run. On the
// GitHub cloud coding agent (GITHUB_ACTIONS=true) that config is required: env and config must agree.
// Exit code 2 = block (stderr is fed back to the model); all platforms treat it as a deny.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Shell tool names across Claude Code, VS Code (local agent) and Copilot CLI / cloud agent.
const SHELL_TOOLS = new Set(["bash", "powershell", "local_shell", "runinterminal", "run_in_terminal", "execute"]);

const RULES = [
  [/\bk6\s+(run|cloud)\b/, "live k6 load tests require authorizations.mode: full-run"],
  [/\bcurl\b[^|;&]*(-X|--request)\s*['"]?(POST|PUT|PATCH|DELETE)\b/i, "mutating curl requests require full-run"],
  [/\bcurl\b[^|;&]*(-d|--data(-\w+)?|-F|--form)\b/, "curl with a request body (implicit POST) requires full-run"],
];

// Normalizes the three payload shapes to { toolName, command }:
//   Claude Code / VS Code / Copilot PascalCase: { tool_name, tool_input: { command } }
//   Copilot camelCase:                          { toolName, toolArgs: { command } | "<json>" }
export function extractCommand(payload) {
  const toolName = String(payload?.tool_name ?? payload?.toolName ?? "");
  let input = payload?.tool_input ?? payload?.toolArgs ?? {};
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      input = { command: input };
    }
  }
  return { toolName, command: String(input?.command ?? "") };
}

function configMode(configPath, loadConfig) {
  try {
    const { cfg, validate } = loadConfig(path.resolve(repoRoot, configPath));
    const { errors, normalized } = validate(cfg);
    if (errors.length) return { error: `AUTHORIZATIONS_CONFIG ${configPath} is invalid: ${errors.join("; ")}` };
    return { mode: normalized.authorizations.mode };
  } catch (e) {
    return { error: `AUTHORIZATIONS_CONFIG ${configPath} could not be read: ${e.message}` };
  }
}

// Returns null to allow, or the reason to block.
export function decide(payload, env, loadConfig) {
  const { toolName, command } = extractCommand(payload);
  if (toolName && !SHELL_TOOLS.has(toolName.toLowerCase())) return null; // not a shell call (e.g. writing a file that mentions k6)
  const hit = RULES.find(([re]) => re.test(command));
  if (!hit) return null;
  const why = hit[1];
  if (env.AUTHORIZATIONS_MODE !== "full-run")
    return `${why}. Mode is readonly (AUTHORIZATIONS_MODE != full-run). A human must relaunch with AUTHORIZATIONS_MODE=full-run for a target they are authorized to mutate.`;
  const cloud = env.GITHUB_ACTIONS === "true";
  if (!env.AUTHORIZATIONS_CONFIG) {
    if (!cloud) return null;
    return `${why}. On the GitHub cloud coding agent, full-run also requires AUTHORIZATIONS_CONFIG to name a run-config whose authorizations.mode is full-run (set both as Copilot environment variables).`;
  }
  const { mode, error } = configMode(env.AUTHORIZATIONS_CONFIG, loadConfig);
  if (error) return `${why}. ${error}`;
  if (mode !== "full-run")
    return `${why}. AUTHORIZATIONS_MODE is full-run but ${env.AUTHORIZATIONS_CONFIG} has authorizations.mode: ${mode}; both must say full-run.`;
  return null;
}

// Loaded lazily so the readonly path never depends on scripts/node_modules being installed.
async function makeLoader() {
  const [{ default: yaml }, { validateRunConfig }] = await Promise.all([import("js-yaml"), import("../run-config.mjs")]);
  return (abs) => ({ cfg: yaml.load(readFileSync(abs, "utf8")), validate: validateRunConfig });
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  let loader = () => {
    throw new Error("loader not initialized");
  };
  if (process.env.AUTHORIZATIONS_CONFIG) {
    try {
      loader = await makeLoader();
    } catch (e) {
      loader = () => {
        throw new Error(`cannot load the run-config validator (run npm ci in scripts/): ${e.message}`);
      };
    }
  }
  const reason = decide(payload, process.env, loader);
  if (!reason) process.exit(0);
  const message = `Blocked by scripts/hooks/guard-shell.mjs: ${reason}`;
  console.error(message);
  // Copilot hooks also read a decision from stdout; Claude Code ignores stdout on exit 2.
  console.log(JSON.stringify({ permissionDecision: "deny", permissionDecisionReason: message }));
  process.exit(2);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
