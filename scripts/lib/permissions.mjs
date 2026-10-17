// config/permissions.yaml -> validated, profile-expanded JSON frozen into state/permissions.resolved.json at
// `run.mjs init`. The guard reads only the frozen JSON (no YAML dependency in the hook, and a run's permissions
// cannot change under it). The run's authorizations.mode caps everything: see effectiveLiveTarget().
// Dependency-free except resolvePermissions' input, which callers parse with js-yaml.

const ENUMS = {
  browser: ["none", "read", "mutate"],
  http: ["none", "read", "mutate"],
  load: ["none", "run"],
  web_research: ["none", "allowed"],
  ask_user: ["none", "allowed"],
  shell: ["none", "restricted", "project"],
  browser_session: ["shared", "fresh"],
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
      ask_user: a.ask_user ?? "none",
      browser_session: a.browser_session ?? "shared", // fresh: may close its own browser session (D-047)
    };
    if (![0, 1, 2].includes(row.layer)) errors.push(`${name}: layer must be 0, 1 or 2`);
    for (const k of ["browser", "http", "load"]) if (!ENUMS[k].includes(row.live_target[k])) errors.push(`${name}: live_target.${k} '${row.live_target[k]}' not in [${ENUMS[k]}]`);
    if (a.extra_tools) errors.push(`${name}: extra_tools is not supported; grant capabilities (e.g. ask_user: allowed), never platform tool names`);
    if (row.browser_session === "fresh" && row.live_target.browser === "none") errors.push(`${name}: browser_session: fresh needs browser access`);
    for (const k of ["web_research", "shell", "ask_user", "browser_session"]) if (!ENUMS[k].includes(row[k])) errors.push(`${name}: ${k} '${row[k]}' not in [${ENUMS[k]}]`);
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

const SHELL_RANK = { none: 0, restricted: 1, project: 2 };
const highest = (rank, values) => values.reduce((a, b) => (rank[b] > rank[a] ? b : a));

// The ceiling for a call whose agent the host cannot name (D-035): what at least one agent of a product run may do.
// The run's agents are the layer-0 entry agents and every agent reachable from them through `spawns`, so an agent that
// is not part of a run (feedback-implementor-agent) adds nothing. Entry agents may be spawned too: a host's own chat
// starts orchestrator-agent as a subagent. -> a permissions row, or undefined when there is no layer-0 agent.
export function runCeiling(resolved) {
  const agents = resolved?.agents ?? {};
  const entry = Object.keys(agents).filter((n) => agents[n].layer === 0);
  const inRun = new Set();
  for (const queue = [...entry]; queue.length; ) {
    const n = queue.shift();
    if (inRun.has(n) || !agents[n]) continue;
    inRun.add(n);
    queue.push(...agents[n].spawns);
  }
  if (!inRun.size) return undefined;
  const rows = [...inRun].map((n) => agents[n]);
  const all = (f) => [...new Set(rows.flatMap(f))];
  const any = (k) => (rows.some((r) => r[k] === "allowed") ? "allowed" : "none");
  return {
    spawns: [...new Set([...entry, ...all((r) => r.spawns)])],
    live_target: Object.fromEntries(["browser", "http", "load"].map((k) => [k, highest(RANK, rows.map((r) => r.live_target[k]))])),
    web_research: any("web_research"),
    shell: highest(SHELL_RANK, rows.map((r) => r.shell)),
    shell_allow: all((r) => r.shell_allow),
    filesystem: { read: all((r) => r.filesystem.read), write: all((r) => r.filesystem.write) },
    ask_user: any("ask_user"),
  };
}

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

// A command line split into its simple commands, for a restricted allow-list. Unquoted `&&`, `||`, `;`, `|`, `&` and
// line breaks separate commands; the text inside quotes is masked, so no pattern can read it as an operator. -> the
// commands, or null when the line has something an allow-list can't vouch for: a redirect (< >), a group or subshell
// (( )), command substitution or a variable ($, a backtick) outside single quotes, a backslash outside quotes (an
// escape such as \" or \' would otherwise hide where a quote starts), a backslash before a double quote inside double
// quotes (bash reads it as an escaped quote, PowerShell and cmd as the closing one), or an unterminated quote. Any
// other backslash inside quotes, and everything inside single quotes, is literal. Arguments belong in single quotes.
export function shellSegments(cmd) {
  const segs = [];
  let cur = "";
  let q = null;
  const s = String(cmd ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && c === "\\" && s[i + 1] === '"') return null;
      if (c === q) {
        q = null;
        cur += c;
      } else if (q === '"' && (c === "$" || c === "`")) return null;
      else cur += "_";
      continue;
    }
    if (c === "'" || c === '"') {
      q = c;
      cur += c;
    } else if ("<>()$`\\".includes(c)) return null;
    else if (c === ";" || c === "\n" || c === "\r" || c === "&" || c === "|") {
      segs.push(cur);
      cur = "";
      if ((c === "&" || c === "|") && s[i + 1] === c) i++;
    } else cur += c;
  }
  if (q) return null;
  segs.push(cur);
  if (segs.some((x) => !x.trim())) return null; // an empty command around an operator (`a ;`, `a ;; b`) is not vouched for either
  return segs.map((x) => x.trim()).filter(Boolean);
}

// restricted: every simple command of the line must match an allow-list pattern on its own; a `*` in a pattern never
// matches an operator, a redirect, a substitution or a line break.
export function shellAllowed(row, cmd) {
  if (row.shell === "none") return false;
  if (row.shell === "project") return true;
  const segs = shellSegments(cmd);
  if (!segs?.length) return false;
  const res = row.shell_allow.map((p) => new RegExp(`^${p.replace(/[.+?^$()|[\]\\{}]/g, "\\$&").replace(/\*/g, "[^;&|<>`$()\\n\\r]*")}$`));
  return segs.every((seg) => res.some((re) => re.test(seg)));
}
