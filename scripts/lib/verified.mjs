// The verified stamp of a script-built artifact (docs/conventions.md "Script-built agents", D-049). A passing `check`
// stamps the sha256 of its named input files; the domain flow's `verify` rule (scripts/lib/domain-flows.mjs) then
// refuses the step when the stamp is missing or any input changed since.
//
//   verified: { <name>: <sha256 hex of the file, or null when it is missing> }
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export const sha256 = (file) => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null);

// inputs: {name: file}. -> {name: sha256}, in the same key order.
export function stampVerified(inputs) {
  return Object.fromEntries(Object.entries(inputs).map(([name, file]) => [name, sha256(file)]));
}

// null when `stamp` matches every input on disk, else why not. `unstamped` and `changed` replace the default wording.
export function unverifiedReason(stamp, inputs, { unstamped = "never passed its check", changed } = {}) {
  if (!stamp) return unstamped;
  const stale = Object.entries(inputs).filter(([name, file]) => stamp[name] !== sha256(file)).map(([name]) => name);
  if (!stale.length) return null;
  return changed ?? `changed after its check: ${stale.join(", ")}`;
}
