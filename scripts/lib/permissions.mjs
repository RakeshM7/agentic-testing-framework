// config/permissions.yaml -> validated, profile-expanded JSON frozen into state/permissions.resolved.json at
// `run.mjs init`. The guard reads only the frozen JSON (no YAML dependency in the hook, and a run's permissions
// cannot change under it). The run's authorizations.mode caps everything: see effectiveLiveTarget().
// Dependency-free except resolvePermissions' input, which callers parse with js-yaml.

const ENUMS = {
  browser: ["none", "read", "mutate"],
  http: ["none", "read", "mutate"],
  load: ["none", "run"],
  web_research: ["none", "allowed"],
  shell: ["none", "restricted", "project"],
};
const RANK = { none: 0, read: 1, mutate: 2, run: 1 };

export function resolvePermissions(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || typeof doc.agents !== "object") return { errors: ["permissions: needs an 'agents' mapping"] };
  const profiles = doc.profiles ?? {};
  const agents = {};
  for (const [name, raw] of Object.entries(doc.agents)) {
    if (raw.profile && !profiles[raw.profile]) errors.push(`${name}: unknown profile '${raw.profile}'`);
    const { profile, ...own } = raw;
    const a = { ...(profiles[profile] ?? {}), ...own };
    const lt = a.live_target ?? {};
    const row = {
      layer: a.layer,
      spawns: a.spawns ?? [],
      live_target: { browser: lt.browser ?? "none", http: lt.http ?? "none", load: lt.load ?? "none" },
      web_research: a.web_research ?? "none",
      shell: a.shell ?? "none",
      shell_allow: a.shell_allow ?? [],
      filesystem: { read: a.filesystem?.read ?? [], write: a.filesystem?.write ?? [] },
    };
    if (![0, 1, 2].includes(row.layer)) errors.push(`${name}: layer must be 0, 1 or 2`);
    for (const k of ["browser", "http", "load"]) if (!ENUMS[k].includes(row.live_target[k])) errors.push(`${name}: live_target.${k} '${row.live_target[k]}' not in [${ENUMS[k]}]`);
    for (const k of ["web_research", "shell"]) if (!ENUMS[k].includes(row[k])) errors.push(`${name}: ${k} '${row[k]}' not in [${ENUMS[k]}]`);
    if (row.shell === "restricted" && !row.shell_allow.length) errors.push(`${name}: shell: restricted needs shell_allow`);
    if (row.layer === 2 && row.spawns.length) errors.push(`${name}: layer-2 workers cannot spawn agents`);
    agents[name] = row;
  }
  for (const [name, a] of Object.entries(agents))
    for (const s of a.spawns) if (!agents[s]) errors.push(`${name}: spawns unknown agent '${s}'`);
  return { errors, resolved: { variables: doc.variables ?? {}, agents } };
}

// readonly runs cap every agent at read (browser/http) and none (load), whatever the file says.
// full-run runs give every agent that has browser access at all (read or mutate) the full browser.
export function effectiveLiveTarget(row, mode) {
  const lt = { ...row.live_target };
  if (mode !== "full-run") {
    if (lt.browser === "mutate") lt.browser = "read";
    if (lt.http === "mutate") lt.http = "read";
    lt.load = "none";
  } else if (lt.browser === "read") lt.browser = "mutate";
  return lt;
}

export const atLeast = (have, need) => RANK[have] >= RANK[need];

// Expand ${...} in a glob: first the permissions file's own `variables:` (which may nest, e.g. ${modules} ->
// artifacts/${product}/modules/${module}), then run values (product, run_id). Anything still unknown
// (typically ${module}) matches exactly one path segment.
export function expandGlob(glob, variables, values) {
  let g = glob;
  for (let pass = 0; pass < 5; pass++) {
    const next = g.replace(/\$\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? String(values[k]) : typeof variables[k] === "string" ? variables[k] : m));
    if (next === g) break;
    g = next;
  }
  return g;
}

// Glob over repo-relative, forward-slash paths: `**` any depth, `*` within one segment, leftover ${x} one segment.
export function globToRegExp(glob) {
  const esc = (s) => s.replace(/[.+?^$()|[\]\\{}]/g, "\\$&");
  let re = "";
  for (const part of glob.split(/(\$\{\w+\}|\*\*\/|\*\*|\*)/)) {
    if (!part) continue;
    if (part === "**/") re += "(?:.*/)?";
    else if (part === "**") re += ".*";
    else if (part === "*") re += "[^/]*";
    else if (part.startsWith("${")) re += "[^/]+";
    else re += esc(part);
  }
  return new RegExp(`^${re}$`);
}

export function canWrite(row, relPath, variables, values) {
  return row.filesystem.write.some((g) => !g.startsWith("<") && globToRegExp(expandGlob(g, variables, values)).test(relPath));
}

export function shellAllowed(row, cmd) {
  if (row.shell === "none") return false;
  if (row.shell === "project") return true;
  return row.shell_allow.some((p) => new RegExp(`^${p.replace(/[.+?^$()|[\]\\{}]/g, "\\$&").replace(/\*/g, ".*")}$`).test(cmd.trim()));
}
