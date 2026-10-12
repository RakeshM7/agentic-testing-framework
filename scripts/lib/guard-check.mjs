// The guard liveness check. Hooks can be silently off (an untrusted VS Code workspace, hooks disabled, a host that
// does not load them), and then nothing enforces the run's mode or permissions. So before a run's first stage the
// orchestrator runs `node scripts/run.mjs guard-check <product>`:
//   - a working hook BLOCKS that command, and the hook entry records which host and agent blocked it here;
//   - if the command actually runs, no hook intercepted it: run.mjs records `absent`.
// `run.mjs stage … start` then requires: no `absent` record, and a record that fits the run's mode (readonly: any
// hook; full-run: any hook too, except that on an agent-hook host the record must carry the agent, D-037).
// `run.mjs init` (also --resume) clears the records, so they always describe the current session. Dependency-free.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { paths } from "./contract.mjs";
import { identityOf, labelOf } from "./hosts.mjs";

const ABSENT = "absent.json";
const dirOf = (product, root) => path.join(paths(product, root).state, "guard-check");

export function clearGuardChecks(product, root) {
  rmSync(dirOf(product, root), { recursive: true, force: true });
}

// Called by the hook entry when the guard blocked the canary. Only for a product that has run state.
export function recordCanary(product, root, { host, agent }) {
  if (!existsSync(paths(product, root).state)) return;
  const dir = dirOf(product, root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${host}--${agent ?? "unidentified"}.json`), JSON.stringify({ host, identity: identityOf(host), agent: agent ?? null, at: new Date().toISOString() }) + "\n");
  rmSync(path.join(dir, ABSENT), { force: true });
}

// Called by run.mjs when the canary command actually executed.
export function markAbsent(product, root) {
  const dir = dirOf(product, root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, ABSENT), JSON.stringify({ at: new Date().toISOString() }) + "\n");
}

// -> { ready, reason? }
export function guardStatus(product, mode, root) {
  const dir = dirOf(product, root);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const how = `run \`node scripts/run.mjs guard-check ${product}\` from the agent session; a working guard blocks it`;
  if (files.includes(ABSENT)) return { ready: false, reason: `the guard did not intercept guard-check: hooks are not active in this session. Fix the host's hook setup (docs/platforms.md), then ${how}` };
  const records = files.map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  if (!records.length) return { ready: false, reason: `the guard has not been verified for this session: ${how}` };
  if (mode !== "full-run") return { ready: true };
  // On an agent-hook host an unidentified call counts as a human's own session and gets the mode rules only, so a
  // full-run there needs proof that the agents' own hooks run. Other hosts name the agent, or apply the run's combined
  // permissions to calls they cannot name (D-035).
  if (records.some((r) => identityOf(r.host) !== "agent-hook" || r.agent)) return { ready: true };
  const seen = [...new Set(records.map((r) => labelOf(r.host)))].join(", ");
  return { ready: false, reason: `full-run on ${seen} needs the custom agents' own hooks, and none blocked guard-check: start the run from orchestrator-agent in the agent picker (docs/platforms.md), then ${how}; or run in readonly` };
}
