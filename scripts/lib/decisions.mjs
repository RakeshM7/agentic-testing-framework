// Design-decision governance. docs/decisions.md records why the framework is built the way it is; each Accepted
// decision lists the repo paths it governs (`Affects:`). A tool call that would change a governed path is held for the
// user's confirmation ("ask"), naming the decisions, so no agent changes an intentional design without the user.
// Once the user has confirmed an edit under a decision, the rest of that session may edit under it without asking
// again (posttooluse.mjs remembers it per session).
//
// Separate from safety (scripts/lib/guard.mjs): the guard decides what is ALLOWED, this decides what needs the user.
// Dependency-free (imported by the hook entry on every guarded tool call).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { globToRegExp } from "./permissions.mjs";

export const DECISIONS_FILE = "docs/decisions.md";
// Generated run output and generated test code are not framework design; their own reviewers handle them.
const UNGOVERNED = [/^artifacts\//, /^playwright-tests\//, /^k6-tests\//, /^feedback\//];

// -> [{ id, title, status, accepted, affects: [glob] }]; throws on a malformed entry.
export function parseDecisions(text) {
  const out = [];
  const heads = [...text.matchAll(/^### (D-\d{3}) · (.+)$/gm)];
  heads.forEach((h, i) => {
    const block = text.slice(h.index, heads[i + 1]?.index ?? text.length);
    const status = /^- \*\*Status:\*\* ([^·\n]+)/m.exec(block)?.[1]?.trim();
    const affects = /^- \*\*Affects:\*\* (.+)$/m.exec(block)?.[1];
    if (!status || affects === undefined) throw new Error(`${DECISIONS_FILE}: ${h[1]} needs a Status and an Affects line`);
    out.push({ id: h[1], title: h[2].trim(), status, accepted: status.startsWith("Accepted"), affects: [...affects.matchAll(/`([^`]+)`/g)].map((m) => m[1]) });
  });
  return out;
}

// -> { decisions } | { error } | { decisions: [] } when the log does not exist
export function loadDecisions(root) {
  const file = path.join(root, DECISIONS_FILE);
  if (!existsSync(file)) return { decisions: [] };
  try {
    return { decisions: parseDecisions(readFileSync(file, "utf8")) };
  } catch (e) {
    return { error: e.message };
  }
}

export const governing = (decisions, rel) => decisions.filter((d) => d.accepted && d.affects.some((g) => globToRegExp(g).test(rel)));

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
const memoFile = (root, session) =>
  path.join(tmpdir(), "atf-decisions", createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 12), `${createHash("sha1").update(String(session)).digest("hex").slice(0, 16)}.json`);

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

// -> { decision: "allow" } | { decision: "ask", rule: "decision", reason, ids }
export function checkDecisions(call, root, { decisions, error, confirmed = new Set() }) {
  if (error) {
    const files = targetsOf(call, root);
    return files.length
      ? { decision: "ask", rule: "decision", ids: [], reason: `${DECISIONS_FILE} could not be read (${error}), so it is unknown which design decisions ${files.join(", ")} falls under. Approve only if you are sure.` }
      : { decision: "allow" };
  }
  const open = touchedDecisions(call, root, decisions).filter((h) => !confirmed.has(h.decision.id));
  if (!open.length) return { decision: "allow" };
  const list = open.map((h) => `${h.decision.id} "${h.decision.title}" (${[...new Set(h.files)].join(", ")})`).join("; ");
  return {
    decision: "ask",
    rule: "decision",
    ids: open.map((h) => h.decision.id),
    reason: `This changes files governed by recorded design decisions: ${list}. See ${DECISIONS_FILE}. Approve only if the change keeps these decisions, or you have decided to change one (then a superseding entry goes into ${DECISIONS_FILE} in the same change). Approving lets this session edit files under these decisions without asking again.`,
  };
}
