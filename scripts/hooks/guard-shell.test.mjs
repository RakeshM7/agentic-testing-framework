import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decide, extractCommand } from "./guard-shell.mjs";
import { validateRunConfig as validate } from "../run-config.mjs";

const hook = fileURLToPath(new URL("./guard-shell.mjs", import.meta.url));
const K6 = "k6 run api-tests/k6/scripts/x-test.js";
// The payload shapes each platform sends for a shell call.
const shapes = {
  claude: { tool_name: "Bash", tool_input: { command: K6 } },
  vscode: { tool_name: "run_in_terminal", tool_input: { command: K6, explanation: "x" } },
  copilotPascal: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: K6 } },
  copilotCamel: { toolName: "bash", toolArgs: { command: K6, description: "x" } },
  copilotCamelString: { toolName: "bash", toolArgs: JSON.stringify({ command: K6 }) },
};
const fullRunConfig = () => ({ cfg: { target: { url: "https://a.example.com" }, authorizations: { mode: "full-run" } }, validate });
const readonlyConfig = () => ({ cfg: { target: { url: "https://a.example.com" } }, validate });

test("every platform's payload shape yields the command", () => {
  for (const [name, p] of Object.entries(shapes)) assert.equal(extractCommand(p).command, K6, name);
});
test("readonly blocks live k6 on every platform shape", () => {
  for (const [name, p] of Object.entries(shapes)) assert.match(decide(p, {}, readonlyConfig) ?? "", /readonly/, name);
});
test("non-shell tools pass even when their content mentions k6 run (VS Code ignores matchers)", () => {
  assert.equal(decide({ tool_name: "create_file", tool_input: { content: K6 } }, {}, readonlyConfig), null);
  assert.equal(decide({ tool_name: "Write", tool_input: { content: K6 } }, {}, readonlyConfig), null);
});
test("non-mutating shell commands pass in readonly", () => {
  assert.equal(decide({ tool_name: "Bash", tool_input: { command: "k6 inspect x-test.js" } }, {}, readonlyConfig), null);
  assert.equal(decide({ tool_name: "Bash", tool_input: { command: "curl -s https://a.example.com/api" } }, {}, readonlyConfig), null);
});
test("mutating curl is blocked in readonly", () => {
  assert.match(decide({ tool_name: "Bash", tool_input: { command: "curl -X DELETE https://a/x" } }, {}, readonlyConfig), /mutating curl/);
  assert.match(decide({ tool_name: "Bash", tool_input: { command: "curl -d '{}' https://a/x" } }, {}, readonlyConfig), /request body/);
});
test("local full-run via env alone is unchanged", () => {
  assert.equal(decide(shapes.claude, { AUTHORIZATIONS_MODE: "full-run" }, readonlyConfig), null);
});
test("cloud agent: env alone is not enough; env + full-run config is", () => {
  const env = { AUTHORIZATIONS_MODE: "full-run", GITHUB_ACTIONS: "true" };
  assert.match(decide(shapes.copilotCamel, env, fullRunConfig), /AUTHORIZATIONS_CONFIG/);
  assert.match(decide(shapes.copilotCamel, { ...env, AUTHORIZATIONS_CONFIG: "config/x.yaml" }, readonlyConfig), /both must say full-run/);
  assert.equal(decide(shapes.copilotCamel, { ...env, AUTHORIZATIONS_CONFIG: "config/x.yaml" }, fullRunConfig), null);
});
test("a named config must agree on any platform, and an unreadable one blocks", () => {
  const env = { AUTHORIZATIONS_MODE: "full-run", AUTHORIZATIONS_CONFIG: "config/x.yaml" };
  assert.match(decide(shapes.claude, env, readonlyConfig), /both must say full-run/);
  assert.match(decide(shapes.claude, env, () => { throw new Error("ENOENT"); }), /could not be read/);
});
test("CLI: exit 2 with a deny decision, exit 0 otherwise", () => {
  const run = (payload, env = {}) =>
    spawnSync("node", [hook], { input: JSON.stringify(payload), env: { PATH: process.env.PATH, ...env }, encoding: "utf8" });
  const blocked = run(shapes.copilotCamel);
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /Blocked by scripts\/hooks\/guard-shell\.mjs/);
  assert.equal(JSON.parse(blocked.stdout).permissionDecision, "deny");
  assert.equal(run({ tool_name: "Bash", tool_input: { command: "ls" } }).status, 0);
  const cloud = run(shapes.copilotCamel, { AUTHORIZATIONS_MODE: "full-run", GITHUB_ACTIONS: "true", AUTHORIZATIONS_CONFIG: "config/run-config.example.yaml" });
  assert.equal(cloud.status, 2, "the shipped example config is readonly, so the cloud gate must still block");
});
