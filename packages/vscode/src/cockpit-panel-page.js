// the Cockpit's editor tab page (D-110, docs/cockpit-plan.md W6, C3): the HTML shell, the message checks, and the
// script that draws the header, the tab strip and the active tab. Pure; no vscode import.
//
// Hygiene, as the sheets' page (src/sheets/webview.js, whose CSP and helpers it reuses):
// - CSP default-src 'none', one inline <style> and <script> with a fresh nonce, nothing remote;
// - the page holds no data: the extension sends "data", and the script checks it with validatePanelPageMessage before
//   drawing; every value goes into the DOM as text (the kit's el), never as HTML;
// - the page is untrusted input: validateTabMessage accepts only the C3 messages with bounded fields, and the extension
//   checks each target again before acting on it.
import { COCKPIT_CSS, cockpitKit } from "./cockpit-style.js";
import { renderFailures } from "./cockpit-tabs/failures.js";
import { renderSafety } from "./cockpit-tabs/safety.js";
import { renderTimeline } from "./cockpit-tabs/timeline.js";
import { renderTrace } from "./cockpit-tabs/trace.js";
import { csp, escapeHtml } from "./sheets/webview.js";

// The four tab renderers (src/cockpit-tabs/*.js), each one self-contained function embedded by source, called as
// render(data, ctx, kit, post) -> Node.
export const RENDERERS = { timeline: renderTimeline, trace: renderTrace, failures: renderFailures, safety: renderSafety };

export const TABS = ["timeline", "trace", "failures", "safety"];
export const TAB_LABELS = { timeline: "Timeline", trace: "Traceability", failures: "Failures", safety: "Safety" };
export const SHEETS = ["clarifications", "approval"];

// ---- the messages ---------------------------------------------------------------------------------------------------
// Both checks are self-contained (no module references), so the page embeds validatePanelPageMessage by source.

// Host -> page: data | loading | error. -> { ok: true, message } | { ok: false, error }
export function validatePanelPageMessage(m) {
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const id = (v) => typeof v === "string" && v.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v);
  const tabs = ["timeline", "trace", "failures", "safety"];
  const bad = (why) => ({ ok: false, error: `${m && m.type}: ${why}` });
  if (!isObj(m) || typeof m.type !== "string") return { ok: false, error: "a message is an object with a type" };
  const keys = (allowed) => Object.keys(m).every((k) => allowed.includes(k));
  switch (m.type) {
    case "loading":
      return keys(["type"]) ? { ok: true, message: { type: "loading" } } : bad("takes no fields");
    case "error":
      return keys(["type", "message"]) && typeof m.message === "string" && m.message.length <= 4000 ? { ok: true, message: { type: "error", message: m.message } } : bad("needs a message (text)");
    case "data": {
      if (!keys(["type", "product", "environment", "tab", "focus", "data"])) return bad("unknown fields");
      if (!id(m.product) || !id(m.environment) || !tabs.includes(m.tab) || !isObj(m.data)) return bad("needs a product, an environment, a tab and the data");
      let focus;
      if (m.focus !== undefined && m.focus !== null) {
        if (!isObj(m.focus) || !Object.keys(m.focus).every((k) => k === "stage" || k === "module")) return bad("focus is {stage?, module?}");
        for (const k of ["stage", "module"]) if (m.focus[k] !== undefined && m.focus[k] !== null && !id(m.focus[k])) return bad(`focus.${k} is an id`);
        focus = { ...m.focus };
      }
      return { ok: true, message: { type: "data", product: m.product, environment: m.environment, tab: m.tab, ...(focus ? { focus } : {}), data: m.data } };
    }
    default:
      return bad("unknown message");
  }
}

// Page -> host (C3). The host checks the target again. -> { ok: true, message } | { ok: false, error }
export function validateTabMessage(m) {
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObj(m) || typeof m.type !== "string") return { ok: false, error: "a message is an object with a type" };
  const bad = (why) => ({ ok: false, error: `${m.type}: ${why}` });
  const only = (keys) => Object.keys(m).every((k) => k === "type" || keys.includes(k));
  const id = (v) => typeof v === "string" && v.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v) && !v.includes("..");
  switch (m.type) {
    case "ready":
    case "refresh":
    case "sweep":
      return only([]) ? { ok: true, message: { type: m.type } } : bad("takes no fields");
    case "tab":
      return only(["tab"]) && TABS.includes(m.tab) ? { ok: true, message: { type: "tab", tab: m.tab } } : bad(`tab is one of ${TABS.join(", ")}`);
    case "openFile":
      return only(["path"]) && typeof m.path === "string" && m.path.length > 0 && m.path.length <= 1000 && !m.path.includes("\0") ? { ok: true, message: { type: "openFile", path: m.path } } : bad("needs a path (text, at most 1000 characters)");
    case "resume":
      return only(["stage", "module"]) && id(m.stage) && (m.module === null || m.module === undefined || id(m.module)) ? { ok: true, message: { type: "resume", stage: m.stage, module: m.module ?? null } } : bad("needs a stage and a module (an id) or null");
    case "heal":
      return only(["stage", "module"]) && id(m.stage) && id(m.module) ? { ok: true, message: { type: "heal", module: m.module, stage: m.stage } } : bad("needs a module and a stage (ids)");
    case "openSheet":
      return only(["module", "sheet"]) && id(m.module) && SHEETS.includes(m.sheet) ? { ok: true, message: { type: "openSheet", module: m.module, sheet: m.sheet } } : bad(`needs a module and a sheet (${SHEETS.join(", ")})`);
    case "openReport":
      return only(["runId"]) && id(m.runId) ? { ok: true, message: { type: "openReport", runId: m.runId } } : bad("needs a run id");
    default:
      return bad("unknown message");
  }
}

// ---- the page -------------------------------------------------------------------------------------------------------

const STYLE = `${COCKPIT_CSS}
body{padding:0 16px 32px}
header.top{position:sticky;top:0;z-index:2;background:var(--vscode-editor-background);padding:10px 0 0;border-bottom:1px solid var(--vscode-panel-border)}
header.top .title{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}
header.top h1{font-size:1.15em;margin:0}
header.top .spacer{flex:1}
header.top button{font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:1px solid transparent;padding:3px 10px;cursor:pointer}
header.top button:hover{background:var(--vscode-button-secondaryHoverBackground)}
header.top button:focus-visible,.tabs button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}
.banner-error{margin:8px 0;padding:6px 8px;border-left:3px solid var(--vscode-editorError-foreground);background:var(--vscode-inputValidation-errorBackground)}
.panel-body{padding-top:8px}
`;

export function renderCockpitPanelHtml({ nonce }) {
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(String(nonce))) throw new Error("a nonce of at least 16 base64 characters is required");
  const renderers = Object.entries(RENDERERS)
    .map(([k, fn]) => `${k}:(${fn})`)
    .join(",");
  // esbuild's keepNames wraps functions in __name(); the shim keeps the embedded script independent of the bundle.
  const script = `var __name=function(t){return t};var validatePanelPageMessage=(${validatePanelPageMessage});var kit=(${cockpitKit})();var renderers={${renderers}};(${panelClient})(kit,renderers,validatePanelPageMessage,${JSON.stringify({ TABS, TAB_LABELS })});`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml("atf Cockpit")}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div id="app"><p class="muted">Loading…</p></div>
<script nonce="${nonce}">${script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
}

// The page's script. Runs in the webview: browser globals only. kit: cockpitKit()'s helpers; renderers: the tabs.
export function panelClient(kit, renderers, validate, K) {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  const { el, btn, modeBadge } = kit;
  const saved = vscode.getState() || {};
  let tab = K.TABS.includes(saved.tab) ? saved.tab : "timeline";
  let msg = null; // the last valid "data" message
  let loading = true;
  let error = null;
  const post = (m) => vscode.postMessage(m);
  const keep = () => vscode.setState({ tab });

  function draw() {
    const run = msg && msg.data ? msg.data.run : null;
    const title = el("div", { class: "title" }, el("h1", { text: msg ? msg.product : "atf Cockpit" }));
    if (msg) title.append(el("span", { class: "chip", text: msg.environment }));
    if (run && run.mode) title.append(modeBadge(run.mode));
    if (run && run.runId) title.append(el("span", { class: "muted" }, "run ", kit.idChip(run.runId), run.active ? " (active)" : ""));
    if (loading) title.append(el("span", { class: "muted", text: "Loading…", aria: { live: "polite" } }));
    title.append(el("span", { class: "spacer" }), btn("Refresh", () => post({ type: "refresh" }), "", { title: "Reload the run's state" }));
    const strip = el("div", { class: "tabs" });
    strip.setAttribute("role", "tablist");
    for (const t of K.TABS) {
      const b = btn(K.TAB_LABELS[t], () => select(t), "tab" + (t === tab ? " active" : ""));
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", t === tab ? "true" : "false");
      strip.append(b);
    }
    const body = el("div", { class: "panel-body" });
    if (error) {
      const banner = el("div", { class: "banner-error", text: error });
      banner.setAttribute("role", "alert");
      body.append(banner);
    }
    if (msg) {
      const ctx = { product: msg.product, environment: msg.environment, run, focus: msg.focus || null };
      try {
        body.append(renderers[tab](msg.data, ctx, kit, post));
      } catch (e) {
        body.append(kit.empty("This tab could not be drawn: " + (e && e.message ? e.message : String(e))));
      }
    } else if (!error) body.append(el("p", { class: "muted", text: "Loading…" }));
    app.replaceChildren(el("header", { class: "top" }, title, strip), body);
    const f = typeof document.querySelector === "function" ? document.querySelector('[data-focus="true"]') : null;
    if (f && f.scrollIntoView) f.scrollIntoView({ block: "center" });
  }

  function select(t) {
    if (t === tab) return;
    tab = t;
    keep();
    post({ type: "tab", tab: t });
    draw();
  }

  window.addEventListener("message", (event) => {
    const v = validate(event.data);
    if (!v.ok) return;
    const m = v.message;
    if (m.type === "loading") loading = true;
    else if (m.type === "error") {
      loading = false;
      error = m.message;
    } else {
      loading = false;
      error = null;
      msg = m;
      // the host's tab (opened with one, or a focus) wins over the remembered one
      if (m.tab !== tab) {
        tab = m.tab;
        keep();
      }
    }
    draw();
  });
  draw();
  post({ type: "ready" });
}
