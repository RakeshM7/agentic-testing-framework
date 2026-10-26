// Time and effort of a run (D-079). Three sources, all recorded as the run goes:
//   - stages: run.json startedAt / finishedAt / attempts (run.mjs);
//   - domain steps: state/orchestration/<domain>-<module>.json startedAt / at per step (orchestration.mjs);
//   - agent spawns: one line per spawn in the active run's state/telemetry.jsonl, appended by the PostToolUse hook
//     (scripts/hooks/posttooluse.mjs) with the caller, the agent started and whatever the host's response reports:
//     its duration, tokens and tool uses (Claude Code's agent tool reports them; a host that does not leaves them out).
// Token cost beyond that comes from the host's own telemetry (e.g. Claude Code's OpenTelemetry export), not from here.
// Dependency-free: the PostToolUse hook imports it.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { findActiveRuns } from "./guard.mjs";

export const TELEMETRY = "telemetry.jsonl";
const num = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);

// The numbers a host's response to a spawn reports, under the names hosts use. -> {durationMs?, tokens?, toolUses?}
export function spawnMetrics(response) {
  const r = response && typeof response === "object" ? response : {};
  const out = { durationMs: num(r.totalDurationMs ?? r.durationMs ?? r.duration_ms), tokens: num(r.totalTokens ?? r.usage?.total_tokens), toolUses: num(r.totalToolUseCount ?? r.toolUseCount) };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

// Appends one spawn of the single active run (several active runs, or a broken one: nothing, since the spawn's run
// can't be told). -> the line written, or null
export function recordSpawn(root, call, response, at = new Date().toISOString()) {
  if (call?.kind !== "spawn") return null;
  const runs = findActiveRuns(root);
  if (runs.length !== 1 || runs[0].broken) return null;
  const run = runs[0];
  const line = { at, runId: run.runId, host: call.host, caller: call.agent ?? null, agent: call.subagent ?? null, ...spawnMetrics(response) };
  mkdirSync(run.stateDir, { recursive: true });
  appendFileSync(path.join(run.stateDir, TELEMETRY), JSON.stringify(line) + "\n", "utf8");
  return line;
}

export function readSpawns(stateDir, runId) {
  const f = path.join(stateDir, TELEMETRY);
  if (!existsSync(f)) return null;
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  }).filter((x) => x.runId === runId);
}

const ms = (a, b) => (a && b ? Math.max(0, Date.parse(b) - Date.parse(a)) : null);

// -> {stages: [{key, status, attempts, durationMs}], steps: [{domain, module, steps, durationMs, longest}], agents:
//     [{agent, spawns, durationMs, tokens, toolUses}], totals: {stageMs, stepMs, spawns, tokens}, spawnsRecorded}
export function effort({ run, stateDir }) {
  const stages = Object.entries(run.stages ?? {}).map(([key, s]) => ({ key, status: s.status, attempts: s.attempts ?? 0, durationMs: s.status === "running" ? null : ms(s.startedAt, s.finishedAt) }));
  const steps = [];
  const dir = path.join(stateDir, "orchestration");
  for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("_")).sort() : []) {
    let s;
    try {
      s = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue;
    }
    if (s.runId !== run.runId) continue;
    const timed = Object.entries(s.steps ?? {}).map(([name, x]) => ({ name, durationMs: x.status === "running" ? null : ms(x.startedAt, x.at) })).filter((x) => x.durationMs !== null);
    const longest = timed.reduce((a, x) => (!a || x.durationMs > a.durationMs ? x : a), null);
    steps.push({ domain: s.domain ?? f.replace(/-[^-]+\.json$/, ""), module: s.module ?? null, steps: Object.keys(s.steps ?? {}).length, durationMs: timed.reduce((n, x) => n + x.durationMs, 0), longest: longest ? longest.name : null });
  }
  const spawns = readSpawns(stateDir, run.runId);
  const byAgent = new Map();
  for (const x of spawns ?? []) {
    const a = byAgent.get(x.agent ?? "unknown") ?? { agent: x.agent ?? "unknown", spawns: 0, durationMs: 0, tokens: 0, toolUses: 0 };
    a.spawns++;
    a.durationMs += x.durationMs ?? 0;
    a.tokens += x.tokens ?? 0;
    a.toolUses += x.toolUses ?? 0;
    byAgent.set(a.agent, a);
  }
  const agents = [...byAgent.values()].sort((a, b) => b.spawns - a.spawns || a.agent.localeCompare(b.agent));
  return {
    stages,
    steps,
    agents,
    spawnsRecorded: spawns !== null,
    totals: {
      stageMs: stages.reduce((n, s) => n + (s.durationMs ?? 0), 0),
      stepMs: steps.reduce((n, s) => n + s.durationMs, 0),
      spawns: agents.reduce((n, a) => n + a.spawns, 0),
      tokens: agents.reduce((n, a) => n + a.tokens, 0),
    },
  };
}
