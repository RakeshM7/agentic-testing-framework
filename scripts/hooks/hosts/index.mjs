// Shared by the hook entries: the registration's arguments, and the adapter for the host it asserts with --host
// (see scripts/lib/hosts.mjs for what each host can tell the guard).
import { parseArgs } from "node:util";

const ADAPTERS = { "claude-code": "./claude.mjs", vscode: "./copilot.mjs", copilot: "./copilot.mjs" };

export const hookArgs = (argv = process.argv.slice(2)) =>
  parseArgs({ args: argv, options: { host: { type: "string" }, agent: { type: "string" } }, strict: false }).values;

export function adapterFor(host) {
  if (!ADAPTERS[host]) throw new Error(`unknown --host '${host}' (one of: ${Object.keys(ADAPTERS).join(", ")})`);
  return import(ADAPTERS[host]);
}
