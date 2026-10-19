// A module's exploration as a script-owned state machine: artifacts/<product>/modules/<m>/explore/ (D-052,
// docs/agent-handoffs.md §1). Crawljax-style: the agent fires events in the live browser and saves what it saw; this
// script decides what a state is, gives every state, page, control and request a stable id, keeps the frontier ledger
// and audits the questions.
//
// Script-owned (never hand-edited):
//   log.jsonl                    every `state`, budget deferral and `ingest-network`, tagged with the run id
//   registry/{states,pages,frontier,network}.json   ST-, PG-, FR- and NI-<m>-<n> ids (lib/registry.mjs)
//   pages/<slug>/states/<ST>.md  each state's accessibility snapshot, verbatim; pages/<slug>/dom-snapshot.md = the
//                                page's first state (kept for older consumers)
//   model.json                   pages, states (with how to reach each), transitions, the frontier
//   coverage.json                the frontier ledger, the KQ ledger, the untried-input ledger, the questions, live
//                                entities and, after a passing check, the verified stamp
//   sitemap.json interactions.json network-inventory.json explore-model.md
// Agent-owned: flows/*.md, module-summary.md, new-questions.json, overlay.json, captures/** (raw snapshots and network
// logs it saves for `state` and `ingest-network`).
//
// Rules enforced here (not in prompts):
//   - a state is a page template plus a structural fingerprint of its accessibility snapshot (fingerprint()); the agent
//     can't merge or split states
//   - every candidate control of every state is a frontier item, closed only by an explored transition, a script
//     derivation, an overlay exclusion with a reason, or a budget deferral; `check` fails while one is open
//   - explore.max_states / explore.max_pages cap new states and pages; the overflow is a `deferred: budget` frontier
//     item, never dropped. Transitions into known states are always recorded
//   - every knowledge open point (KQ id) is observed, asked or dismissed; every untried input has a question or a reason
//   - network captures keep method, host, path template and key names only

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { withFileLock, writeAtomic } from "./csv.mjs";
import { assignIds } from "./registry.mjs";
import { createLedger } from "./coverage.mjs";
import { sha256, stampVerified, unverifiedReason } from "./verified.mjs";
import { citationProblem } from "./citations.mjs";
import { erase, isIdSegment, nameKey, normalizePath, restKey, segments } from "./endpoints.mjs";
import { csvPath, normQuestion, readRows } from "./clarifications.mjs";
import { knowledgePaths } from "./knowledge.mjs";
import { live } from "./ledger.mjs";
import { DENY_TOKENS } from "./probe.mjs";

export const DEFAULT_BUDGETS = { max_pages: 40, max_states: 150 };
// Candidate controls: every element of these roles in a state is a frontier item.
export const CONTROL_ROLES = ["link", "button", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem", "checkbox", "radio", "switch", "combobox", "listbox", "textbox", "searchbox", "spinbutton", "slider"];
// Input-bearing controls: one not tried needs a question or a reason.
export const INPUT_ROLES = ["textbox", "searchbox", "spinbutton", "slider", "combobox", "listbox", "checkbox", "radio", "switch"];
// What a readonly run can't do (the guard blocks typing, selects and form filling).
const TYPING_ROLES = ["textbox", "searchbox", "spinbutton", "slider", "combobox", "listbox"];
// Frontier exclusion reasons.
export const FRONTIER_REASONS = ["not-allowed-in-mode", "out-of-module", "external", "logout", "destructive-preexisting", "duplicate-of", "disabled", "guard-denied", "unreachable"];
// The agent may close an item only with these (overlay.json items); the first three cite a capture that shows why,
// duplicate-of names an existing item with the same role and name. Every other reason is derived by the script only.
export const AGENT_REASONS = ["destructive-preexisting", "guard-denied", "unreachable", "duplicate-of"];
const CITED_REASONS = ["destructive-preexisting", "guard-denied", "unreachable"];
// Script-derived exclusions that also exempt an input from the untried-input audit.
const INPUT_EXEMPT = ["duplicate-of", "out-of-module", "external", "logout"];
export const KQ_OUTCOMES = ["observed", "asked", "dismissed"];
// A control that commits data. In a readonly run the script closes it as not-allowed-in-mode. The verbs are this list
// plus the side-effect words of lib/probe.mjs (DENY_TOKENS) that act on data. "Cancel" and "Close" commit only with an
// object ("Cancel order", "Close ticket"). Inside a dialog or alertdialog every button except a dismissal commits;
// create/add/new/ok/done only inside a form or dialog (outside one they usually open a form).
const COMMIT_WORDS = new Set([
  ..."save submit delete remove send confirm import upload archive unarchive merge publish unpublish approve reject purge destroy deactivate activate update apply pay checkout invite restore reset duplicate clone assign reassign unassign convert transfer mark resolve reopen proceed yes accept decline enable disable follow unfollow pin unpin run execute trigger sync lock unlock revoke subscribe unsubscribe refund charge verify generate move rename share block unblock ban approve".split(" "),
  ...[...DENY_TOKENS].filter((t) => !/^(log|sign)/.test(t) && !["download", "export", "callback", "webhook", "cancel"].includes(t)),
]);
const OBJECT_COMMIT = new Set(["cancel", "close"]);
const DISMISS_RE = /^(cancel|close|no|dismiss|back|not now|keep editing|x|×|✕)$/i;
const CREATE_RE = /\b(create|add|new|ok|done|finish)\b/i;
const COMMIT_ROLES = ["button", "menuitem", "menuitemcheckbox", "menuitemradio"];
const LOGOUT_RE = /\b(log ?out|sign ?out|log ?off)\b|logout|signout|sign-out|log-out/i;
const STATIC_RE = /\.(m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|otf|mp4|webm|mp3|wav)$/i;
const CHROME_ROLES = ["banner", "navigation", "contentinfo"];
const CONTAINER_ROLES = ["dialog", "alertdialog", "form", "region", "tabpanel", "menu", "menubar", "search"];
const COLLECTION_TABLES = ["table", "grid", "treegrid"];
// Fingerprint: these roles are emitted (with their names where NAMED); every other node is transparent.
const FP_ROLES = new Set([...CONTROL_ROLES, "heading", "dialog", "alertdialog", "tablist", "tabpanel", "menu", "menubar", "tree", "alert", "form", "search", "region", "navigation", "banner", "main", "contentinfo", "complementary", "toolbar", "status", ...COLLECTION_TABLES, "list"]);
const FP_NAMED = new Set([...CONTROL_ROLES, "heading", "dialog", "alertdialog", "tabpanel", "alert", "status", "form", "region"]);
const MESSAGE_RE = /\b(required|invalid|must|cannot|can't|at least|at most|too (long|short)|not valid|error|no (\w+ )?(results|records|items|found)|nothing (found|to show))\b/i;

const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback);
const writeJson = (f, data) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeAtomic(f, JSON.stringify(data, null, 2) + "\n");
};
const uniq = (xs) => [...new Set(xs)];
const sortedUniq = (xs) => uniq(xs).sort();
const idNum = (id) => Number(String(id).split("-").at(-1));
const byId = (a, b) => idNum(a.id) - idNum(b.id);
const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const rel = (from, f) => path.relative(from, f).replaceAll("\\", "/");
export const sha256Text = (s) => createHash("sha256").update(s).digest("hex");

export function explorePaths(productDir, module) {
  const moduleDir = path.join(productDir, "modules", module);
  const dir = path.join(moduleDir, "explore");
  const reg = path.join(dir, "registry");
  return {
    moduleDir,
    dir,
    log: path.join(dir, "log.jsonl"),
    registry: { states: path.join(reg, "states.json"), pages: path.join(reg, "pages.json"), frontier: path.join(reg, "frontier.json"), network: path.join(reg, "network.json") },
    pages: path.join(dir, "pages"),
    model: path.join(dir, "model.json"),
    coverage: path.join(dir, "coverage.json"),
    render: path.join(dir, "explore-model.md"),
    sitemap: path.join(dir, "sitemap.json"),
    interactions: path.join(dir, "interactions.json"),
    inventory: path.join(dir, "network-inventory.json"),
    // the agent's
    flows: path.join(dir, "flows"),
    summary: path.join(dir, "module-summary.md"),
    questions: path.join(dir, "new-questions.json"),
    overlay: path.join(dir, "overlay.json"),
    captures: path.join(dir, "captures"),
  };
}

// ctx for every command: {root, product, module, runId, mode, cfg, productDir, xp, kp, ledgerFile, budgets}
export function exploreContext({ root, product, module, run, cfg, productDir, ledgerFile, env = {} }) {
  const mode = env.AUTHORIZATIONS_MODE === "readonly" ? "readonly" : run.mode; // the environment can only downgrade
  return {
    root, product, module, runId: run.runId, mode, cfg, productDir, ledgerFile,
    xp: explorePaths(productDir, module),
    kp: knowledgePaths(productDir),
    budgets: { ...DEFAULT_BUDGETS, ...(cfg.explore ?? {}) },
  };
}

// ---------- the accessibility snapshot ----------

// Playwright's aria snapshot: YAML-like lines `- role "name" [attr] [attr=value] [ref=eN]: inline text`, children
// indented by two spaces, properties as `- /url: ...`, text nodes as `- text: ...`. The browser tool's output may wrap
// it in a page-state header (`- Page URL: ...`, `- Page Title: ...`) and a ```yaml fence.
function scanQuoted(s, i, q) {
  // s[i] === q; -> index after the closing quote
  for (let j = i + 1; j < s.length; j++) {
    if (q === '"' && s[j] === "\\") j++;
    else if (s[j] === q) {
      if (q === "'" && s[j + 1] === "'") j++;
      else return j + 1;
    }
  }
  return s.length;
}

export function parseItem(text) {
  let s = text.trim();
  if (!s) return null;
  if (s.startsWith("/")) {
    const m = /^\/([\w-]+):\s?(.*)$/.exec(s);
    return m ? { prop: m[1], value: unquote(m[2].trim()) } : null;
  }
  let tail = "";
  if (s.startsWith("'") || (s.startsWith('"') && !/^"[^"]*"\s*$/.test(s))) {
    // a YAML-quoted key: the role, name and attributes are inside the quotes, the inline text after them
    const end = scanQuoted(s, 0, s[0]);
    const inner = s.slice(1, end - 1);
    tail = s.slice(end);
    s = s[0] === "'" ? inner.replace(/''/g, "'") : inner.replace(/\\(.)/g, "$1");
  }
  const roleM = /^([a-z][a-zA-Z0-9-]*)/.exec(s);
  if (!roleM) return null;
  const role = roleM[1];
  let i = role.length;
  let name = null;
  const ws = /^\s*/.exec(s.slice(i))[0].length;
  if (s[i + ws] === '"') {
    const end = scanQuoted(s, i + ws, '"');
    const raw = s.slice(i + ws, end);
    try {
      name = JSON.parse(raw);
    } catch {
      name = raw.slice(1, -1);
    }
    i = end;
  }
  const attrs = {};
  const attrRe = /^\s*\[([^\]=]+)(?:=([^\]]*))?\]/;
  let m;
  while ((m = attrRe.exec(s.slice(i)))) {
    attrs[m[1].trim()] = m[2] === undefined ? true : m[2].trim();
    i += m[0].length;
  }
  let rest = (s.slice(i) + tail).trim();
  let value = null;
  if (rest.startsWith(":")) {
    rest = rest.slice(1).trim();
    if (rest) value = unquote(rest);
  }
  return { role, name, attrs, value };
}
const unquote = (v) => (/^".*"$/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v.slice(1, -1); } })() : /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v);

// -> {url|null, title|null, root: {role: "root", children: [...]}}; node: {role, name, attrs, value, props, children}
export function parseSnapshot(text) {
  const t = String(text).replace(/^﻿/, "");
  const url = /^\s*-\s*Page URL:\s*(\S+)/m.exec(t)?.[1] ?? null;
  const title = /^\s*-\s*Page Title:\s*(.*)$/m.exec(t)?.[1]?.trim() ?? null;
  const fences = [...t.matchAll(/```([a-z]*)\r?\n([\s\S]*?)```/g)];
  const yamlFence = fences.find((f) => f[1] === "yaml") ?? fences.find((f) => /^\s*- /m.test(f[2]) && !f[1]);
  const body = yamlFence ? yamlFence[2] : t;
  const root = { role: "root", name: null, attrs: {}, value: null, props: {}, children: [], indent: -1, title };
  const stack = [root];
  for (const raw of body.split(/\r?\n/)) {
    const m = /^(\s*)-\s(.*)$/.exec(raw);
    if (!m || (!yamlFence && /^\s*-\s*Page (URL|Title|Snapshot)\b/.test(raw))) continue;
    const indent = m[1].length;
    const item = parseItem(m[2]);
    if (!item) continue;
    while (stack.length > 1 && stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (item.prop) {
      parent.props[item.prop] = item.value;
      continue;
    }
    const node = { ...item, props: {}, children: [], indent };
    parent.children.push(node);
    stack.push(node);
  }
  return { url, title, root };
}

// A name as the fingerprint sees it: whitespace collapsed, numbers, dates and emails erased.
export const normName = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "<email>")
    .replace(/\d+([.,:/-]\d+)*/g, "#");

// Data in names: the page-template variance rule (D-052). Two snapshots of the same page template whose structure is
// equal except for record-varying names at the same structural positions are the same state; those positions are the
// page's data slots. Identity is the page plus the snapshot's *shape*: the fingerprint with every record-varying name
// replaced by a slot marker (see fingerprint() for which names those are). Deterministic and independent of recording
// order: the same snapshots always fall into the same states. Names that tell states apart (buttons, alerts, messages,
// column headers, chips, tabs, h3 and lower, mode indicators, anything in a dialog) stay in the shape.
const SLOT = "◇";

const textOf = (n) => [n.name, n.value].filter((x) => typeof x === "string").join(" ");
const isHeaderRow = (n) => n.role === "row" && n.children.some((c) => c.role === "columnheader");
const SORT_ASC = /[↑▲⬆△]|\bascending\b|\bsorted ascending\b/i;
const SORT_DESC = /[↓▼⬇▽]|\bdescending\b|\bsorted descending\b/i;
// A column header's sort state, from aria attributes the snapshot shows or an arrow or word in its name.
function sortOf(h) {
  const a = String(h.attrs.sort ?? h.attrs["aria-sort"] ?? "");
  if (/asc/i.test(a) || SORT_ASC.test(h.name ?? "")) return "asc";
  if (/desc/i.test(a) || SORT_DESC.test(h.name ?? "")) return "desc";
  if (a && a !== "none") return "yes";
  if (h.attrs.pressed === true || h.attrs.pressed === "true") return "yes";
  return null;
}
const stripSort = (s) => String(s ?? "").replace(/[↑↓▲▼⬆⬇△▽]/g, "").replace(/\b(sorted )?(ascending|descending)\b/gi, "").trim();
const isFilterInput = (n, inSearch) => n.role === "searchbox" || (["textbox", "combobox"].includes(n.role) && (inSearch || /\b(search|filter|find|query)\b/i.test(n.name ?? "")));

// The page title's parts ("Jane Doe - Acme CRM" -> "jane doe", "acme crm"), for the title rule of isDataSlot.
export const titlePartsOf = (title) =>
  String(title ?? "")
    .split(/\s+[-|·—–:]\s+/)
    .map((x) => normName(x).toLowerCase())
    .filter((x) => x.length >= 3);

// The structural fingerprint of a snapshot (D-052).
// -> {fingerprint, shape, lines, shapeLines, slots[]}
//   lines/fingerprint  roles, names (numbers, dates and emails normalised) and flags of controls, headings, dialogs,
//                      tabs, alerts, status messages, landmarks and validation-like messages; the selected tab; per
//                      table its column headers with any sort state, the distinct shapes of its body rows (names
//                      erased) and whether it has rows; per list outside navigation the distinct item shapes and
//                      whether it has items; a filled search or filter box; the index of a select's selected option.
//                      Values, typed form text, row counts, refs, cursor and checked/expanded state are ignored.
//   shapeLines/shape   the same with every record-varying name replaced by ◇ (a data slot); the state's identity on
//                      its page. A name is a data slot only when it is record-varying (isDataSlot): inside a
//                      collection (a list item, a row, an article or card, a navigation list), a link to a record (its
//                      target erases to an id), a level-1 or level-2 heading outside a dialog, a breadcrumb item, or a
//                      name that repeats the page title. Every other name stays significant: buttons and other
//                      controls, alerts and status messages, validation messages, column headers, filter chips, tabs,
//                      h3 and lower headings, mode indicators, and anything inside a dialog.
//   slots              the names that became slots, in order (hashed into the log; never stored as text).
export function fingerprint(root, { title } = {}) {
  const parts = titlePartsOf(title ?? root.title); // the snapshot's own Page Title unless one is passed
  const lines = [];
  const shapeLines = [];
  const slots = [];
  const emit = (depth, pre, name, post, slot) => {
    const pad = "  ".repeat(depth);
    const shown = name === null || name === undefined ? "" : ` "${name}"`;
    lines.push(`${pad}${pre}${shown}${post}`);
    if (shown && slot) {
      shapeLines.push(`${pad}${pre} "${SLOT}"${post}`);
      slots.push(name);
    } else shapeLines.push(`${pad}${pre}${shown}${post}`);
  };
  const plain = (depth, s) => emit(depth, s, null, "", false);
  const flags = (n, ctx) => {
    let s = "";
    if (n.role === "heading" && n.attrs.level) s += ` [level=${n.attrs.level}]`;
    if (n.role === "tab" && n.attrs.selected) s += " [selected]";
    if (["combobox", "listbox"].includes(n.role)) {
      const opts = [];
      const collect = (x) => (x.role === "option" ? opts.push(x) : x.children.forEach(collect));
      n.children.forEach(collect);
      const sel = opts.findIndex((o) => o.attrs.selected);
      if (sel >= 0) s += ` [selected=#${sel + 1}]`;
    }
    if (isFilterInput(n, ctx.inSearch) && typeof n.value === "string" && n.value.trim()) s += " [filled]";
    return s;
  };
  // the page title rule: a name equal to a title part, or containing a title part of two or more words
  const repeatsTitle = (name) => {
    const t = name.toLowerCase();
    return parts.some((p) => t === p || (p.includes(" ") && ` ${t} `.includes(` ${p} `)));
  };
  const recordLink = (n) => {
    if (n.role !== "link" || !n.props.url) return false;
    try {
      return templatePath(new URL(n.props.url, "https://x.invalid/").pathname, { people: true }).includes("{");
    } catch {
      return false;
    }
  };
  // a name is a data slot only when it is record-varying (D-052)
  const isDataSlot = (n, name, ctx) => {
    if (ctx.inDialog || ["dialog", "alertdialog"].includes(n.role)) return false;
    if (ctx.collection || ctx.crumb) return true;
    if (n.role === "heading" && ["1", "2"].includes(String(n.attrs.level))) return true;
    if (recordLink(n)) return true;
    return repeatsTitle(name);
  };
  const named = (depth, n, ctx, post) => {
    // an alert or status message without a name carries its text inline (`- alert: Contact saved`)
    const raw = n.name || (["alert", "status"].includes(n.role) && typeof n.value === "string" ? n.value : null);
    const name = FP_NAMED.has(n.role) && raw ? normName(raw) : null;
    emit(depth, n.role, name, post, name !== null && isDataSlot(n, name, ctx));
  };
  const skeleton = (n) => {
    const out = [];
    const rec = (x, d) => {
      const shown = FP_ROLES.has(x.role);
      if (shown) out.push(`${"  ".repeat(d)}${x.role}${flags(x, {})}`);
      for (const c of x.children) rec(c, shown ? d + 1 : d);
    };
    rec(n, 0);
    return out.join("\n");
  };
  const emitShapes = (depth, kind, shapes) => {
    for (const s of sortedUniq(shapes)) for (const l of (`${kind}\n` + s.split("\n").map((x) => "  " + x).join("\n")).split("\n")) if (l.trim()) plain(depth, l);
  };
  const walk = (n, depth, ctx) => {
    if (COLLECTION_TABLES.includes(n.role)) {
      named(depth, n, ctx, flags(n, ctx));
      const rows = [];
      const collect = (x) => (x.role === "row" ? rows.push(x) : x.children.forEach(collect));
      n.children.forEach(collect);
      for (const r of rows.filter(isHeaderRow))
        for (const h of r.children) {
          const sort = sortOf(h);
          emit(depth + 1, "columnheader", normName(stripSort(h.name)), sort ? ` [sorted=${sort}]` : "", false); // the chosen columns are structure
        }
      const body = rows.filter((r) => !isHeaderRow(r));
      emitShapes(depth + 1, "row", body.map((r) => skeleton(r)));
      plain(depth + 1, `rows:${body.length ? "some" : "empty"}`);
      return;
    }
    if (n.role === "list" && !ctx.nav) {
      const items = n.children.filter((c) => c.role === "listitem");
      plain(depth, "list");
      emitShapes(depth + 1, "listitem", items.map((c) => skeleton(c)));
      plain(depth + 1, `items:${items.length ? "some" : "empty"}`);
      return;
    }
    const shown = FP_ROLES.has(n.role);
    const inDialog = ctx.inDialog || ["dialog", "alertdialog"].includes(n.role);
    if (shown) named(depth, n, ctx, flags(n, ctx));
    else if (n.role !== "root" && MESSAGE_RE.test(textOf(n)) && !n.children.length) emit(depth, "msg", normName(textOf(n)), "", false); // validation messages are structure
    const next = {
      nav: ctx.nav || ["navigation", "menu", "menubar", "tablist"].includes(n.role),
      crumb: ctx.crumb || (n.role === "navigation" && /bread ?crumb/i.test(n.name ?? "")),
      inSearch: ctx.inSearch || n.role === "search",
      collection: !inDialog && (ctx.collection || ["listitem", "row", "article"].includes(n.role)),
      inDialog,
    };
    for (const c of n.children) walk(c, shown ? depth + 1 : depth, next);
  };
  walk(root, 0, {});
  return { fingerprint: sha256Text(lines.join("\n")).slice(0, 16), shape: sha256Text(shapeLines.join("\n")).slice(0, 16), lines, shapeLines, slots };
}

// ---------- pages and URLs ----------

// The route of a URL: the hash route of a single-page app (#/x or #!/x), else the path.
function routeOf(url) {
  const u = new URL(url);
  const hash = u.hash.replace(/^#!?/, "");
  return { u, route: hash.startsWith("/") ? hash.split("?")[0] : u.pathname, hashRoute: hash.startsWith("/") };
}

// A segment that carries a value even though endpoints' id rules keep it: an email, or a long token with dots, equals
// signs or percent escapes (a JWT, a base64 value).
const sensitiveSegment = (s) => s.includes("@") || s.includes("%40") || (s.length >= 16 && /[.=%~]/.test(s) && /\d/.test(s));
// Page paths only: a letters-only segment right after a people collection (/users/jdoe) is a person, unless it is a
// common literal. Network paths never use this rule: they keep lib/endpoints.mjs's keys.
const PEOPLE = new Set("users user people person persons members member customers customer profiles profile employees employee authors author u".split(" "));
const PEOPLE_LITERALS = new Set(("me self current new create edit list all search filter lookup autocomplete suggest count bulk batch import export " +
  "settings preferences roles permissions groups teams summary stats recent active inactive archived deleted invite invitations " +
  "avatar avatars merge duplicates tags fields views reports activity activities notes favorites starred shared mine my status " +
  "login logout signin signout signup register password security billing notifications profile details overview history upcoming segments").split(" "));

// A path -> its template. Always: lib/endpoints.mjs's id rules (normalizePath), plus emails and tokens; matrix
// parameters (;jsessionid=...) dropped. With people: true (page paths), also the people rule above.
export function templatePath(p, { people = false } = {}) {
  const clean = String(p).split(/[?#]/)[0].split("/").map((s) => s.split(";")[0]).join("/");
  const segs = segments(normalizePath(clean).path);
  return "/" + segs.map((s, i) => {
    if (/^\{.*\}$/.test(s)) return s;
    if (sensitiveSegment(s) || isIdSegment(s)) return "{id}";
    const prev = (segs[i - 1] ?? "").toLowerCase();
    if (people && PEOPLE.has(prev) && /^[A-Za-z]+$/.test(s) && !PEOPLE_LITERALS.has(s.toLowerCase())) return "{id}";
    return s;
  }).join("/");
}

// A page: its key (method-less, param names erased; host-prefixed when not the target's), template and a display URL
// with no query string and no values beyond the path.
export function pageOf(url, primaryOrigin) {
  const { u, route, hashRoute } = routeOf(url);
  const tpl = templatePath(route, { people: true });
  const foreign = u.origin.toLowerCase() !== primaryOrigin;
  const prefix = foreign ? `//${u.host.toLowerCase()}` : "";
  return { key: prefix + erase(tpl), template: prefix + tpl, url: `${u.origin}${hashRoute ? `${u.pathname}#${route}` : u.pathname}` };
}

export const slugBase = (template) =>
  template.replace(/^\/\//, "").replace(/\{[^}]*\}/g, "id").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "home";

// The module's path prefixes: from entry_url (trailing leaf segments such as list, all, index, overview, home dropped;
// then up to the segment naming the module, else the remaining path), the overlay's scope.prefixes, or, with no
// entry_url, the first state's route.
const LEAF_SEGMENTS = new Set(["list", "all", "index", "index.html", "overview", "home", "dashboard", "main", "default"]);
export function modulePrefixes(cfg, module, overlay, firstUrl) {
  const entry = (cfg.modules ?? []).find((m) => m.slug === module) ?? {};
  const names = new Set([module, entry.name].filter(Boolean).map(nameKey));
  const prefixOf = (url) => {
    const segs = segments(routeOf(url).route);
    while (segs.length > 1 && LEAF_SEGMENTS.has(segs.at(-1).toLowerCase())) segs.pop();
    const i = segs.findIndex((s) => names.has(nameKey(decodeURIComponent(s))));
    return "/" + (i >= 0 ? segs.slice(0, i + 1) : segs).join("/");
  };
  const out = [...asList(overlay.scope?.prefixes)];
  if (entry.entry_url) out.push(prefixOf(entry.entry_url));
  else if (firstUrl) out.push(prefixOf(firstUrl));
  return sortedUniq(out.map((p) => "/" + segments(p).join("/")));
}

const inPrefix = (route, prefixes) => prefixes.some((p) => p === "/" || route === p || route.startsWith(p + "/"));

// ---------- controls (the frontier of one state) ----------

// -> [{role, name, keyName, names[], occurrences, order, url?, disabled, chrome, containers[], inForm, inDialog,
//      pointer?, collection, options?, required?, placeholder?, inputType?}] one per distinct role + key name, in order.
// A candidate control is a node of a control role, or any other node the snapshot marks [cursor=pointer] (a clickable
// generic, image, column header or row) that is not inside another control.
export function extractControls(root, baseUrl) {
  const out = new Map();
  let order = 0;
  const unnamed = {};
  const visit = (n, c) => {
    let ctx = c;
    if (CHROME_ROLES.includes(n.role)) ctx = { ...ctx, chrome: true };
    if (CONTAINER_ROLES.includes(n.role))
      ctx = {
        ...ctx,
        containers: [...ctx.containers, `${n.role}${n.name ? `:${normName(n.name)}` : ""}`],
        inForm: ctx.inForm || ["form", "dialog", "alertdialog"].includes(n.role),
        inDialog: ctx.inDialog || ["dialog", "alertdialog"].includes(n.role),
      };
    if (COLLECTION_TABLES.includes(n.role)) ctx = { ...ctx, table: { headers: [] } };
    if (n.role === "row" && ctx.table) {
      if (isHeaderRow(n)) ctx.table.headers = n.children.filter((x) => x.role === "columnheader").map((x) => x.name ?? "");
      else ctx = { ...ctx, row: { col: -1 } };
    }
    if ((n.role === "cell" || n.role === "gridcell") && ctx.row) {
      ctx.row.col += 1;
      ctx = { ...ctx, col: ctx.row.col };
    }
    if (n.role === "listitem") ctx = { ...ctx, item: true };
    const pointer = !CONTROL_ROLES.includes(n.role) && n.attrs.cursor === "pointer" && !ctx.inControl;
    if (CONTROL_ROLES.includes(n.role) || pointer) {
      const name = String(n.name ?? (pointer && typeof n.value === "string" ? n.value : "") ?? "").trim();
      const url = n.props.url ?? null;
      let target = null;
      if (url && baseUrl) {
        try {
          target = new URL(url, baseUrl).href;
        } catch {}
      }
      const targetTpl = target && /^https?:/i.test(target) ? pageOf(target, new URL(target).origin).template : null;
      const collection = !!(ctx.row || ctx.item);
      let keyName = name || `(unnamed ${(unnamed[n.role] = (unnamed[n.role] ?? 0) + 1)})`;
      if (n.role === "row" && ctx.row) keyName = "[row]";
      else if (ctx.row && n.role === "link") keyName = `[row] ${ctx.table.headers[ctx.col] ? normName(stripSort(ctx.table.headers[ctx.col])) : `column ${ctx.col + 1}`}`;
      else if (ctx.row) keyName = `[row] ${normName(name)}`;
      else if (collection && n.role === "link" && targetTpl?.includes("{")) keyName = `[record] ${targetTpl}`;
      const k = `${n.role}|${keyName}`;
      const prev = out.get(k);
      if (prev) {
        prev.occurrences += 1;
        if (name && prev.names.length < 20 && !prev.names.includes(name)) prev.names.push(name);
      } else {
        const options = ["combobox", "listbox"].includes(n.role) ? n.children.flatMap(function opts(x) { return x.role === "option" ? [x.name ?? ""] : x.children.flatMap(opts); }).filter(Boolean).slice(0, 50) : [];
        out.set(k, {
          role: n.role,
          name,
          keyName,
          names: name ? [name] : [],
          occurrences: 1,
          order: order++,
          ...(target ? { url: target } : {}),
          ...(pointer ? { pointer: true } : {}),
          disabled: !!n.attrs.disabled,
          chrome: !!ctx.chrome,
          containers: ctx.containers,
          inForm: !!ctx.inForm,
          inDialog: !!ctx.inDialog,
          collection,
          ...(options.length ? { options } : {}),
          ...(/\*\s*$/.test(name) || /\((required|mandatory)\)/i.test(name) || n.attrs.required ? { required: true } : {}),
          ...(n.props.placeholder ? { placeholder: n.props.placeholder } : {}),
          ...(INPUT_ROLES.includes(n.role) ? { inputType: { searchbox: "search", spinbutton: "number", slider: "range", textbox: "text", combobox: "select", listbox: "select" }[n.role] ?? n.role } : {}),
          ...(n.attrs.maxlength ? { maxlength: Number(n.attrs.maxlength) } : {}),
          ...(n.attrs.pattern ? { pattern: n.attrs.pattern } : {}),
        });
      }
      ctx = { ...ctx, inControl: true };
    }
    for (const x of n.children) visit(x, ctx);
  };
  visit(root, { chrome: false, containers: [], inForm: false, inDialog: false });
  return [...out.values()];
}

const KIND = { textbox: "input", searchbox: "input", spinbutton: "input", slider: "other", combobox: "select", listbox: "select", checkbox: "checkbox", switch: "checkbox", radio: "radio", link: "link", button: "button" };
// c: {role, name, inForm?, inDialog?}
export function mutatesControl(c) {
  const isClickable = COMMIT_ROLES.includes(c.role) || c.pointer;
  if (!isClickable) return false;
  const name = String(c.name ?? "").trim();
  if (DISMISS_RE.test(name)) return false;
  if (c.inDialog && c.role === "button" && name) return true;
  const words = name.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => COMMIT_WORDS.has(w))) return true;
  if (OBJECT_COMMIT.has(words[0]) && words.length > 1) return true;
  return !!(c.inForm && CREATE_RE.test(name));
}

// "<role> \"<name>\"" -> {role, name} | null
export function parseAction(a) {
  const m = /^\s*([a-z][a-z-]*)\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(String(a ?? ""));
  return m ? { role: m[1].toLowerCase(), name: m[2].replace(/\\(.)/g, "$1") } : null;
}

// ---------- the network capture ----------

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
const NETWORK_LINE = new RegExp(`\\[(${METHODS})\\]\\s+(\\S+)(?:\\s+=>\\s+\\[(\\d{3})\\])?`, "i");

// Supported captures (docs/agent-handoffs.md §1):
//   network-requests  the browser tool's network listing, one request per line: `[GET] https://host/p?x=1 => [200] OK`
//   har               a HAR file (log.entries[]: request {method, url, postData {mimeType, text|params[]}},
//                     response {status, content {mimeType, text, encoding}})
//   json              a list (or {requests: [...]}) of {method, url, status, requestBody?, responseBody?}
// -> {format, requests: [{method, url, status, requestBody?, requestMime?, requestParams?, responseBody?, responseMime?}]}
export function parseNetworkCapture(text) {
  const t = String(text).replace(/^﻿/, "").trim();
  if (!t) return { format: "empty", requests: [] };
  if (t.startsWith("{") || t.startsWith("[")) {
    let data;
    try {
      data = JSON.parse(t);
    } catch (e) {
      if (t.startsWith("[") && NETWORK_LINE.test(t)) return parseLines(t);
      throw new Error(`the network capture looks like JSON but does not parse: ${e.message}`);
    }
    if (Array.isArray(data?.log?.entries)) {
      return {
        format: "har",
        requests: data.log.entries.map((e) => {
          const content = e.response?.content ?? {};
          const body = content.encoding === "base64" && content.text ? Buffer.from(content.text, "base64").toString("utf8") : content.text;
          return {
            method: e.request?.method,
            url: e.request?.url,
            status: e.response?.status,
            requestBody: e.request?.postData?.text,
            requestMime: e.request?.postData?.mimeType,
            requestParams: (e.request?.postData?.params ?? []).map((p) => p.name),
            responseBody: body,
            responseMime: content.mimeType,
          };
        }),
      };
    }
    const list = Array.isArray(data) ? data : Array.isArray(data?.requests) ? data.requests : null;
    if (!list) throw new Error("a JSON network capture must be a HAR (log.entries) or a list of {method, url, status}");
    return { format: "json", requests: list.map((r) => ({ method: r.method, url: r.url, status: r.status, requestBody: r.requestBody ?? r.postData, responseBody: r.responseBody ?? r.response })) };
  }
  return parseLines(t);
}
function parseLines(t) {
  const requests = [];
  for (const line of t.split(/\r?\n/)) {
    const m = NETWORK_LINE.exec(line);
    if (m) requests.push({ method: m[1].toUpperCase(), url: m[2], status: m[3] ? Number(m[3]) : null });
  }
  if (!requests.length) throw new Error("no requests found: expected the browser's network listing ([METHOD] url => [status] ...), a HAR, or a JSON list");
  return { format: "network-requests", requests };
}

// A key name that is itself a value is not kept: an id (endpoints' rules), an email, a name with spaces, a token.
// Property-like names (filter.status, page.size, sort-by-2) stay as they are.
const safeKey = (k) => (isIdSegment(k) || k.includes("@") || /\s/.test(k) || k.length > 64 || sensitiveSegment(k) ? "{key}" : k);
const keysOf = (v) => {
  if (Array.isArray(v)) return sortedUniq(v.slice(0, 10).flatMap((x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x) : [])).map(safeKey));
  if (v && typeof v === "object") return sortedUniq(Object.keys(v).map(safeKey));
  return [];
};
function parseBody(body, mime) {
  if (body === undefined || body === null || body === "") return null;
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    if (/x-www-form-urlencoded/i.test(mime ?? "") || /^[\w.%-]+=[^&]*(&[\w.%-]+=[^&]*)*$/.test(body)) return Object.fromEntries([...new URLSearchParams(body).keys()].map((k) => [k, true]));
    return null;
  }
}

// GraphQL operations of a request body ({query, operationName} or a batch), by a small tokenizer: the operation type
// and the root field names, never arguments or variables. -> [{operationType, operationName?, fields[]}]
export function graphqlOps(body) {
  const out = [];
  for (const b of Array.isArray(body) ? body : [body]) {
    if (!b || typeof b !== "object") continue;
    if (typeof b.query === "string") out.push(...parseGraphqlDocument(b.query, b.operationName));
    else if (b.operationName) out.push({ operationType: "unknown", operationName: String(b.operationName), fields: [] }); // a persisted query: type unknown, so treated as mutating
  }
  return out;
}
export function parseGraphqlDocument(doc, operationName) {
  const tokens = [];
  const re = /#[^\n]*|"""[\s\S]*?"""|"(?:[^"\\]|\\.)*"|\.\.\.|[{}():@$!=\[\],]|[_A-Za-z][_0-9A-Za-z]*|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const m of String(doc).matchAll(re)) if (!m[0].startsWith("#") && m[0] !== ",") tokens.push(m[0]);
  const ops = [];
  const isName = (t) => /^[_A-Za-z]/.test(t ?? "");
  let i = 0;
  const skipBalanced = (open, close) => {
    let d = 0;
    for (; i < tokens.length; i++) {
      if (tokens[i] === open) d++;
      else if (tokens[i] === close && --d === 0) return void i++;
    }
  };
  const selection = () => {
    // at '{'
    const fields = [];
    let depth = 0;
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === "{") depth++;
      else if (t === "}") {
        if (--depth === 0) {
          i++;
          return fields;
        }
      } else if (t === "(") {
        skipBalanced("(", ")");
        i--;
      } else if (t === "...") {
        if (tokens[i + 1] === "on") i += 2;
        else i++;
      } else if (t === "@") i++;
      else if (depth === 1 && isName(t)) {
        if (tokens[i + 1] === ":" && isName(tokens[i + 2])) {
          i += 2;
          if (!tokens[i].startsWith("__")) fields.push(tokens[i]);
        } else if (!t.startsWith("__")) fields.push(t);
      }
    }
    return fields;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (["query", "mutation", "subscription"].includes(t)) {
      i++;
      const name = isName(tokens[i]) && tokens[i] !== "on" ? tokens[i++] : undefined;
      while (i < tokens.length && tokens[i] !== "{") {
        if (tokens[i] === "(") skipBalanced("(", ")");
        else i++;
      }
      const fields = selection() ?? [];
      ops.push({ operationType: t, ...(name ? { operationName: name } : {}), fields: sortedUniq(fields) });
    } else if (t === "{") ops.push({ operationType: "query", fields: sortedUniq(selection() ?? []) });
    else if (t === "fragment") {
      while (i < tokens.length && tokens[i] !== "{") i++;
      skipBalanced("{", "}");
    } else i++;
  }
  return operationName && ops.some((o) => o.operationName === operationName) ? ops.filter((o) => o.operationName === operationName) : ops;
}

// One captured request -> its shape, or {drop: reason}. Never keeps a value: no query or body values, no headers, no
// cookies, no userinfo; ids and sensitive segments in the path become {id}.
export function normalizeRequest(r, primaryOrigin) {
  if (!r?.url || !/^https?:\/\//i.test(String(r.url))) return { drop: "not-http" };
  let u;
  try {
    u = new URL(r.url);
  } catch {
    return { drop: "not-http" };
  }
  if (STATIC_RE.test(u.pathname)) return { drop: "static" };
  const method = String(r.method ?? "GET").toUpperCase();
  const origin = u.origin.toLowerCase();
  const pathTemplate = templatePath(u.pathname);
  const body = parseBody(r.requestBody, r.requestMime);
  const queryKeys = sortedUniq([...u.searchParams.keys()].map(safeKey));
  const requestKeys = sortedUniq([...keysOf(Array.isArray(body) ? body[0] : body), ...(r.requestParams ?? []).map(safeKey)]);
  const gqlBody = body && (typeof body.query === "string" || (Array.isArray(body) && typeof body[0]?.query === "string") || body.operationName) ? body : null;
  const gqlGet = !gqlBody && u.searchParams.get("query") && /graphql/i.test(u.pathname) ? { query: u.searchParams.get("query"), operationName: u.searchParams.get("operationName") ?? undefined } : null;
  const isGql = /\/graphql\/?$/i.test(u.pathname) || !!gqlBody || !!gqlGet;
  const graphql = isGql ? graphqlOps(gqlBody ?? gqlGet ?? {}) : null;
  return {
    key: restKey(method, origin, pathTemplate, primaryOrigin),
    method,
    pathTemplate,
    ...(origin !== primaryOrigin ? { host: u.host.toLowerCase() } : {}),
    statusCodes: Number.isInteger(Number(r.status)) && Number(r.status) > 0 ? [Number(r.status)] : [],
    requestKeys,
    queryKeys,
    responseKeys: keysOf(parseBody(r.responseBody, r.responseMime)),
    ...(graphql ? { graphql } : {}),
  };
}

// ---------- the log ----------

export function readLog(xp) {
  if (!existsSync(xp.log)) return [];
  return readFileSync(xp.log, "utf8").split("\n").filter(Boolean).map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      throw new Error(`${xp.log}:${i + 1}: not valid JSON (the log is script-owned; never edit it)`);
    }
  });
}
const appendLog = (xp, e) => {
  mkdirSync(path.dirname(xp.log), { recursive: true });
  appendFileSync(xp.log, JSON.stringify(e) + "\n", "utf8");
};

const primaryOriginOf = (cfg) => new URL(cfg.target.url).origin.toLowerCase();
const firstPartyHosts = (cfg) => sortedUniq([cfg.target.url, ...(cfg.target.api_urls ?? [])].map((u) => new URL(u).hostname.toLowerCase()));

// Assign page ids, and a slug (once, unique, never changed) to each new page. -> the registry
function assignPages(ctx, firstEvents) {
  const { xp, module, runId } = ctx;
  const reg = assignIds(xp.registry.pages, [...firstEvents.keys()], { module, runId, prefix: "PG", field: "pages" });
  const missing = [...firstEvents.keys()].sort().filter((k) => !reg.pages[k].slug);
  if (!missing.length) return reg;
  return withFileLock(xp.registry.pages, () => {
    const r = readJson(xp.registry.pages);
    const taken = new Set(Object.values(r.pages).map((e) => e.slug).filter(Boolean));
    for (const k of missing) {
      const base = slugBase(firstEvents.get(k).template);
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      taken.add(slug);
      Object.assign(r.pages[k], { slug, template: firstEvents.get(k).template });
    }
    writeAtomic(xp.registry.pages, JSON.stringify(r, null, 2) + "\n");
    return r;
  });
}

// ---------- the model ----------

export const readOverlay = (xp) => {
  const o = readJson(xp.overlay, {});
  return { items: o.items ?? {}, kq: o.kq ?? {}, inputs: o.inputs ?? {}, scope: o.scope ?? {} };
};
export const readQuestions = (xp) => readJson(xp.questions, []);

// The knowledge open points to account for: the module's and the product's active KQ ids.
export function openPoints(ctx) {
  const out = [];
  const problems = [];
  for (const [scope, file, label] of [["module", ctx.kp.module(ctx.module).openPoints, `knowledge/modules/${ctx.module}/open-points.json`], ["product", ctx.kp.openPoints, "knowledge/open-points.json"]]) {
    const reg = readJson(file, null);
    if (!reg) {
      problems.push(`${label}: missing (the knowledge stages write it; explore accounts for every KQ id in it)`);
      continue;
    }
    for (const e of Object.values(reg.points ?? {})) if (e.status === "active") out.push({ id: e.id, scope, text: e.text, category: e.category ?? null, file: e.file ?? null });
  }
  return { points: out.sort((a, b) => (a.scope === b.scope ? idNum(a.id) - idNum(b.id) : a.scope === "module" ? -1 : 1)), problems };
}

// ---------- citations that must show what they are cited for (D-052) ----------

const squash = (t) => String(t ?? "").toLowerCase().replace(/[“”"'’]/g, "").replace(/\s+/g, " ").trim();
const words = (t) => squash(t).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
// The file a citation names, or null (clarification:/testcase: name no file).
function citedFile(c, ctx) {
  const [kind, ...rest] = String(c).split(":");
  const file = rest.join(":").split("#")[0];
  if (kind === "observation") return path.join(ctx.xp.moduleDir, file);
  if (kind === "knowledge") return path.join(ctx.productDir, "knowledge", file);
  if (kind === "spec") return path.join(ctx.xp.moduleDir, "api", file);
  return null;
}
// The shape of a text if it is an accessibility snapshot, else null.
function snapshotShape(text) {
  const p = parseSnapshot(text);
  return p.root.children.length ? fingerprint(p.root).shape : null;
}
// Does the text quote the KQ: some run of 3 consecutive words of the KQ's text, ignoring case and punctuation?
export function quotesKq(text, kqText) {
  const w = words(kqText);
  const hay = ` ${words(text).join(" ")} `;
  if (w.length < 3) return hay.includes(` ${w.join(" ")} `);
  for (let i = 0; i + 3 <= w.length; i++) if (hay.includes(` ${w.slice(i, i + 3).join(" ")} `)) return true;
  return false;
}

// Everything derived from the log, the snapshots, the overlay, the questions and the CSV. Assigns ids (registries);
// writes nothing else. -> model {pages, states, transitions, frontier, inventory, kq, inputs, questions, budgets, problems}
export function derive(ctx) {
  const { xp, module, runId, cfg } = ctx;
  const primary = primaryOriginOf(cfg);
  const hosts = firstPartyHosts(cfg);
  const events = readLog(xp).filter((e) => e.runId === runId);
  const stateEvents = events.filter((e) => e.type === "state");
  const problems = [];
  const overlay = readOverlay(xp);

  // pages and states, in first-seen order
  const pageFirst = new Map();
  const stateFirst = new Map();
  for (const e of stateEvents) {
    if (!pageFirst.has(e.pageKey)) pageFirst.set(e.pageKey, e);
    if (!stateFirst.has(e.key)) stateFirst.set(e.key, e);
  }
  const pgReg = assignPages(ctx, pageFirst);
  const stReg = assignIds(xp.registry.states, [...stateFirst.keys()], { module, runId, prefix: "ST", field: "states" });
  const stateId = (key) => stReg.states[key].id;
  const states = [...stateFirst.values()].map((e) => {
    const pg = pgReg.pages[e.pageKey];
    // data slots: the name positions that differed between the snapshots recorded as this state
    const seen = stateEvents.filter((x) => x.key === e.key && Array.isArray(x.slotHashes)).map((x) => x.slotHashes);
    const dataSlots = (seen[0] ?? []).map((_, i) => i).filter((i) => new Set(seen.map((h) => h[i])).size > 1);
    return { id: stateId(e.key), key: e.key, fingerprint: e.fingerprint, ...(e.shape ? { shape: e.shape } : {}), dataSlots, page: pg.id, slug: pg.slug, pageKey: e.pageKey, url: e.url, title: e.title ?? null, snapshot: e.snapshot };
  }).sort(byId);
  const stateById = new Map(states.map((s) => [s.id, s]));
  const pages = [...pageFirst.entries()].map(([k, e]) => {
    const pg = pgReg.pages[k];
    return { id: pg.id, slug: pg.slug, key: k, template: pg.template ?? e.template, url: e.url, title: e.title ?? null, states: states.filter((s) => s.pageKey === k).map((s) => s.id) };
  }).sort(byId);
  const firstUrl = stateEvents[0]?.url ?? null;
  const prefixes = modulePrefixes(cfg, module, overlay, firstUrl);

  // controls of every state, from its stored snapshot
  const controls = []; // {itemKey, state, ...control}
  for (const s of states) {
    const file = path.join(xp.dir, s.snapshot);
    if (!existsSync(file)) {
      problems.push(`${s.id}: its snapshot ${s.snapshot} is missing (record the state again)`);
      continue;
    }
    for (const c of extractControls(parseSnapshot(readFileSync(file, "utf8")).root, s.url)) controls.push({ ...c, itemKey: `${s.id}|${c.role}|${c.keyName}`, state: s.id });
  }

  // transitions; an action "<role> \"<name>\"" (or an item id) names the control it fired
  const matchItem = (from, action) => {
    const a = parseAction(action);
    if (!a) return null;
    const cands = controls.filter((c) => c.state === from && c.role === a.role);
    return cands.find((c) => c.name === a.name || c.names.includes(a.name)) ?? cands.find((c) => normName(c.name) === normName(a.name) || c.keyName === a.name) ?? null;
  };
  // An item id (--item FR-…) resolves through the frontier registry as it stood before this derive; ids are stable.
  const keyOfId = new Map(Object.entries(readJson(xp.registry.frontier, { items: {} }).items ?? {}).map(([k, e]) => [e.id, k]));
  const resolveAction = (from, a) => (/^FR-/.test(a) ? controls.find((c) => c.itemKey === keyOfId.get(a) && c.state === from) ?? null : matchItem(from, a));
  const deferredKeys = new Map(); // itemKey -> detail
  const synthetic = []; // items that exist only because a budget deferred them
  for (const e of events.filter((x) => x.type === "deferred")) {
    const matched = e.via ? (e.actions ?? []).map((a) => resolveAction(e.via, a)).find(Boolean) : null;
    if (matched) deferredKeys.set(matched.itemKey, e.detail);
    else {
      const itemKey = e.via ? `${e.via}|action|${(e.actions ?? []).join(" then ") || "(none)"}` : `(entry)|goto|${e.pageKey}`;
      if (!synthetic.some((x) => x.itemKey === itemKey)) synthetic.push({ itemKey, state: e.via ?? null, role: e.via ? "action" : "goto", name: e.via ? (e.actions ?? []).join(" then ") : e.template, keyName: e.pageKey, names: [], occurrences: 1, order: 0, containers: [], chrome: false, inForm: false, collection: false, disabled: false, ...(e.url ? { url: e.url } : {}) });
      deferredKeys.set(itemKey, e.detail);
    }
  }
  const frReg = assignIds(xp.registry.frontier, uniq([...controls, ...synthetic].map((c) => c.itemKey)), { module, runId, prefix: "FR", field: "items" });
  const itemId = (k) => frReg.items[k].id;
  const itemByIdLookup = new Map();

  const transitions = [];
  const explored = new Map(); // itemKey -> Set(to)
  const warnings = [];
  for (const e of stateEvents.filter((x) => x.via)) {
    const to = stateId(e.key);
    const actions = e.actions ?? [];
    const items = [];
    for (const a of actions) {
      const c = resolveAction(e.via, a);
      if (c) {
        items.push(itemId(c.itemKey));
        if (!explored.has(c.itemKey)) explored.set(c.itemKey, new Set());
        explored.get(c.itemKey).add(to);
      } else warnings.push(`${e.via} → ${to}: action '${a}' matches no control of ${e.via}`);
    }
    const t = { from: e.via, actions, items: uniq(items), to };
    if (!transitions.some((x) => x.from === t.from && x.to === t.to && x.actions.join("\n") === t.actions.join("\n"))) transitions.push(t);
  }

  // dedupe groups: a control explored once per page and container; links once per name and target; global chrome once
  const pageKeyOf = (stateIdv) => stateById.get(stateIdv)?.pageKey ?? "";
  const groupOf = (c) => {
    if (c.role === "link" && c.url) return `link|${c.keyName}|${pageOf(c.url, primary).key}`;
    if (c.chrome) return `chrome|${c.containers.join(">")}|${c.role}|${c.keyName}`;
    return `${pageKeyOf(c.state)}|${c.containers.join(">")}|${c.role}|${c.keyName}`;
  };
  const canonical = new Map();
  for (const c of [...controls].sort((a, b) => idNum(a.state) - idNum(b.state) || a.order - b.order)) if (!canonical.has(groupOf(c))) canonical.set(groupOf(c), c);

  // budgets
  const budgets = {
    max_states: ctx.budgets.max_states,
    max_pages: ctx.budgets.max_pages,
    states: states.length,
    pages: pages.length,
  };
  budgets.reached = { states: states.length >= budgets.max_states, pages: pages.length >= budgets.max_pages };
  const knownPages = new Set(pages.map((p) => p.key));

  // the frontier: each item's status
  const validId = new Set([...controls, ...synthetic].map((c) => itemId(c.itemKey)));
  const ctlById = new Map([...controls, ...synthetic].map((c) => [itemId(c.itemKey), c]));
  const rows = readRows(csvPath(ctx.productDir, module));
  const citeCtx = { rows, cases: new Set(), productDir: ctx.productDir, moduleDir: xp.moduleDir };
  // the agent's exclusions: only its own reasons, each cited (a capture) or naming a real duplicate
  const overlayOk = new Set();
  for (const [id, r] of Object.entries(overlay.items)) {
    const P = (m) => problems.push(`overlay.json items.${id}: ${m}`);
    if (!validId.has(id)) {
      problems.push(`overlay.json items: '${id}' is not a frontier item of this run`);
      continue;
    }
    if (!AGENT_REASONS.includes(r?.reason)) {
      P(`reason '${r?.reason}' is not the agent's to give: use ${AGENT_REASONS.join(", ")} (${FRONTIER_REASONS.filter((x) => !AGENT_REASONS.includes(x)).join(", ")} are derived by the script only)`);
      continue;
    }
    if (typeof r.detail !== "string" || !r.detail.trim()) {
      P("needs a detail saying why");
      continue;
    }
    if (CITED_REASONS.includes(r.reason)) {
      // the citation must show what happened to this item: a capture whose text names it (one capture covers at most
      // the items it names, so a blanket note proves nothing), or a different state that acting on it reached (a
      // recorded transition from the item's state that fired it). The state the item was found in shows nothing.
      const c = String(r.citation ?? "");
      const me = ctlById.get(id);
      if (/^ST-/.test(c)) {
        if (!stateById.has(c)) {
          P(`citation ${c} is not a state of this run`);
          continue;
        }
        if (c === me.state) {
          P(`citation ${c} is the state the item was found in; cite the state acting on it reached, or a capture that names it`);
          continue;
        }
        if (!transitions.some((t) => t.from === me.state && t.to === c && t.items.includes(id))) {
          P(`citation ${c}: no recorded transition from ${me.state} by ${id} reaches it; cite the state acting on it reached, or a capture that names it`);
          continue;
        }
      } else if (c.startsWith("observation:explore/captures/")) {
        const why = citationProblem(c, citeCtx);
        if (why) {
          P(why);
          continue;
        }
        const text = readFileSync(citedFile(c, ctx), "utf8");
        if (!me.name || !squash(text).includes(squash(me.name))) {
          P(`citation ${c} does not name ${me.role} "${me.name}"; cite the capture that shows what happened, or the state acting on it reached`);
          continue;
        }
        // the item's own state proves nothing: a capture that is a snapshot of the same shape (its stored copy, its raw
        // capture, or the same screen again) is refused
        if (me.state && snapshotShape(text) === stateById.get(me.state)?.shape) {
          P(`citation ${c} is a snapshot of ${me.state}, the state the item was found in; cite what acting on it showed`);
          continue;
        }
      } else {
        P(`${r.reason} needs a citation: a state id (ST-…) whose snapshot has this control, or observation:explore/captures/<file> that names it`);
        continue;
      }
    }
    if (r.reason === "duplicate-of") {
      const other = ctlById.get(r.detail.trim());
      const me = ctlById.get(id);
      if (!other || r.detail.trim() === id) {
        P("duplicate-of needs the other item's id as its detail");
        continue;
      }
      const sameName = other.name === me.name || other.names.includes(me.name) || me.names.includes(other.name);
      if (other.role !== me.role || !sameName) {
        P(`duplicate-of ${r.detail.trim()}: that item is ${other.role} "${other.name}", not ${me.role} "${me.name}"`);
        continue;
      }
    }
    overlayOk.add(id);
  }
  const frontier = [...controls, ...synthetic].map((c) => {
    const id = itemId(c.itemKey);
    const route = c.url && /^https?:/i.test(c.url) ? routeOf(c.url) : null;
    const target = c.url && route ? pageOf(c.url, primary) : null;
    const item = {
      id, state: c.state, page: c.state ? stateById.get(c.state)?.page ?? null : null, role: c.role, name: c.name,
      ...(c.names.length > 1 ? { examples: c.names.slice(0, 5) } : {}),
      ...(c.occurrences > 1 ? { occurrences: c.occurrences } : {}),
      ...(c.url ? { url: c.url } : {}), ...(target ? { target: target.template } : {}),
      ...(c.chrome ? { chrome: true } : {}), ...(c.containers.length ? { containers: c.containers } : {}),
      kind: c.role === "link" || c.role === "goto" ? "navigation" : INPUT_ROLES.includes(c.role) ? "input" : "control",
    };
    const set = (status, extra = {}) => Object.assign(item, { status }, extra);
    const ov = overlay.items[id];
    const canon = canonical.get(groupOf(c));
    if (explored.has(c.itemKey)) set("mapped", { refs: [...explored.get(c.itemKey)].sort((a, b) => idNum(a) - idNum(b)), explored: true });
    else if (deferredKeys.has(c.itemKey)) set("deferred", { reason: "budget", detail: deferredKeys.get(c.itemKey) });
    else if (overlayOk.has(id)) set("excluded", { reason: ov.reason, detail: ov.detail.trim(), ...(ov.citation ? { citation: ov.citation } : {}), by: "agent" });
    else if (LOGOUT_RE.test(c.name) || (c.url && LOGOUT_RE.test(c.url))) set("excluded", { reason: "logout", detail: "ends the session", by: "script" });
    else if (c.url && /^(mailto|tel|sms):/i.test(c.url)) set("excluded", { reason: "external", detail: c.url.split(":")[0], by: "script" });
    else if (route && !hosts.includes(route.u.hostname.toLowerCase())) set("excluded", { reason: "external", detail: route.u.host, by: "script" });
    else if (route && c.role === "link" && !inPrefix(route.route, prefixes)) set("excluded", { reason: "out-of-module", detail: `${route.route} is outside ${prefixes.join(", ") || "the module"}`, by: "script" });
    else if (canon && canon.itemKey !== c.itemKey) set("excluded", { reason: "duplicate-of", detail: itemId(canon.itemKey), by: "script" });
    else if (c.disabled) set("excluded", { reason: "disabled", detail: "disabled when captured", by: "script" });
    else if (ctx.mode === "readonly" && (TYPING_ROLES.includes(c.role) || mutatesControl(c))) set("excluded", { reason: "not-allowed-in-mode", detail: TYPING_ROLES.includes(c.role) ? "readonly: typing and selecting are blocked" : "readonly: never submit or commit", by: "script" });
    else if (budgets.reached.states) set("deferred", { reason: "budget", detail: `explore.max_states (${budgets.max_states}) reached` });
    else if (budgets.reached.pages && target && c.role === "link" && !knownPages.has(target.key)) set("deferred", { reason: "budget", detail: `explore.max_pages (${budgets.max_pages}) reached` });
    else set("pending");
    // fields (best effort, from the snapshot): kept on the item for interactions.json
    Object.defineProperty(item, "control", { value: c, enumerable: false });
    itemByIdLookup.set(id, item);
    return item;
  }).sort(byId);

  // how to reach each state: the shortest action path from a state entered by URL
  const reach = new Map();
  const roots = stateEvents.filter((e) => !e.via).map((e) => stateId(e.key));
  const queue = [];
  for (const r of uniq(roots)) {
    reach.set(r, { from: r, url: stateById.get(r).url, steps: [] });
    queue.push(r);
  }
  while (queue.length) {
    const cur = queue.shift();
    for (const t of transitions.filter((x) => x.from === cur).sort((a, b) => idNum(a.to) - idNum(b.to))) {
      if (reach.has(t.to)) continue;
      const r = reach.get(cur);
      reach.set(t.to, { from: r.from, url: r.url, steps: [...r.steps, ...t.actions] });
      queue.push(t.to);
    }
  }
  for (const s of states) s.reach = reach.get(s.id) ?? null;

  // network inventory (NI ids)
  const netEvents = events.filter((e) => e.type === "network");
  const acc = new Map();
  for (const ev of netEvents) {
    const st = ev.state ? stateById.get(ev.state) : null;
    for (const n of ev.entries ?? []) {
      const a = acc.get(n.key) ?? { method: n.method, pathTemplate: n.pathTemplate, ...(n.host ? { host: n.host } : {}), statusCodes: [], requestKeys: [], queryKeys: [], responseKeys: [], pages: [], states: [], graphql: n.graphql ? [] : undefined };
      a.statusCodes = uniq([...a.statusCodes, ...n.statusCodes]).sort((x, y) => x - y);
      for (const k of ["requestKeys", "queryKeys", "responseKeys"]) a[k] = sortedUniq([...a[k], ...(n[k] ?? [])]);
      if (st) {
        a.pages = sortedUniq([...a.pages, st.slug]);
        a.states = uniq([...a.states, st.id]).sort((x, y) => idNum(x) - idNum(y));
      }
      if (n.graphql) {
        a.graphql ??= [];
        for (const g of n.graphql) if (!a.graphql.some((x) => JSON.stringify(x) === JSON.stringify(g))) a.graphql.push(g);
      }
      acc.set(n.key, a);
    }
  }
  const niReg = assignIds(xp.registry.network, [...acc.keys()], { module, runId, prefix: "NI", field: "requests" });
  const niByKey = new Map([...acc.keys()].map((k) => [k, niReg.requests[k].id]));
  const inventory = [...acc.entries()].map(([k, a]) => ({ id: niReg.requests[k].id, ...a, ...(a.graphql ? { graphql: a.graphql.sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))) } : {}) })).sort(byId);
  for (const e of inventory) if (!e.graphql) delete e.graphql;

  // questions: new-questions.json linked to the CSV ids they were appended as
  const csvByQuestion = new Map(rows.map((r) => [normQuestion(r.question), r.id.trim()]));
  const { points, problems: kqFileProblems } = openPoints(ctx);
  problems.push(...kqFileProblems);
  const kqIds = new Set(points.map((p) => p.id));
  let rawQuestions = [];
  try {
    rawQuestions = readQuestions(xp);
  } catch (e) {
    problems.push(`new-questions.json: not valid JSON (${e.message})`);
  }
  const questions = (Array.isArray(rawQuestions) ? rawQuestions : []).map((q) => ({
    question: String(q?.question ?? ""),
    kq: asList(q?.kq).map(String),
    items: asList(q?.item).map(String),
    csv: csvByQuestion.get(normQuestion(q?.question ?? "")) ?? null,
  }));
  for (const q of questions) {
    for (const k of q.kq) if (!kqIds.has(k)) problems.push(`new-questions.json: '${q.question}' names ${k}, which is not an active knowledge open point`);
    for (const it of q.items) if (!validId.has(it)) problems.push(`new-questions.json: '${q.question}' names ${it}, which is not a frontier item of this run`);
  }

  // KQ ledger: observed (a state or evidence), asked (a CSV id), dismissed (a reason)
  for (const id of Object.keys(overlay.kq)) if (!kqIds.has(id)) problems.push(`overlay.json kq: '${id}' is not an active knowledge open point`);
  // A KQ citation: a file that quotes three consecutive words of the open point and is not the knowledge file the point
  // was written in, or an answered clarification row that a question linked to this KQ (new-questions.json kq). A state
  // is evidence only for "observed" (allowState); a bare state never dismisses a KQ.
  const kqCitationProblem = (c, p, { allowState = false } = {}) => {
    if (/^ST-/.test(c)) {
      if (!allowState) return `a bare state (${c}) can't dismiss an open point; cite a source that quotes it, or the answered clarification row that asks it`;
      return stateById.has(c) ? null : `${c} is not a state of this run`;
    }
    if (c.startsWith("testcase:")) return `'${c}': test cases come after exploration; cite a source that quotes the open point, or the answered clarification row that asks it`;
    const why = citationProblem(c, citeCtx);
    if (why) return why;
    if (c.startsWith("clarification:")) {
      const row = c.slice("clarification:".length);
      return questions.some((q) => q.csv === row && q.kq.includes(p.id)) ? null : `'${c}' is answered but no question in new-questions.json links it to ${p.id} (its kq)`;
    }
    const file = citedFile(c, ctx);
    if (!file) return null;
    if (p.file && path.resolve(file) === path.resolve(path.join(ctx.productDir, "knowledge", p.file))) return `'${c}' is where the open point itself is written; cite what answers or dismisses it`;
    return quotesKq(readFileSync(file, "utf8"), p.text) ? null : `'${c}' does not quote the open point (three consecutive words of: ${p.text})`;
  };
  const kqLedger = createLedger({ reasons: ["dismissed"] });
  for (const p of points) {
    const item = kqLedger.addItem(p.id, { scope: p.scope, text: p.text, ...(p.category ? { category: p.category } : {}) });
    const o = overlay.kq[p.id];
    const asked = questions.filter((q) => q.kq.includes(p.id) && q.csv).map((q) => q.csv);
    const bad = (why) => kqLedger.resolve(p.id, { status: "pending", why });
    if (o?.status === "observed") {
      const refs = [];
      // an observation must quote the open point: a state whose stored snapshot, or a capture whose text, has three or
      // more consecutive words of it (D-052); a bare state id is not enough
      if (o.state) {
        const st = stateById.get(o.state);
        const snap = st && path.join(xp.dir, st.snapshot);
        if (!st) problems.push(`overlay.json kq.${p.id}: state ${o.state} is not a state of this run`);
        else if (!existsSync(snap) || !quotesKq(readFileSync(snap, "utf8"), p.text)) problems.push(`overlay.json kq.${p.id}: state ${o.state}'s snapshot does not quote the open point (three consecutive words of: ${p.text})`);
        else refs.push(o.state);
      }
      if (o.evidence) {
        const why = String(o.evidence).startsWith("observation:") ? kqCitationProblem(o.evidence, p) : `'${o.evidence}': evidence is observation:<path under the module>`;
        why ? problems.push(`overlay.json kq.${p.id}: ${why}`) : refs.push(o.evidence);
      }
      refs.length ? kqLedger.resolve(p.id, { status: "mapped", refs, outcome: "observed" }) : bad("observed needs a state id or observation: evidence");
    } else if (o?.status === "asked") {
      const csv = String(o.csv ?? "");
      rows.some((r) => r.id.trim() === csv) ? kqLedger.resolve(p.id, { status: "mapped", refs: [csv], outcome: "asked" }) : bad(`asked needs the CSV id of an appended question (got '${csv}')`);
    } else if (o?.status === "dismissed") {
      const why = o.citation ? kqCitationProblem(o.citation, p) : "dismissed needs a citation: a state id (ST-…), or a knowledge:, observation:, clarification:, spec: or testcase: source; a file must quote the open point";
      if (!(typeof o.reason === "string" && o.reason.trim())) bad("dismissed needs a reason");
      else if (why) {
        problems.push(`overlay.json kq.${p.id}: ${why}`);
        bad(`dismissed, but ${why}`);
      } else kqLedger.resolve(p.id, { status: "excluded", reason: "dismissed", detail: o.reason.trim(), refs: [o.citation], outcome: "dismissed" });
    } else if (o) bad(`status must be one of ${KQ_OUTCOMES.join(", ")}`);
    else if (asked.length) kqLedger.resolve(p.id, { status: "mapped", refs: sortedUniq(asked), outcome: "asked" });
    else Object.assign(item, { why: "not observed, asked or dismissed" });
  }

  // untried inputs: each needs a question (CSV id) or a reason
  // only a script-derived exclusion exempts an input; the agent's own exclusions still need a question or a reason
  for (const id of Object.keys(overlay.inputs)) if (!validId.has(id)) problems.push(`overlay.json inputs: '${id}' is not a frontier item of this run`);
  const inputLedger = createLedger({ reasons: ["explained"] });
  for (const it of frontier) {
    if (it.kind !== "input" || it.explored || it.status === "deferred" || (it.status === "excluded" && it.by === "script" && INPUT_EXEMPT.includes(it.reason))) continue;
    inputLedger.addItem(it.id, { state: it.state, role: it.role, name: it.name });
    const asked = questions.filter((q) => q.items.includes(it.id) && q.csv).map((q) => q.csv);
    const r = overlay.inputs[it.id]?.reason;
    if (asked.length) inputLedger.resolve(it.id, { status: "mapped", refs: sortedUniq(asked) });
    else if (typeof r === "string" && r.trim()) inputLedger.resolve(it.id, { status: "excluded", reason: "explained", detail: r.trim() });
    else inputLedger.resolve(it.id, { status: "pending", why: "not tried: link a question (new-questions.json item) or give a reason (overlay.json inputs)" });
  }

  return { budgets, prefixes, pages, states, transitions, frontier, inventory, niByKey, kq: kqLedger, inputs: inputLedger, questions, problems, warnings, itemById: itemByIdLookup };
}

// ---------- commands ----------

// Resolve a capture path the agent passed: it must be a file under explore/captures/ (never anywhere else, so the
// script can't be pointed at a credentials file).
export function capturePath(ctx, f) {
  if (!f) throw new Error("a capture file is required");
  const abs = path.isAbsolute(f) ? f : /^artifacts[\\/]/.test(f) ? path.join(ctx.root, f) : path.join(ctx.xp.dir, f);
  const r = path.relative(ctx.xp.captures, path.resolve(abs));
  if (r.startsWith("..") || path.isAbsolute(r)) throw new Error(`${f}: captures must be saved under ${rel(ctx.root, ctx.xp.captures)}/`);
  if (!existsSync(abs)) throw new Error(`${f}: no such file`);
  return path.resolve(abs);
}

const actionList = (v) => asList(v).map(String).filter((a) => a.trim());

// `state`: record one state. -> {state, new, page, slug, newPage, transition, frontierAdded[], open, budget, warnings} |
// {deferred: true, ...} when a budget is full
export function recordState(ctx, { snapshot, url, title, via, actions = [] }) {
  const { xp, cfg, runId } = ctx;
  const file = capturePath(ctx, snapshot);
  const text = readFileSync(file, "utf8");
  const parsed = parseSnapshot(text);
  const pageUrl = url ?? parsed.url;
  if (!pageUrl) throw new Error("--url is required (the snapshot has no 'Page URL' line)");
  let pg;
  try {
    pg = pageOf(pageUrl, primaryOriginOf(cfg));
  } catch {
    throw new Error(`--url '${pageUrl}' is not a valid URL`);
  }
  // the snapshot's own Page URL wins: a --url for another page would file the state under the wrong page
  if (url && parsed.url) {
    let own = null;
    try {
      own = pageOf(parsed.url, primaryOriginOf(cfg));
    } catch {}
    if (own && own.key !== pg.key) throw new Error(`--url '${url}' is page ${pg.template}, but the snapshot's Page URL is ${own.template}; leave --url out or pass the page the snapshot shows`);
  }
  if (!parsed.root.children.length) throw new Error(`${snapshot}: no accessibility snapshot lines found (save the browser's snapshot output as is)`);
  // identity: the page plus the shape (names outside dialogs as data slots); the full fingerprint is kept for the record
  const { fingerprint: fp, shape, slots } = fingerprint(parsed.root, { title: title ?? parsed.title });
  const key = `${pg.key} ${shape}`;
  const slotHashes = slots.map((x) => sha256Text(x).slice(0, 8)); // which positions vary, never the names themselves
  const acts = actionList(actions);
  const before = derive(ctx);
  if (via) {
    if (!before.states.some((s) => s.id === via)) throw new Error(`--via ${via} is not a state recorded in this run`);
    if (!acts.length) throw new Error("--via needs --action \"<role> \\\"<name>\\\"\" (or --item <FR id>) naming what you did");
  } else if (acts.length) throw new Error("--action needs --via <state id> (the state you acted in)");
  const events = readLog(xp).filter((e) => e.runId === runId);
  const known = events.some((e) => e.type === "state" && e.key === key);
  const pageKnown = events.some((e) => e.type === "state" && e.pageKey === pg.key);
  const budget = { states: { used: before.budgets.states, max: before.budgets.max_states }, pages: { used: before.budgets.pages, max: before.budgets.max_pages } };
  const over = !known && (before.budgets.states >= before.budgets.max_states ? `explore.max_states (${before.budgets.max_states})` : !pageKnown && before.budgets.pages >= before.budgets.max_pages ? `explore.max_pages (${before.budgets.max_pages})` : null);
  if (over) {
    appendLog(xp, { type: "deferred", runId, via: via ?? null, actions: acts, pageKey: pg.key, template: pg.template, url: pg.url, detail: `over ${over}` });
    const after = derive(ctx);
    const item = after.frontier.find((i) => i.status === "deferred" && i.detail === `over ${over}` && (via ? i.state === via : i.role === "goto"));
    return { deferred: true, reason: "budget", detail: `over ${over}: this new ${over.includes("pages") ? "page" : "state"} was not recorded`, item: item?.id ?? null, budget };
  }
  // ids first, so the snapshot copy can carry its state id
  const stKeys = uniq([...events.filter((e) => e.type === "state").map((e) => e.key), key]);
  const stReg = assignIds(xp.registry.states, stKeys, { module: ctx.module, runId, prefix: "ST", field: "states" });
  const firstPages = new Map();
  for (const e of events.filter((x) => x.type === "state")) if (!firstPages.has(e.pageKey)) firstPages.set(e.pageKey, e);
  if (!firstPages.has(pg.key)) firstPages.set(pg.key, { template: pg.template });
  const pgReg = assignPages(ctx, firstPages);
  const id = stReg.states[key].id;
  const slug = pgReg.pages[pg.key].slug;
  const snapRel = `pages/${slug}/states/${id}.md`;
  if (!known) {
    mkdirSync(path.join(xp.pages, slug, "states"), { recursive: true });
    copyFileSync(file, path.join(xp.dir, snapRel));
    if (!pageKnown) copyFileSync(file, path.join(xp.pages, slug, "dom-snapshot.md"));
  }
  appendLog(xp, { type: "state", runId, key, pageKey: pg.key, template: pg.template, fingerprint: fp, shape, slotHashes, url: pg.url, title: title ?? parsed.title ?? null, snapshot: snapRel, via: via ?? null, actions: acts });
  const after = derive(ctx);
  const t = via ? after.transitions.find((x) => x.from === via && x.to === id && x.actions.join("\n") === acts.join("\n")) : null;
  const added = known ? [] : after.frontier.filter((i) => i.state === id);
  return {
    state: id,
    new: !known,
    page: pgReg.pages[pg.key].id,
    slug,
    newPage: !pageKnown,
    transition: t ?? null,
    frontierAdded: added.map((i) => ({ id: i.id, role: i.role, name: i.name, status: i.status, ...(i.reason ? { reason: i.reason } : {}) })),
    open: after.frontier.filter((i) => i.status === "pending").length,
    budget: { states: { used: after.budgets.states, max: after.budgets.max_states }, pages: { used: after.budgets.pages, max: after.budgets.max_pages }, reached: after.budgets.reached },
    warnings: after.warnings.filter((w) => w.includes(`→ ${id}:`)),
  };
}

const RANK = { link: 0, goto: 0, tab: 1, menuitem: 2, menuitemcheckbox: 2, menuitemradio: 2, treeitem: 3, button: 3, action: 3, checkbox: 4, radio: 4, switch: 4, combobox: 5, listbox: 5, textbox: 6, searchbox: 6, spinbutton: 6, slider: 6 };

// `frontier`: the open items, in-module navigation first, then the state-changing controls, then inputs.
export function openFrontier(ctx, { limit = 40 } = {}) {
  const m = derive(ctx);
  const open = m.frontier.filter((i) => i.status === "pending").sort((a, b) => (RANK[a.role] ?? 9) - (RANK[b.role] ?? 9) || idNum(a.state) - idNum(b.state) || idNum(a.id) - idNum(b.id));
  const count = (s) => m.frontier.filter((i) => i.status === s).length;
  return {
    open: open.length,
    byStatus: { pending: count("pending"), explored: count("mapped"), excluded: count("excluded"), deferred: count("deferred") },
    budget: { states: { used: m.budgets.states, max: m.budgets.max_states }, pages: { used: m.budgets.pages, max: m.budgets.max_pages }, reached: m.budgets.reached },
    items: open.slice(0, limit).map((i) => ({ id: i.id, state: i.state, role: i.role, name: i.name, ...(i.target ? { target: i.target } : {}), action: `${i.role} ${JSON.stringify(i.name)}`, ...(i.containers ? { in: i.containers.join(" > ") } : {}) })),
    ...(open.length > limit ? { more: open.length - limit } : {}),
  };
}

// `ingest-network`: normalize a saved network capture into the inventory. The raw capture may hold values (query
// strings, bodies, cookies), so it is deleted after a successful ingest unless keep is set.
export function ingestNetwork(ctx, { file, state, keep = false }) {
  const { xp, runId, cfg } = ctx;
  const abs = capturePath(ctx, file);
  const { format, requests } = parseNetworkCapture(readFileSync(abs, "utf8"));
  const before = derive(ctx);
  const lastState = readLog(xp).filter((e) => e.runId === runId && e.type === "state").at(-1);
  const st = state ?? (lastState ? before.states.find((s) => s.key === lastState.key)?.id : null);
  if (state && !before.states.some((s) => s.id === state)) throw new Error(`--state ${state} is not a state recorded in this run`);
  const primary = primaryOriginOf(cfg);
  const dropped = {};
  const entries = [];
  for (const r of requests) {
    const n = normalizeRequest(r, primary);
    if (n.drop) dropped[n.drop] = (dropped[n.drop] ?? 0) + 1;
    else entries.push(n);
  }
  appendLog(xp, { type: "network", runId, state: st ?? null, format, entries });
  const m = derive(ctx);
  writeJson(xp.inventory, m.inventory);
  if (!keep) unlinkSync(abs);
  const ids = new Set(entries.map((e) => m.niByKey.get(e.key)));
  return {
    format,
    requests: requests.length,
    kept: entries.length,
    dropped,
    state: st ?? null,
    entries: m.inventory.filter((e) => ids.has(e.id)).map((e) => ({ id: e.id, method: e.method, pathTemplate: e.pathTemplate, ...(e.host ? { host: e.host } : {}) })),
    inventory: rel(ctx.root, xp.inventory),
    rawCapture: keep ? "kept" : "deleted",
  };
}

// ---------- build ----------

const liveEntities = (ctx) => (existsSync(ctx.ledgerFile) ? live(ctx.ledgerFile, ctx.runId).filter((e) => e.module === ctx.module && e.stage === "explore").map((e) => ({ type: e.type, ref: e.ref })) : []);

// Writes every script-owned file. -> {model, written[]}
export function build(ctx) {
  const { xp } = ctx;
  const m = derive(ctx);
  const linksOf = (pageId) => sortedUniq(m.frontier.filter((i) => i.page === pageId && i.role === "link" && i.target).map((i) => i.target));
  const sitemap = m.pages.map((p) => ({
    id: p.id, url: p.url, slug: p.slug, title: p.title ?? p.template, template: p.template, links: linksOf(p.id), states: p.states,
    domSnapshotPath: `pages/${p.slug}/dom-snapshot.md`, statesDir: `pages/${p.slug}/states/`,
  }));
  const interactions = m.frontier.filter((i) => CONTROL_ROLES.includes(i.role)).map((i) => {
    const c = i.control;
    return {
      id: i.id, state: i.state, page: m.states.find((s) => s.id === i.state)?.slug ?? null,
      element: `${i.role} ${JSON.stringify(i.name)}`, role: i.role, name: i.name, kind: KIND[i.role] ?? "other",
      ...(c.required ? { required: true } : {}), ...(c.options ? { options: c.options } : {}),
      ...(c.placeholder ? { placeholder: c.placeholder } : {}), ...(c.inputType ? { inputType: c.inputType } : {}),
      ...(c.maxlength ? { maxlength: c.maxlength } : {}), ...(c.pattern ? { pattern: c.pattern } : {}),
      ...(i.url ? { url: i.url } : {}),
      mutates: mutatesControl(c), tried: !!i.explored, status: i.status, ...(i.reason ? { reason: i.reason } : {}),
      ...(i.explored ? { observed: `leads to ${i.refs.join(", ")}` } : {}),
    };
  });
  const frontierLedger = m.frontier.map((i) => ({ id: i.id, state: i.state, role: i.role, name: i.name, status: i.status, ...(i.explored ? { refs: i.refs } : {}), ...(i.reason ? { reason: i.reason } : {}), ...(i.detail ? { detail: i.detail } : {}), ...(i.citation ? { citation: i.citation } : {}), ...(i.by ? { by: i.by } : {}) }));
  const sum = (items) => ({ total: items.length, mapped: items.filter((x) => x.status === "mapped").length, excluded: items.filter((x) => x.status === "excluded").length, pending: items.filter((x) => x.status === "pending").length, deferred: items.filter((x) => x.status === "deferred").length });
  const byReason = {};
  for (const i of m.frontier) if (i.reason) byReason[i.reason] = (byReason[i.reason] ?? 0) + 1;
  const model = {
    module: ctx.module, runId: ctx.runId, mode: ctx.mode,
    budgets: { max_states: m.budgets.max_states, max_pages: m.budgets.max_pages, states: m.budgets.states, pages: m.budgets.pages, reached: m.budgets.reached },
    prefixes: m.prefixes,
    pages: m.pages.map(({ key, ...p }) => p),
    states: m.states.map(({ key, pageKey, slug, ...s }) => ({ ...s, frontier: m.frontier.filter((i) => i.state === s.id).length })),
    transitions: m.transitions,
    frontier: m.frontier.map(({ ...i }) => i),
  };
  const coverage = {
    module: ctx.module, runId: ctx.runId, mode: ctx.mode, budgets: model.budgets,
    frontier: { summary: { ...sum(m.frontier), byReason }, items: frontierLedger },
    kq: { summary: m.kq.summary(), items: m.kq.items.map(({ why, ...x }) => x) },
    inputs: { summary: m.inputs.summary(), items: m.inputs.items.map(({ why, ...x }) => x) },
    questions: m.questions,
    liveEntities: liveEntities(ctx),
  };
  writeJson(xp.model, model);
  writeJson(xp.coverage, coverage);
  writeJson(xp.sitemap, sitemap);
  writeJson(xp.interactions, interactions);
  writeJson(xp.inventory, m.inventory);
  writeAtomic(xp.render, renderModel(model, coverage, m));
  return { m, model, coverage, written: [xp.model, xp.coverage, xp.sitemap, xp.interactions, xp.inventory, xp.render].map((f) => rel(ctx.root, f)) };
}

const cell = (s) => String(s ?? "").replace(/\r?\n+/g, " ").replace(/\|/g, "\\|");
function renderModel(model, cov, m) {
  const f = cov.frontier.summary;
  const list = (items, fmt) => (items.length ? items.map(fmt) : ["None."]);
  return [
    `# Exploration model -- ${model.module}`,
    "",
    "Rendered by `scripts/explore.mjs build` from model.json and coverage.json; never edit it.",
    "",
    `Run ${model.runId} (${model.mode}) · States ${model.budgets.states}/${model.budgets.max_states} · Pages ${model.budgets.pages}/${model.budgets.max_pages} · Transitions ${model.transitions.length}`,
    `Frontier: ${f.total} items · explored ${f.mapped} · excluded ${f.excluded} · deferred ${f.deferred} · open ${f.pending}`,
    `Knowledge open points: ${cov.kq.summary.total} · accounted ${cov.kq.summary.mapped + cov.kq.summary.excluded} · open ${cov.kq.summary.pending}`,
    `Untried inputs: ${cov.inputs.summary.total} · asked ${cov.inputs.summary.mapped} · explained ${cov.inputs.summary.excluded} · open ${cov.inputs.summary.pending}`,
    "",
    "## Pages",
    "| Id | Slug | Template | States |",
    "|---|---|---|---|",
    ...model.pages.map((p) => `| ${p.id} | ${p.slug} | ${cell(p.template)} | ${p.states.join(", ")} |`),
    "",
    "## States",
    "| Id | Page | Title | How to reach it |",
    "|---|---|---|---|",
    ...model.states.map((s) => `| ${s.id} | ${s.page} | ${cell(s.title)} | ${s.reach ? cell([`open ${s.reach.url}`, ...s.reach.steps].join(" → ")) : "unreached"} |`),
    "",
    "## Transitions",
    ...list(model.transitions, (t) => `- ${t.from} → ${t.to}: ${cell(t.actions.join(" then "))}`),
    "",
    "## Frontier: open",
    ...list(model.frontier.filter((i) => i.status === "pending"), (i) => `- ${i.id} (${i.state}): ${i.role} ${cell(JSON.stringify(i.name))}`),
    "",
    "## Frontier: deferred (over the budget)",
    ...list(model.frontier.filter((i) => i.status === "deferred"), (i) => `- ${i.id} (${i.state ?? "entry"}): ${i.role} ${cell(JSON.stringify(i.name))} -- ${cell(i.detail)}`),
    "",
    "## Frontier: excluded",
    ...list(Object.entries(f.byReason).filter(([r]) => r !== "budget"), ([r, n]) => `- ${r}: ${n}`),
    "",
    "## Knowledge open points",
    ...list(cov.kq.items, (k) => `- ${k.id} [${k.status}${k.outcome ? `: ${k.outcome}` : ""}] ${cell(k.text)}${k.refs ? ` -- ${k.refs.join(", ")}` : k.detail ? ` -- ${cell(k.detail)}` : ""}`),
    "",
    "## Untried inputs",
    ...list(cov.inputs.items, (i) => `- ${i.id} ${i.role} ${cell(JSON.stringify(i.name))} [${i.status}]${i.refs ? ` -- ${i.refs.join(", ")}` : i.detail ? ` -- ${cell(i.detail)}` : ""}`),
    "",
    "## Questions",
    ...list(cov.questions, (q) => `- ${q.csv ?? "NOT APPENDED"}: ${cell(q.question)}`),
    "",
    "## Entities created by explore and still live",
    ...list(cov.liveEntities, (e) => `- ${e.type} ${cell(e.ref)}`),
    ...(m.warnings.length ? ["", "## Warnings", ...m.warnings.map((w) => `- ${cell(w)}`)] : []),
    "",
  ].join("\n");
}

// ---------- check and the verified stamp ----------

const FLOW_STATE_RE = (module) => new RegExp(`\\bST-${module.replace(/[-]/g, "\\-")}-\\d+\\b`, "g");
const flowFiles = (xp) => (existsSync(xp.flows) ? readdirSync(xp.flows).filter((f) => f.endsWith(".md")).sort() : []);
const flowsDigest = (xp) => sha256Text(flowFiles(xp).map((f) => `${f}\n${readFileSync(path.join(xp.flows, f), "utf8")}`).join("\n\u0000"));

function stampInputs(ctx) {
  const { xp, kp, module } = ctx;
  return {
    model: xp.model, sitemap: xp.sitemap, interactions: xp.interactions, inventory: xp.inventory,
    overlay: xp.overlay, questions: xp.questions, summary: xp.summary,
    log: xp.log, registryStates: xp.registry.states, registryPages: xp.registry.pages, registryFrontier: xp.registry.frontier, registryNetwork: xp.registry.network,
    kqModule: kp.module(module).openPoints, kqProduct: kp.openPoints,
  };
}
// The CSV rows the audit relies on (the questions' and KQs' ids with their question text). Later answers and notes from
// the clarification domain don't touch it, so they never make the exploration stale; a removed or reworded row does.
function csvDigest(ctx) {
  const cov = readJson(ctx.xp.coverage, {});
  const ids = new Set([...(cov.questions ?? []).map((q) => q.csv), ...(cov.kq?.items ?? []).flatMap((k) => (k.outcome === "asked" ? k.refs ?? [] : [])), ...(cov.inputs?.items ?? []).flatMap((i) => (i.status === "mapped" ? i.refs ?? [] : []))].filter(Boolean));
  const rows = readRows(csvPath(ctx.productDir, ctx.module)).filter((r) => ids.has(r.id.trim())).map((r) => `${r.id.trim()} ${normQuestion(r.question)}`).sort();
  return sha256Text(JSON.stringify([[...ids].sort(), rows]));
}

// `check`: build, then every rule. A passing check stamps coverage.json. validateData: contract.mjs's (async).
// -> {valid, problems, warnings, summary}
export async function runCheck(ctx, validateData) {
  const { xp, module } = ctx;
  const { m, model, coverage } = build(ctx);
  const problems = [...m.problems];
  if (!m.states.length) problems.push("no state recorded in this run (record the module's entry page with `explore.mjs state`; if a login wall stopped you, report blocked)");
  for (const [file, schema] of [[xp.model, "explore-model"], [xp.coverage, "explore-coverage"], [xp.sitemap, "sitemap"], [xp.interactions, "interactions"], [xp.inventory, "network-inventory"]])
    for (const e of await validateData(schema, readJson(file))) problems.push(`${path.basename(file)}: ${e}`);
  if (existsSync(xp.overlay)) {
    try {
      for (const e of await validateData("explore-overlay", readJson(xp.overlay))) problems.push(`overlay.json: ${e}`);
    } catch (e) {
      problems.push(`overlay.json: not valid JSON (${e.message})`);
    }
  }
  if (existsSync(xp.questions)) {
    const q = (() => {
      try {
        return readJson(xp.questions);
      } catch {
        return null;
      }
    })();
    if (!Array.isArray(q) || q.some((x) => !x || typeof x.question !== "string" || !x.question.trim() || typeof x.steps !== "string" || !x.steps.trim()))
      problems.push("new-questions.json: must be a list of {question, steps, kq?, item?} with a non-empty question and steps");
  }
  for (const i of m.frontier.filter((x) => x.status === "pending")) problems.push(`frontier ${i.id} (${i.state}): ${i.role} ${JSON.stringify(i.name)} is open -- explore it (state --via) or exclude it in overlay.json items`);
  for (const k of m.kq.items.filter((x) => x.status === "pending")) problems.push(`${k.id}: ${k.why ?? "not accounted for"} -- observe, ask or dismiss it (overlay.json kq, or a question's kq)`);
  for (const i of m.inputs.items.filter((x) => x.status === "pending")) problems.push(`input ${i.id} (${i.state}): ${i.role} ${JSON.stringify(i.name)} was not tried -- link a question (item) or give a reason (overlay.json inputs)`);
  for (const p of m.pages) {
    if (!existsSync(path.join(xp.pages, p.slug, "dom-snapshot.md"))) problems.push(`page ${p.id} (${p.slug}): pages/${p.slug}/dom-snapshot.md is missing`);
    for (const s of p.states) {
      const st = m.states.find((x) => x.id === s);
      if (!existsSync(path.join(xp.dir, st.snapshot))) problems.push(`page ${p.id}: ${st.snapshot} is missing`);
    }
  }
  for (const q of m.questions.filter((x) => !x.csv)) problems.push(`new-questions.json: '${q.question}' is not in clarifications.csv -- run clarifications.mjs append`);
  const active = new Set(m.states.map((s) => s.id));
  for (const f of flowFiles(xp)) {
    const named = uniq([...readFileSync(path.join(xp.flows, f), "utf8").matchAll(FLOW_STATE_RE(module))].map((x) => x[0]));
    if (!named.length) problems.push(`flows/${f}: names no state id (ST-${module}-<n>) it passes through`);
    for (const s of named) if (!active.has(s)) problems.push(`flows/${f}: ${s} is not a state of this run`);
  }
  if (!existsSync(xp.summary)) problems.push("module-summary.md: missing");
  // Entities this run created while exploring and never deleted are reported, not a failure: D-005 limits deletes to the
  // run's own entities but does not require them, and the ledger keeps them traceable for cleanup.
  const warnings = [...m.warnings, ...coverage.liveEntities.map((e) => `live entity left by explore: ${e.type} ${e.ref} (in state/ledger.jsonl)`)];
  if (!problems.length) {
    withFileLock(xp.coverage, () => {
      const data = readJson(xp.coverage);
      data.verified = { ...stampVerified(stampInputs(ctx)), flows: flowsDigest(xp), clarifications: csvDigest(ctx) };
      writeJson(xp.coverage, data);
    });
  }
  return {
    valid: !problems.length,
    problems,
    warnings,
    summary: {
      states: model.budgets.states, pages: model.budgets.pages, transitions: model.transitions.length,
      budgets: { max_states: model.budgets.max_states, max_pages: model.budgets.max_pages, reached: model.budgets.reached },
      frontier: coverage.frontier.summary, kq: coverage.kq.summary, inputs: coverage.inputs.summary,
      questions: { total: m.questions.length, appended: m.questions.filter((q) => q.csv).length },
      network: m.inventory.length, liveEntities: coverage.liveEntities.length,
    },
    // never silent: what the script closed as outside the module, and the prefixes it judged by (overlay scope.prefixes adds more)
    prefixes: m.prefixes,
    outOfModule: m.frontier.filter((i) => i.reason === "out-of-module" && i.by === "script").map((i) => ({ id: i.id, state: i.state, role: i.role, name: i.name, target: i.target ?? null })),
  };
}

// The explore stage's done (contract.mjs CHECKS): a current verified stamp. -> problems[]
export function stageProblems(ctx) {
  const stamp = readJson(ctx.xp.coverage, {})?.verified;
  const unstamped = "the exploration did not pass `explore.mjs check` (no verified stamp)";
  if (!stamp) return [unstamped];
  const { flows, clarifications, ...files } = stamp;
  const why = unverifiedReason(files, stampInputs(ctx), { unstamped });
  if (why) return [why === unstamped ? why : `the exploration ${why} (run explore.mjs check again)`];
  if (flows !== flowsDigest(ctx.xp)) return ["the flows changed after `explore.mjs check` (run check again)"];
  return clarifications === csvDigest(ctx) ? [] : ["the clarifications.csv rows the exploration's questions rely on changed after `explore.mjs check` (run check again)"];
}

export { sha256 };
