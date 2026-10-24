// Stable ids for script-built artifacts (docs/conventions.md "Script-built agents", D-049). A registry file maps each
// key to an id assigned once, in key order; ids are never renumbered or reused, and a key that disappears is kept as
// `gone` (it gets its old id back if it reappears). Used by the endpoint catalogue (EP-<m>-<n>, D-045) and the API test
// plan (API-<m>-<n>, D-046).
//
//   { module, next, <field>: { <key>: { id, status: active|gone, firstSeen, lastSeen } } }
import { existsSync, readFileSync } from "node:fs";
import { withFileLock, writeAtomic } from "./files.mjs";

const defaultFormat = ({ prefix, module, n }) => `${prefix}-${module}-${n}`;

// keys: the keys present in this build. opts: {module, runId, prefix (required), field (required: the registry's map,
// e.g. "endpoints"), format ({prefix, module, n}) -> id}. -> the registry as written.
export function assignIds(registryFile, keys, { module, runId, prefix, field, format = defaultFormat } = {}) {
  if (!field || typeof field !== "string") throw new Error("assignIds: `field` (the registry's map, e.g. \"endpoints\") is required");
  if (!prefix || typeof prefix !== "string") throw new Error("assignIds: `prefix` (the id prefix, e.g. \"EP\") is required");
  return withFileLock(registryFile, () => {
    const before = existsSync(registryFile) ? readFileSync(registryFile, "utf8") : null;
    const reg = before !== null ? JSON.parse(before) : { module, next: 1, [field]: {} };
    const present = new Set(keys);
    for (const k of [...keys].sort()) {
      const e = reg[field][k];
      if (e) Object.assign(e, { status: "active", lastSeen: runId });
      else reg[field][k] = { id: format({ prefix, module, n: reg.next++ }), status: "active", firstSeen: runId, lastSeen: runId };
    }
    for (const [k, e] of Object.entries(reg[field])) if (!present.has(k) && e.status === "active") e.status = "gone";
    const after = JSON.stringify(reg, null, 2) + "\n";
    if (after !== before) writeAtomic(registryFile, after); // unchanged: no rewrite
    return reg;
  });
}
