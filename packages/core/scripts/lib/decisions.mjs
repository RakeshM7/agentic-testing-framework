// Design-decision governance. Each workspace keeps a decision log recording why its own work is built the way it is;
// each Accepted decision lists the workspace paths it governs (`Affects:`). A tool call that would change a governed path
// is held for the user's confirmation ("ask"), naming the decisions, so no agent changes an intentional design without
// the user. Once the user has confirmed an edit under a decision, the rest of that session may edit under it without
// asking again (posttooluse.mjs remembers it per session).
//
// Which log (docs/packaging.md §3.7): the workspace's atf/atf.json may name it, `"decisions": "<workspace-relative
// path>"`; without that key it is atf/decisions.md (a client's, created empty by `atf init`). The monorepo names
// docs/decisions.md, the maintainers' log of the framework itself. decisionsFile() is the one resolver: the hook, the
// session memo and the lookup CLI (decisions.mjs) all go through it. A missing log governs nothing; a log, or an
// atf.json, that can't be read, or a log path outside the workspace, makes every governed-area write ask (fail closed).
//
// Separate from safety (scripts/lib/guard.mjs): the guard decides what is ALLOWED, this decides what needs the user.
// Dependency-free (imported by the hook entry on every guarded tool call).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { globToRegExp } from "./permissions.mjs";
import { WORKSPACE_MARKER, readMarker } from "./roots.mjs";

// The log when atf/atf.json names none. Kept exported under its old name; the workspace's own is decisionsFile(root).
export const DECISIONS_FILE = "atf/decisions.md";
// How a message names the log when it couldn't be resolved.
const THE_LOG = "the workspace's decision log";
// Generated run output and generated test code are not framework design; their own reviewers handle them.
const UNGOVERNED = [/^artifacts\//, /^playwright-tests\//, /^k6-tests\//, /^feedback\//];

// The workspace's decision log -> { file: <workspace-relative, `/`>, path: <absolute> } | { error }. atf/atf.json is
// committed and shared across OSes, so a path that is absolute in either convention, or drive-relative (`C:x`, which
// Windows resolves against that drive's working directory), is refused everywhere, as is one that leaves the workspace
// or names its root. Without atf.json the default applies (a hook outside any workspace judges its host root).
export function decisionsFile(root) {
  let named = DECISIONS_FILE;
  const { cfg, error } = readMarker(root);
  if (error) return { error };
  if (cfg?.decisions !== undefined) {
    if (typeof cfg.decisions !== "string" || !cfg.decisions.trim()) return { error: `${WORKSPACE_MARKER} "decisions" must be a workspace-relative path` };
    named = cfg.decisions.trim();
  }
  const p = named.replaceAll("\\", "/");
  const outside = { error: `${WORKSPACE_MARKER} "decisions" (${named}) must name a file inside the workspace, relative to it` };
  if (path.posix.isAbsolute(p) || path.win32.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return outside;
  const abs = path.resolve(root, p);
  const rel = path.relative(path.resolve(root), abs);
  if (!rel || rel.split(/[\\/]/)[0] === ".." || path.isAbsolute(rel)) return outside;
  return { file: rel.replaceAll("\\", "/"), path: abs };
}

// -> [{ id, title, status, accepted, affects: [glob] }]; throws on a malformed entry.
// `file` names the log in the error.
export function parseDecisions(text, file = "the decision log") {
  const out = [];
  const heads = [...text.matchAll(/^### (D-\d{3}) · (.+)$/gm)];
  heads.forEach((h, i) => {
    const block = text.slice(h.index, heads[i + 1]?.index ?? text.length);
    const status = /^- \*\*Status:\*\* ([^·\n]+)/m.exec(block)?.[1]?.trim();
    const affects = /^- \*\*Affects:\*\* (.+)$/m.exec(block)?.[1];
    if (!status || affects === undefined) throw new Error(`${file}: ${h[1]} needs a Status and an Affects line`);
    out.push({ id: h[1], title: h[2].trim(), status, accepted: status.startsWith("Accepted"), affects: [...affects.matchAll(/`([^`]+)`/g)].map((m) => m[1]) });
  });
  return out;
}

// -> { decisions, file } | { error, file? } | { decisions: [], file } when the log does not exist. `file` is the log's
// workspace-relative path, for the messages that name it.
export function loadDecisions(root) {
  const log = decisionsFile(root);
  if (log.error) return { error: log.error };
  if (!existsSync(log.path)) return { decisions: [], file: log.file };
  try {
    return { decisions: parseDecisions(readFileSync(log.path, "utf8"), log.file), file: log.file };
  } catch (e) {
    return { error: e.message, file: log.file };
  }
}

export const governing = (decisions, rel) => decisions.filter((d) => d.accepted && d.affects.some((g) => globToRegExp(g).test(rel)));

// The full text of one entry, from its heading to the next (D-082: `decisions.mjs show` and `for --full`).
export function entryText(text, id) {
  const heads = [...text.matchAll(/^### (D-\d{3}) · .+$/gm)];
  const i = heads.findIndex((h) => h[1] === id);
  return i < 0 ? null : text.slice(heads[i].index, heads[i + 1]?.index ?? text.length).trimEnd();
}

// ---- which files a shell command writes (heuristic; `node -e`-style writes are a documented known limit) -------
const SEGMENT = /\s*(?:&&|\|\||;|\|)\s*/;
const WRITERS = { rm: "all", mv: "all", tee: "all", truncate: "all", touch: "all", cp: "last", install: "last" };
const GIT_WRITERS = new Set(["restore", "checkout", "rm", "mv", "apply"]);
const tokenize = (s) => [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
const args = (tokens) => tokens.filter((t) => !t.startsWith("-"));

export function shellWriteTargets(command = "") {
  const targets = [];
  for (const seg of String(command).split(SEGMENT)) {
    const t = tokenize(seg);
    for (let i = 0; i < t.length; i++) {
      const redirect = /^\d?>>?(.*)$/.exec(t[i]);
      if (redirect && !redirect[1].startsWith("&")) targets.push(redirect[1] || t[i + 1]);
    }
    let w = t.findIndex((x) => !/^\w+=/.test(x) && x !== "sudo" && x !== "command");
    if (w < 0) continue;
    const cmd = path.basename(t[w]);
    const rest = t.slice(w + 1).filter((x) => !/^\d?>/.test(x));
    if (WRITERS[cmd] === "all") targets.push(...args(rest));
    else if (WRITERS[cmd] === "last") targets.push(args(rest).at(-1));
    else if ((cmd === "sed" || cmd === "perl") && rest.some((x) => /^-[a-zA-Z]*i/.test(x) || x === "--in-place")) targets.push(...args(rest));
    else if (cmd === "git" && GIT_WRITERS.has(rest.find((x) => !x.startsWith("-")))) targets.push(...args(rest).slice(1));
  }
  return targets.filter(Boolean);
}

// ---- per-session memory of confirmed decisions ------------------------------------------------------------------
// Keyed by the workspace and its log: a confirmation is of one log's decision ids, so if atf.json starts naming another
// log mid-session, that log's D-001 is not taken as already confirmed.
const memoKey = (root) => `${path.resolve(root)}\0${decisionsFile(root).file ?? ""}`;
const memoFile = (root, session) =>
  path.join(tmpdir(), "atf-decisions", createHash("sha1").update(memoKey(root)).digest("hex").slice(0, 12), `${createHash("sha1").update(String(session)).digest("hex").slice(0, 16)}.json`);

export function confirmedIn(root, session) {
  if (!session) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(memoFile(root, session), "utf8")));
  } catch {
    return new Set();
  }
}

export function rememberConfirmed(root, session, ids) {
  if (!session || !ids.length) return;
  const file = memoFile(root, session);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([...new Set([...confirmedIn(root, session), ...ids])]));
}

// ---- the policy ----------------------------------------------------------------------------------------------------
function targetsOf(call, root) {
  const files = call.kind === "write" ? call.paths : call.kind === "shell" ? shellWriteTargets(call.command) : [];
  return files
    .map((f) => path.relative(root, path.resolve(root, f)).replaceAll("\\", "/"))
    .filter((rel) => rel && !rel.startsWith("..") && !path.isAbsolute(rel) && !UNGOVERNED.some((r) => r.test(rel)));
}

// The Accepted decisions a call would touch -> [{ decision, files }]
export function touchedDecisions(call, root, decisions) {
  const hits = new Map();
  for (const rel of targetsOf(call, root))
    for (const d of governing(decisions, rel)) {
      if (!hits.has(d.id)) hits.set(d.id, { decision: d, files: [] });
      hits.get(d.id).files.push(rel);
    }
  return [...hits.values()];
}

// -> { decision: "allow" } | { decision: "ask", rule: "decision", reason, ids }. Takes loadDecisions' result, whose
// `file` names the log in the reason.
export function checkDecisions(call, root, { decisions, error, file, confirmed = new Set() }) {
  const log = file ?? THE_LOG;
  if (error) {
    const files = targetsOf(call, root);
    return files.length
      ? { decision: "ask", rule: "decision", ids: [], reason: `${log} could not be read (${error}), so it is unknown which design decisions ${files.join(", ")} falls under. Approve only if you are sure.` }
      : { decision: "allow" };
  }
  const open = touchedDecisions(call, root, decisions).filter((h) => !confirmed.has(h.decision.id));
  if (!open.length) return { decision: "allow" };
  const list = open.map((h) => `${h.decision.id} "${h.decision.title}" (${[...new Set(h.files)].join(", ")})`).join("; ");
  return {
    decision: "ask",
    rule: "decision",
    ids: open.map((h) => h.decision.id),
    reason: `This changes files governed by recorded design decisions: ${list}. See ${log}. Approve only if the change keeps these decisions, or you have decided to change one (then a superseding entry goes into ${log} in the same change). Approving lets this session edit files under these decisions without asking again.`,
  };
}
