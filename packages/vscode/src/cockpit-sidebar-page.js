// the Cockpit's page (D-110): the ATF sidebar's first view, one scrolling page with this machine's environment
// checks, the products, and the New product form that drafts a run-config with no agent. Pure; no vscode import.
//
// Hygiene, as the sheets' page (src/sheets/webview.js, whose CSP and helpers it reuses):
// - CSP default-src 'none', one inline <style> and <script> with a fresh nonce, nothing remote, no forms posted;
// - the page holds no data: the extension sends a "state" message, and every value goes into the DOM as text, never as
//   HTML;
// - the page is untrusted input: validatePanelMessage accepts only the known messages with bounded fields, and the
//   extension checks each target again (a product it lists, a Node.js it offered) before acting on it.
import { COCKPIT_CSS, cockpitKit } from "./cockpit-style.js";
import { csp, escapeHtml } from "./sheets/webview.js";

// The run-config's steps and test case types (packages/core/scripts/lib/contract.mjs STEPS, CASE_TYPES; the cockpit
// test keeps them equal), with the words the form shows.
export const STEPS = ["explore", "clarifications", "testcases", "playwright-ui", "playwright-api", "k6"];
export const STEP_LABELS = { explore: "Explore", clarifications: "Clarifications", testcases: "Test cases", "playwright-ui": "Playwright UI", "playwright-api": "Playwright API", k6: "k6 load tests" };
export const CASE_TYPES = ["ui", "api", "performance"];
export const AUTOMATION = { ui: "playwright-ui", api: "playwright-api", performance: "k6" };
// The pipeline's stages (packages/core/scripts/lib/contract.mjs STAGES, in order; the test keeps them equal), and the
// cockpit messages' fixed lists (docs/cockpit-plan.md C2).
export const STAGES = ["knowledge", "module-knowledge", "explore", "clarifications", "api-discovery", "testcases", "playwright-repo", "playwright-ui", "playwright-api", "k6", "report"];
export const INTENTS = ["explore", "testcases", "automate", "k6", "heal"];
export const SHEETS = ["clarifications", "approval"];
export const TABS = ["timeline", "trace", "failures", "safety"];

// The state a pipeline row shows: a copy of src/runs.js stageState, embedded in the page by source (the page has no
// imports). The page test compares the two over the same rows, so change them together.
export function stageStateCopy(row) {
  if (row.notChosen || row.status === "not-chosen") return "not-chosen";
  if (row.status === "running") return "running";
  if (row.complete) return "done";
  if (row.awaitingApproval || row.status === "awaiting-approval") return "awaiting-approval";
  if (row.status === "failed") return "failed";
  if (row.blocked) return "blocked";
  if (row.status === "done") return "unverified";
  return "pending";
}

export const PANEL_LIMITS = { text: 4000, line: 1000, lines: 200, path: 1000 };
// What the page may ask the extension to run, by VS Code command (the workspace states' buttons).
export const PANEL_COMMANDS = ["atf.createProject", "atf.openProject", "atf.installFramework", "atf.refresh", "atf.connect"];
export const FILE_FIELDS = ["references", "api", "credentialsFile", "testcasesImport"];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isObj = (m) => !!m && typeof m === "object" && !Array.isArray(m);
const only = (m, keys) => Object.keys(m).every((k) => keys.includes(k));
const str = (v, max = PANEL_LIMITS.line) => typeof v === "string" && v.length <= max;
const slug = (v) => typeof v === "string" && SLUG_RE.test(v);

// The New product form as the page sends it.
const FORM_FIELDS = { name: PANEL_LIMITS.line, visibility: 16, url: PANEL_LIMITS.line, description: PANEL_LIMITS.text, overviewUrl: PANEL_LIMITS.line, modules: PANEL_LIMITS.text, references: PANEL_LIMITS.text, api: PANEL_LIMITS.text, credentialsFile: PANEL_LIMITS.path, testcasesImport: PANEL_LIMITS.path };
function formOk(f) {
  if (!isObj(f) || !only(f, [...Object.keys(FORM_FIELDS), "loginNeeded", "steps", "testcasesTypes"])) return false;
  for (const [k, max] of Object.entries(FORM_FIELDS)) if (f[k] !== undefined && !str(f[k], max)) return false;
  if (f.loginNeeded !== undefined && typeof f.loginNeeded !== "boolean") return false;
  for (const [k, allowed] of [["steps", STEPS], ["testcasesTypes", CASE_TYPES]])
    if (f[k] !== undefined && !(Array.isArray(f[k]) && f[k].every((x) => allowed.includes(x)) && new Set(f[k]).size === f[k].length)) return false;
  return true;
}

// -> { ok: true, message } | { ok: false, error }
export function validatePanelMessage(m) {
  if (!isObj(m) || typeof m.type !== "string") return { ok: false, error: "a message is an object with a type" };
  const bad = (why) => ({ ok: false, error: `${m.type}: ${why}` });
  const target = () => (only(m, ["type", "product", "environment"]) && slug(m.product) && slug(m.environment) ? { ok: true, message: { type: m.type, product: m.product, environment: m.environment } } : bad("needs a product and an environment (slugs)"));
  switch (m.type) {
    case "ready":
    case "check":
    case "fix":
    case "unpinNode":
    case "interview":
    case "openOutput":
    case "newForm":
      return only(m, ["type"]) ? { ok: true, message: { type: m.type } } : bad("takes no fields");
    case "useNode":
      return only(m, ["type", "path"]) && str(m.path, PANEL_LIMITS.path) && m.path ? { ok: true, message: { type: m.type, path: m.path } } : bad("needs the path of an offered Node.js");
    case "run":
    case "doctor":
    case "openConfig":
      return target();
    case "login":
      return only(m, ["type", "product"]) && slug(m.product) ? { ok: true, message: { type: m.type, product: m.product } } : bad("needs a product (a slug)");
    case "select":
      return target();
    case "intent":
      return only(m, ["type", "product", "environment", "module", "intent"]) && slug(m.product) && slug(m.environment) && slug(m.module) && INTENTS.includes(m.intent)
        ? { ok: true, message: { type: m.type, product: m.product, environment: m.environment, module: m.module, intent: m.intent } }
        : bad(`needs a product, environment and module (slugs) and an intent: ${INTENTS.join(", ")}`);
    case "resume":
      return only(m, ["type", "product", "environment", "stage", "module"]) && slug(m.product) && slug(m.environment) && STAGES.includes(m.stage) && (m.module === undefined || m.module === null || slug(m.module))
        ? { ok: true, message: { type: m.type, product: m.product, environment: m.environment, stage: m.stage, module: m.module ?? null } }
        : bad(`needs a product and environment (slugs), a stage (${STAGES.join(", ")}) and a module (a slug, or null)`);
    case "openSheet":
      return only(m, ["type", "product", "module", "sheet"]) && slug(m.product) && slug(m.module) && SHEETS.includes(m.sheet)
        ? { ok: true, message: { type: m.type, product: m.product, module: m.module, sheet: m.sheet } }
        : bad(`needs a product and module (slugs) and a sheet: ${SHEETS.join(", ")}`);
    case "openTab": {
      const f = m.focus;
      const focusOk = f === undefined || (isObj(f) && only(f, ["stage", "module"]) && (f.stage === undefined || STAGES.includes(f.stage)) && (f.module === undefined || f.module === null || slug(f.module)));
      if (!(only(m, ["type", "product", "environment", "tab", "focus"]) && slug(m.product) && slug(m.environment) && TABS.includes(m.tab) && focusOk))
        return bad(`needs a product and environment (slugs), a tab (${TABS.join(", ")}) and optionally a focus {stage, module}`);
      return { ok: true, message: { type: m.type, product: m.product, environment: m.environment, tab: m.tab, ...(f === undefined ? {} : { focus: { ...f } }) } };
    }
    case "sweep":
      return target();
    case "command":
      return only(m, ["type", "id"]) && PANEL_COMMANDS.includes(m.id) ? { ok: true, message: { type: m.type, id: m.id } } : bad(`id is one of ${PANEL_COMMANDS.join(", ")}`);
    case "pickFiles":
      return only(m, ["type", "field"]) && FILE_FIELDS.includes(m.field) ? { ok: true, message: { type: m.type, field: m.field } } : bad(`field is one of ${FILE_FIELDS.join(", ")}`);
    case "draft":
      return only(m, ["type", "form"]) && formOk(m.form) ? { ok: true, message: { type: m.type, form: { ...m.form } } } : bad("needs the form's fields, each a bounded string (steps and types from their lists)");
    default:
      return bad("unknown message");
  }
}

const lines = (text) => String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, PANEL_LIMITS.lines);

// The form as the run-config draft's answers (scripts/lib/run-config-draft.mjs buildDraft: config/interview-answers.json
// is the same object). Only what the human filled in; the script checks and reports everything else.
// Modules: one per line, `Name` or `Name | https://its.url`. -> { answers, problems: [] }
export function formAnswers(f) {
  const problems = [];
  const name = String(f.name ?? "").trim();
  const url = String(f.url ?? "").trim();
  if (!name) problems.push("Give the product's name.");
  if (!/^https?:\/\/\S+$/i.test(url)) problems.push("Give the URL to test (http or https).");
  const visibility = f.visibility === "internal" ? "internal" : "public";
  const modules = lines(f.modules).map((l) => {
    const [mName, mUrl] = l.split("|").map((x) => x.trim());
    return mUrl ? { name: mName, url: mUrl } : mName;
  });
  if (!modules.length) problems.push("Name at least one module to test (one per line).");
  const steps = Array.isArray(f.steps) ? STEPS.filter((s) => f.steps.includes(s)) : STEPS;
  if (!steps.length) problems.push("Choose at least one step.");
  const answers = { name, visibility, url };
  const put = (k, v) => {
    if (Array.isArray(v) ? v.length : v) answers[k] = v;
  };
  put("description", String(f.description ?? "").trim());
  put("overview_url", String(f.overviewUrl ?? "").trim());
  answers.modules = modules;
  put("references", lines(f.references));
  put("api", lines(f.api));
  if (f.loginNeeded) answers.login = { needed: true, ...(String(f.credentialsFile ?? "").trim() ? { credentials_file: f.credentialsFile.trim() } : {}) };
  if (steps.length !== STEPS.length) answers.steps = steps;
  // test case types are asked only when test cases run without the automation step that implies them
  const types = (f.testcasesTypes ?? []).filter((t) => !steps.includes(AUTOMATION[t]));
  if (steps.includes("testcases") && types.length) answers.testcases_types = types;
  put("testcases_import", String(f.testcasesImport ?? "").trim());
  return { answers, problems };
}

const STYLE = `
details{border-bottom:1px solid var(--vscode-panel-border);padding:6px 0}
summary{cursor:pointer;font-weight:600;text-transform:uppercase;font-size:.85em;letter-spacing:.04em;padding:4px 0;display:flex;align-items:center;gap:6px}
summary .count{font-weight:400;text-transform:none;opacity:.8}
input,textarea,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);box-sizing:border-box;width:100%;padding:3px 5px}
textarea{min-height:3.5em;resize:vertical}
input[type=checkbox],input[type=radio]{width:auto;margin:0 4px 0 0}
label{display:block;margin:8px 0 2px}
.inline{display:inline-flex;align-items:center;margin:2px 10px 2px 0}
.hint{opacity:.75;font-size:.92em;margin:2px 0}
.check{display:flex;gap:6px;padding:3px 0;align-items:flex-start}
.icon{width:1.2em;flex:none;text-align:center}
.ok .icon{color:var(--vscode-testing-iconPassed,#3fb950)}
.warn .icon{color:var(--vscode-editorWarning-foreground)}
.fail .icon{color:var(--vscode-editorError-foreground)}
.fixtext{opacity:.8;font-size:.92em}
.product{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:5px 0;border-top:1px solid var(--vscode-panel-border)}
.product .name{font-weight:600;flex:1 1 auto}
.banner{padding:6px 8px;margin:6px 0;border-left:3px solid var(--vscode-focusBorder);background:var(--vscode-textBlockQuote-background)}
.banner.error{border-left-color:var(--vscode-editorError-foreground)}
.banner.warning{border-left-color:var(--vscode-editorWarning-foreground)}
ul{margin:4px 0;padding-left:18px}
.hdr{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:8px 0 4px}
.hdr select{flex:1 1 8em;width:auto;min-width:0}
.modrow{display:flex;flex-wrap:wrap;align-items:center;gap:2px;padding:2px 0}
.modrow .modname{flex:0 0 7em;font-weight:600;overflow-wrap:anywhere}
button.stagecell{background:none;color:inherit;margin:0;padding:2px 4px}
button.stagecell:hover{background:var(--vscode-list-hoverBackground)}
.card .acts{margin-top:4px}
.card .ids{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
.card .line{display:flex;gap:6px;align-items:flex-start}
`;

export function renderCockpitHtml({ nonce }) {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(String(nonce))) throw new Error("a nonce of at least 16 base64 characters is required");
  // esbuild's keepNames wraps functions in __name(); the shim keeps the embedded script independent of the bundle.
  const script = `var __name=function(t){return t};(${cockpitClient.toString()})(${JSON.stringify({ STEPS, STEP_LABELS, CASE_TYPES, AUTOMATION })},(${cockpitKit.toString()})(),${stageStateCopy.toString()});`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml("atf")}</title>
<style nonce="${nonce}">${COCKPIT_CSS}${STYLE}</style>
</head>
<body>
<div id="app"><p class="muted">Loading…</p></div>
<script nonce="${nonce}">${script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The page's script. Runs in the webview, not in the extension: browser globals only. It renders the extension's
// "state" and sends the human's clicks; the form's own values stay here (and in the webview's saved state) until sent.
export function cockpitClient(K, kit, stageState) {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const saved = vscode.getState() || {};
  let state = null;
  let form = saved.form || { visibility: "public", steps: K.STEPS.slice(), testcasesTypes: ["ui"], loginNeeded: false };
  const open = saved.open || { products: true, form: false };
  let intentModule = null;
  const keep = () => vscode.setState({ form, open });
  const post = (m) => vscode.postMessage(m);

  const { el, btn, glyph, idChip, modeBadge, rail, empty } = kit;
  // DOM append() would write null as "null": flatten, skip the empty, wrap strings
  function add(n, ...kids) {
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) n.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
    return n;
  }
  const ICON = { ok: "✓", warn: "!", fail: "✗", info: "…" };

  function section(key, title, count, body) {
    const d = el("details", { open: !!open[key] }, el("summary", {}, title, count ? el("span", { class: "count", text: count }) : null), body);
    d.addEventListener("toggle", () => {
      open[key] = d.open;
      keep();
    });
    return d;
  }

  // ---- workspace states without a ready project ----
  function workspaceBlock(ws) {
    const buttons = {
      noFolder: [["Create new project…", "atf.createProject"], ["Open existing project…", "atf.openProject", "secondary"]],
      noWorkspace: [["Create new project…", "atf.createProject"], ["Open existing project…", "atf.openProject", "secondary"]],
      noFramework: [["Install the framework", "atf.installFramework"], ["Refresh", "atf.refresh", "secondary"]],
      badMarker: [["Refresh", "atf.refresh"]],
    }[ws.state] || [];
    return el("div", { class: "banner warning" }, el("div", { text: ws.message || "No atf project is open." }), el("div", {}, buttons.map(([t, id, c]) => btn(t, () => post({ type: "command", id }), c))));
  }

  // ---- the cockpit (C1 data in state.cockpit; absent on an older host) ----
  const INTENT_LABELS = { explore: "Explore", testcases: "Write test cases", automate: "Automate", k6: "Load test", heal: "Heal" };
  const NEEDS_ACTION = { clarifications: "Answer", approval: "Review", blocked: "Resume", failed: "Resume", leftovers: "Clean up", guard: "Open Safety", unverified: null };
  const titleOf = (t) => el("div", { class: "section-title", text: t });
  const keyOf = (p) => `${p.product}|${p.environment}`;
  const label = (p) => (p.environment === "default" ? p.product : `${p.product} (${p.environment})`);

  function headerBlock(c) {
    const sel = c.selected;
    const data = c.data;
    const run = data && data.run;
    const kids = [];
    const products = state.products || [];
    if (products.length) {
      const select = el("select", { aria: { label: "Product" }, on: { change: (e) => { const [product, environment] = String(e.target.value).split("|"); post({ type: "select", product, environment }); } } }, products.map((p) => el("option", { value: keyOf(p), text: label(p) })));
      if (sel) select.value = keyOf(sel);
      kids.push(select);
    } else if (sel) kids.push(el("strong", { text: label(sel) }));
    if (run) kids.push(modeBadge(run.mode), idChip(run.runId), run.active ? null : el("span", { class: "muted", text: "ended" }));
    const out = [el("div", { class: "hdr" }, kids)];
    if (c.loading) out.push(el("div", { class: "hint", text: "Loading the run…" }));
    if (c.error) out.push(el("div", { class: "banner error", text: c.error }));
    if (sel && data && !run) out.push(el("div", { class: "card" }, el("div", { text: "No run yet" }), el("div", { class: "acts" }, btn("▷ Start run", () => post({ type: "run", product: sel.product, environment: sel.environment })))));
    return out;
  }

  function needsCard(n, sel) {
    const act = {
      clarifications: () => post({ type: "openSheet", product: sel.product, module: n.module, sheet: "clarifications" }),
      approval: () => post({ type: "openSheet", product: sel.product, module: n.module, sheet: "approval" }),
      blocked: () => post({ type: "resume", product: sel.product, environment: sel.environment, stage: n.stage, module: n.module || null }),
      failed: () => post({ type: "resume", product: sel.product, environment: sel.environment, stage: n.stage, module: n.module || null }),
      leftovers: () => post({ type: "sweep", product: sel.product, environment: sel.environment }),
      guard: () => post({ type: "openTab", product: sel.product, environment: sel.environment, tab: "safety" }),
    }[n.kind];
    const needsStage = n.kind === "blocked" || n.kind === "failed";
    const needsModule = n.kind === "clarifications" || n.kind === "approval";
    const usable = act && (!needsStage || n.stage) && (!needsModule || n.module);
    const state = n.kind === "failed" ? "failed" : n.kind === "blocked" ? "blocked" : n.kind === "unverified" ? "unverified" : n.kind === "approval" ? "awaiting-approval" : "pending";
    return el("div", { class: "card needs", dataset: { kind: n.kind } },
      el("div", { class: "line" }, glyph(state), el("div", {}, el("div", { text: n.text }), n.module ? el("div", { class: "muted", text: n.stage ? `${n.module} · ${n.stage}` : n.module }) : null)),
      n.ids && n.ids.length ? el("div", { class: "ids" }, n.ids.map(idChip), n.count > n.ids.length ? el("span", { class: "muted", text: `+${n.count - n.ids.length} more` }) : null) : null,
      usable && NEEDS_ACTION[n.kind] ? el("div", { class: "acts" }, btn(NEEDS_ACTION[n.kind], act, "secondary")) : null);
  }

  function pipelineBlock(sel, ov) {
    const rows = ov.stages || [];
    const focusTab = (focus) => () => post({ type: "openTab", product: sel.product, environment: sel.environment, tab: "timeline", focus });
    const productRows = rows.filter((r) => !r.module);
    const modules = [];
    for (const r of rows) if (r.module && modules.indexOf(r.module) < 0) modules.push(r.module);
    const out = [titleOf("Pipeline")];
    if (!rows.length) return [...out, empty("No stages yet.")];
    if (productRows.length) out.push(rail(productRows.map((r) => ({ label: r.stage, state: stageState(r), onClick: focusTab({ stage: r.stage }) }))));
    for (const m of modules)
      out.push(el("div", { class: "modrow", dataset: { module: m } }, el("span", { class: "modname", text: m }),
        rows.filter((r) => r.module === m).map((r) => {
          const st = stageState(r);
          return el("button", { class: "stagecell", title: `${r.stage}: ${st}`, aria: { label: `${m} ${r.stage}: ${st}` }, dataset: { stage: r.stage }, on: { click: focusTab({ stage: r.stage, module: m }) } }, glyph(st));
        })));
    return out;
  }

  function intentsBlock(sel, ov) {
    const intents = ov.intents || {};
    const mods = Object.keys(intents);
    const out = [titleOf("Intents")];
    if (!mods.length) return [...out, empty("No modules in this run.")];
    if (mods.indexOf(intentModule) < 0) intentModule = mods[0];
    const select = el("select", { aria: { label: "Module" }, on: { change: (e) => { intentModule = e.target.value; render(); } } }, mods.map((m) => el("option", { value: m, text: m })));
    select.value = intentModule;
    const cur = intents[intentModule] || {};
    out.push(select, el("div", { class: "toolbar" }, ["explore", "testcases", "automate", "k6", "heal"].map((k) => {
      const i = cur[k] || { enabled: false, why: "Not available for this module." };
      return btn(INTENT_LABELS[k], () => post({ type: "intent", product: sel.product, environment: sel.environment, module: intentModule, intent: k }), i.enabled ? "" : "secondary", { disabled: !i.enabled, title: i.enabled ? (k === "heal" && i.stage ? `Heal ${i.stage}` : INTENT_LABELS[k]) : i.why || "Not available right now.", dataset: { intent: k } });
    })));
    return out;
  }

  function tabsBlock(sel) {
    const names = { timeline: "Timeline", trace: "Traceability", failures: "Failures & bug drafts", safety: "Safety & ledger" };
    return [titleOf("Open the cockpit"), el("div", { class: "toolbar" }, ["timeline", "trace", "failures", "safety"].map((t) => btn(names[t], () => post({ type: "openTab", product: sel.product, environment: sel.environment, tab: t }), "link", { dataset: { tab: t } })))];
  }

  function cockpitBlocks(c) {
    const out = headerBlock(c);
    const sel = c.selected;
    const ov = c.data && c.data.overview;
    if (!sel || !c.data || !c.data.run || !ov) return out;
    if ((ov.needsYou || []).length) out.push(titleOf("Needs you"), (ov.needsYou || []).map((n) => needsCard(n, sel)));
    out.push(pipelineBlock(sel, ov), intentsBlock(sel, ov), tabsBlock(sel));
    return out;
  }

  // ---- environment ----
  function envSection(env) {
    const rows = env.rows || [];
    const fails = rows.filter((r) => r.status === "fail").length;
    const warns = rows.filter((r) => r.status === "warn").length;
    const count = env.status === "checking" ? "checking…" : env.status === "error" ? "couldn't check" : fails ? `${fails} to fix` : warns ? `ready, ${warns} warning${warns === 1 ? "" : "s"}` : rows.length ? "ready" : "";
    const body = el("div", {});
    if (env.error) add(body, el("div", { class: "banner error", text: env.error }));
    for (const r of rows) {
      const line = el("div", { class: `check ${r.status}` }, el("span", { class: "icon", text: ICON[r.status] || "·" }), el("div", {}, el("div", { text: r.detail }), r.fix && r.status !== "ok" ? el("div", { class: "fixtext", text: `Fix: ${r.fix}` }) : null));
      add(body, line);
      if (r.id === "session-node" && r.choices) {
        const choices = el("div", { class: "hint" });
        for (const c of r.choices) add(choices, btn(`Use Node ${c.version} (${c.source})`, () => post({ type: "useNode", path: c.path }), "secondary", { title: c.path }));
        if (r.pinned) add(choices, btn("Unpin", () => post({ type: "unpinNode" }), "link"));
        if (!r.choices.length && !r.ok) add(choices, el("span", { text: "No Node.js 20 or later found: install one from nodejs.org (or nvm install 24), then Check again." }));
        add(body, choices);
      }
    }
    const fixable = rows.some((r) => r.canFix && r.status === "fail");
    add(body, el("div", {}, btn(env.status === "checking" ? "Checking…" : "Check again", () => post({ type: "check" }), "secondary", { disabled: env.status === "checking" }), fixable ? btn("Fix what atf can install", () => post({ type: "fix" }), "", { disabled: env.status === "checking" }) : null));
    if (env.at) add(body, el("div", { class: "hint", text: `Checked ${env.at}` }));
    return section("env", "Environment", count, body);
  }

  // ---- products ----
  function productsSection(products) {
    const body = el("div", {});
    if (!products.length) add(body, el("div", { class: "hint", text: "No products yet. A product is what you test: its run-config says what, and where." }));
    for (const p of products)
      add(body, 
        el("div", { class: "product" },
          el("span", { class: "name", text: p.environment === "default" ? p.product : `${p.product} (${p.environment})` }),
          el("span", { class: "muted", text: p.status }),
          el("div", {}, btn("▷ Run", () => post({ type: "run", product: p.product, environment: p.environment }), "", { title: p.active ? "Continue the active run" : "Start a run" }), btn("Doctor", () => post({ type: "doctor", product: p.product, environment: p.environment }), "secondary"), p.config ? btn("Config", () => post({ type: "openConfig", product: p.product, environment: p.environment }), "secondary") : null)));
    add(body, el("div", {}, btn("+ New product", () => post({ type: "newForm" }), "secondary")));
    return section("products", "Products", products.length ? String(products.length) : "", body);
  }

  // ---- New product ----
  const set = (k, v) => {
    form[k] = v;
    keep();
  };
  function field(label, key, opts) {
    const o = opts || {};
    const input = o.multi
      ? el("textarea", { value: form[key] || "", placeholder: o.placeholder || "", rows: o.rows || 3, on: { input: (e) => set(key, e.target.value) } })
      : el("input", { type: "text", value: form[key] || "", placeholder: o.placeholder || "", on: { input: (e) => set(key, e.target.value) } });
    return el("div", {}, el("label", { text: label }), input, o.files ? btn(o.files, () => post({ type: "pickFiles", field: key }), "link") : null, o.hint ? el("div", { class: "hint", text: o.hint }) : null);
  }
  function formSection(fs) {
    const body = el("div", {});
    if (fs.result) {
      const r = fs.result;
      add(body, el("div", { class: "banner" }, el("div", { text: `${r.file} is ready (readonly). Review it, then start the run.` }), r.warnings && r.warnings.length ? el("ul", {}, r.warnings.map((w) => el("li", { text: w }))) : null,
        el("div", {}, r.loginNeeded ? btn("Log in now", () => post({ type: "login", product: r.product })) : null, btn("▷ Start run", () => post({ type: "run", product: r.product, environment: "default" }), r.loginNeeded ? "secondary" : ""), btn("Open config", () => post({ type: "openConfig", product: r.product, environment: "default" }), "secondary"), btn("Another product", () => post({ type: "newForm" }), "link"))));
      return section("form", "New product", "", body);
    }
    if (fs.errors && fs.errors.length) add(body, el("div", { class: "banner error" }, el("div", { text: "Fix these, then create it again:" }), el("ul", {}, fs.errors.map((e) => el("li", { text: e })))));
    add(body, 
      field("Product name", "name", { placeholder: "Acme CRM", hint: "Its run-config is config/<name as a slug>.yaml." }),
      el("div", {}, ["public", "internal"].map((v) => el("label", { class: "inline" }, el("input", { type: "radio", name: "vis", checked: form.visibility === v, on: { change: () => set("visibility", v) } }), v === "public" ? "Public tool (vendor docs on the web)" : "Internal tool"))),
      field("URL to test", "url", { placeholder: "https://crm.example.com" }),
      field("What it is (optional)", "description", { multi: true, rows: 2, placeholder: "A short description of the product" }),
      field("Overview link (optional; helps an internal tool)", "overviewUrl", { placeholder: "https://wiki.example.com/acme" }),
      field("Modules to test", "modules", { multi: true, placeholder: "Contacts\nDeals | https://crm.example.com/deals", hint: "One per line. Add | and a URL for a module's own page." }),
      field("References (optional)", "references", { multi: true, placeholder: "https://docs.example.com\ndocs/requirements.md", files: "Add files…", hint: "Links and files (.md, .csv, .pdf), one per line." }),
      field("API (optional)", "api", { multi: true, rows: 2, placeholder: "https://api.example.com/openapi.json", files: "Add a spec file…" }),
      el("label", { class: "inline" }, el("input", { type: "checkbox", checked: !!form.loginNeeded, on: { change: (e) => { set("loginNeeded", e.target.checked); render(); } } }), "It needs a login"),
      form.loginNeeded ? field("Credentials file (optional)", "credentialsFile", { files: "Choose…", hint: "A path only, never a password. Or log in in Microsoft Edge after creating it." }) : null,
      el("label", { text: "Steps to run" }),
      el("div", {}, K.STEPS.map((s) => el("label", { class: "inline" }, el("input", { type: "checkbox", checked: (form.steps || []).indexOf(s) >= 0, on: { change: (e) => { set("steps", K.STEPS.filter((x) => (x === s ? e.target.checked : (form.steps || []).indexOf(x) >= 0))); render(); } } }), K.STEP_LABELS[s]))),
    );
    const steps = form.steps || [];
    const askTypes = steps.indexOf("testcases") >= 0 && K.CASE_TYPES.some((t) => steps.indexOf(K.AUTOMATION[t]) < 0);
    if (askTypes)
      add(body, el("label", { text: "Test case types (without their automation step)" }), el("div", {}, K.CASE_TYPES.filter((t) => steps.indexOf(K.AUTOMATION[t]) < 0).map((t) => el("label", { class: "inline" }, el("input", { type: "checkbox", checked: (form.testcasesTypes || []).indexOf(t) >= 0, on: { change: (e) => set("testcasesTypes", K.CASE_TYPES.filter((x) => (x === t ? e.target.checked : (form.testcasesTypes || []).indexOf(x) >= 0))) } }), t === "ui" ? "UI" : t === "api" ? "API" : "Performance"))));
    add(body, field("Your own test cases (optional)", "testcasesImport", { files: "Choose…", hint: "A file of test cases you already have." }));
    add(body, el("div", {}, btn(fs.busy ? "Creating…" : "Create the run-config", () => post({ type: "draft", form }), "", { disabled: !!fs.busy }), el("span", { class: "hint" }, " or ", btn("let the orchestrator interview me", () => post({ type: "interview" }), "link"))));
    return section("form", "New product", "", body);
  }

  function render() {
    if (!state) return;
    const kids = [];
    const c = state.cockpit;
    if (state.workspace.state !== "ok") kids.push(workspaceBlock(state.workspace));
    if (c && typeof c === "object" && state.workspace.state === "ok") kids.push(cockpitBlocks(c));
    // with the cockpit above it, the environment stays out of the way while every row is ok
    if (open.env === undefined) open.env = !(c && state.env.rows && state.env.rows.length && state.env.rows.every((r) => r.status === "ok"));
    kids.push(envSection(state.env));
    if (state.workspace.state === "ok") {
      kids.push(productsSection(state.products));
      if (!state.products.length) open.form = true;
      kids.push(formSection(state.form));
    }
    app.replaceChildren(...kids.flat(Infinity));
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (!m || typeof m !== "object") return;
    if (m.type === "state" && m.state && typeof m.state === "object") {
      state = m.state;
      if (state.form && state.form.reset) form = { visibility: "public", steps: K.STEPS.slice(), testcasesTypes: ["ui"], loginNeeded: false };
      if (state.form && state.form.open) open.form = true;
      keep();
      render();
    } else if (m.type === "files" && typeof m.field === "string" && Array.isArray(m.paths)) {
      const multi = m.field === "references" || m.field === "api";
      const add = m.paths.filter((p) => typeof p === "string");
      if (multi) form[m.field] = [String(form[m.field] || "").trim(), ...add].filter(Boolean).join("\n");
      else if (add.length) form[m.field] = add[0];
      keep();
      render();
    }
  });
  post({ type: "ready" });
}
