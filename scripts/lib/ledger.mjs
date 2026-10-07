// Product-level, append-only ledger of entities runs created in the target: artifacts/<product>/state/ledger.jsonl
// Every entry carries the runId that wrote it. Destructive actions are allowed only on entities that are live
// AND were created by the CURRENT run. Each add is one O_APPEND line write, so parallel writers cannot corrupt it.
// Dependency-free on purpose: the PreToolUse hook imports this.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED = ["runId", "event", "type", "ref", "module", "stage", "agent"];

export function append(ledgerFile, entry) {
  for (const k of REQUIRED) if (typeof entry[k] !== "string" || !entry[k]) throw new Error(`ledger entry needs a non-empty '${k}'`);
  if (!["created", "deleted"].includes(entry.event)) throw new Error("ledger event must be 'created' or 'deleted'");
  const line = { ts: new Date().toISOString(), ...entry };
  mkdirSync(path.dirname(ledgerFile), { recursive: true });
  appendFileSync(ledgerFile, JSON.stringify(line) + "\n", "utf8");
  return line;
}

export function read(ledgerFile) {
  if (!existsSync(ledgerFile)) return [];
  return readFileSync(ledgerFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`${ledgerFile}:${i + 1}: not valid JSON`);
      }
    });
}

// Created and not yet deleted. runId filters to entities created by that run (undefined = any run).
export function live(ledgerFile, runId) {
  const open = new Map();
  for (const e of read(ledgerFile)) {
    const k = `${e.type}\u0000${e.ref}`;
    if (e.event === "created") open.set(k, e);
    else open.delete(k);
  }
  return [...open.values()].filter((e) => runId === undefined || e.runId === runId);
}

export const owns = (ledgerFile, runId, type, ref) => live(ledgerFile, runId).some((e) => e.type === type && e.ref === ref);
