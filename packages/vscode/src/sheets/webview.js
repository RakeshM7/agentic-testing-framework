// The sheets' webview page: the HTML shell and the script that renders a sheet and sends the human's edits. Pure; no
// vscode import (the panel passes the webview's cspSource in).
//
// Hygiene:
// - CSP: default-src 'none'; the one inline <style> and <script> carry a fresh nonce per page; no img, font, connect,
//   frame or form source at all, so nothing remote can load and nothing can be posted anywhere but to the extension.
// - The page holds no data: the extension sends the sheet in a "load" message, which the script checks with
//   validateHostMessage before rendering. Every value is put in the DOM with textContent or a form control's value,
//   never as HTML, so a question or an agent's notes can't inject markup. The only HTML built from a string is the
//   shell below, and its one variable text (the title) is escaped.
// - The script is embedded by source (`(${fn})(…)`), so it must be self-contained: browser globals only.
import { randomBytes } from "node:crypto";
import { validateHostMessage } from "./messages.js";

export const makeNonce = () => randomBytes(18).toString("base64");

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function csp(nonce) {
  return [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

const STYLE = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:0 16px 32px}
header{position:sticky;top:0;background:var(--vscode-editor-background);padding:10px 0;border-bottom:1px solid var(--vscode-panel-border);z-index:1}
h1{font-size:1.2em;margin:0 0 6px}
button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:none;padding:4px 10px;margin:2px 4px 2px 0;cursor:pointer}
button:hover{background:var(--vscode-button-hoverBackground)}
button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}
button.link{background:none;color:var(--vscode-textLink-foreground);padding:0 4px;text-decoration:underline}
button:disabled{opacity:.5;cursor:default}
button.primary{font-weight:600}
textarea,input,select{font:inherit;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);box-sizing:border-box}
textarea{width:100%;min-height:5em;resize:vertical}
input.comment{width:100%}
.counts{opacity:.85;margin:4px 0}
.status{margin:6px 0;padding:6px 8px;border-left:3px solid var(--vscode-focusBorder)}
.status.warning,.banner{border-left:3px solid var(--vscode-editorWarning-foreground);background:var(--vscode-inputValidation-warningBackground)}
.status.error{border-left:3px solid var(--vscode-editorError-foreground);background:var(--vscode-inputValidation-errorBackground)}
.banner{padding:6px 8px;margin:8px 0}
.row{border:1px solid var(--vscode-panel-border);padding:8px 10px;margin:10px 0}
.row.dirty{border-color:var(--vscode-focusBorder)}
.label{font-weight:600;margin-top:6px}
.pre{white-space:pre-wrap;word-break:break-word}
.muted{opacity:.75}
.badge{display:inline-block;padding:0 6px;margin-left:6px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);font-size:.85em}
table{border-collapse:collapse;width:100%;margin-top:8px}
th,td{border:1px solid var(--vscode-panel-border);padding:4px 6px;vertical-align:top;text-align:left}
tr.dirty td{background:var(--vscode-list-inactiveSelectionBackground)}
tr.stale td{opacity:.7}
`;

export function renderHtml({ kind, title, nonce }) {
  if (!["clarifications", "approval"].includes(kind)) throw new Error(`unknown sheet kind '${kind}'`);
  if (!/^[A-Za-z0-9+/=]{16,}$/.test(String(nonce))) throw new Error("a nonce of at least 16 base64 characters is required");
  // esbuild's keepNames wraps functions in __name(); the shim keeps the embedded script independent of the bundle.
  const script = `var __name=function(t){return t};(${sheetsClient.toString()})(${JSON.stringify(kind)},(${validateHostMessage.toString()}));`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp(nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<div id="app"><p>Loading…</p></div>
<script nonce="${nonce}">${script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------------------------------------------
// The webview's script. Runs in the webview, not in the extension: browser globals only.
// The draft (the human's unsaved edits) is mirrored to the extension on every change, so the extension knows the
// panel is dirty (it asks before approving with unsaved edits) and can restore the draft if the webview reloads.
export function sheetsClient(kind, validateHostMessage) {
  const vscode = acquireVsCodeApi();
  const app = document.getElementById("app");
  let msg = null; // the last load message
  let draft = new Map(); // id -> edit
  let showAll = false;
  let status = null;

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === "value") n.value = v;
      else if (["disabled", "readOnly", "selected", "title", "type", "rows"].includes(k)) n[k] = v;
      else if (k.startsWith("aria-")) n.setAttribute(k, v);
    }
    return add(n, ...kids);
  }
  // DOM append() would turn an array into "[object …]" and null into "null": flatten, skip the empty, wrap strings.
  function add(n, ...kids) {
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) n.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
    return n;
  }
  const post = (m) => vscode.postMessage(m);
  const sendDraft = () => post({ type: "draft", edits: [...draft.values()] });

  // ---- clarifications ----
  const norm = (s) => String(s || "").replace(/\r\n?/g, "\n").trim();
  function clarEdit(row) {
    return draft.get(row.id) || { id: row.id, answer: row.answer, approve: false };
  }
  function setClar(row, change) {
    const e = Object.assign({}, clarEdit(row), change);
    if (norm(e.answer) !== norm(row.answer)) e.approve = false;
    if (norm(e.answer) === norm(row.answer) && !e.approve) draft.delete(row.id);
    else draft.set(row.id, e);
    sendDraft();
    render();
  }
  function willBe(row, e) {
    if (msg.sheet.layout === "legacy") return norm(e.answer) === norm(row.answer) ? null : norm(e.answer) ? "answered (older layout: no Answer status column)" : "open";
    if (e.approve) return "human-approved";
    if (norm(e.answer) === norm(row.answer)) return null;
    return norm(e.answer) ? "human" : "open (answer cleared)";
  }
  function clarRow(row) {
    const e = clarEdit(row);
    const dirty = draft.has(row.id);
    const locked = msg.readOnly || row.problems.length > 0;
    const stateText = { open: "open", proposed: "awaiting your approval (" + row.answerStatus + ")", answered: "answered (" + row.answerStatus + ")" }[row.state] || row.state;
    const next = willBe(row, e);
    return el(
      "div",
      { class: "row" + (dirty ? " dirty" : "") },
      el("div", {}, el("strong", { text: row.id }), el("span", { class: "badge", text: stateText }), el("span", { class: "muted", text: "  created in " + row.runId })),
      row.problems.map((p) => el("div", { class: "status error", text: p })),
      el("div", { class: "label", text: "Question" }),
      el("div", { class: "pre", text: row.question }),
      el("div", { class: "label", text: "Steps to execute" }),
      el("div", { class: "pre", text: row.steps }),
      row.notes ? [el("div", { class: "label", text: "Clarification agent notes" }), el("div", { class: "pre muted", text: row.notes })] : null,
      row.evidence.length
        ? [el("div", { class: "label", text: "Evidence" }), el("div", {}, row.evidence.map((f) => el("button", { class: "link", text: f, title: "Open " + f, on: { click: () => post({ type: "openEvidence", id: row.id, file: f }) } })))]
        : null,
      el("div", { class: "label", text: "Answer" }),
      el("textarea", {
        value: e.answer, readOnly: locked, "aria-label": "Answer for " + row.id,
        on: { input: (ev) => { const v = ev.target.value; const ee = Object.assign({}, clarEdit(row), { answer: v }); if (norm(v) !== norm(row.answer)) ee.approve = false; if (norm(v) === norm(row.answer) && !ee.approve) draft.delete(row.id); else draft.set(row.id, ee); sendDraft(); }, change: () => render() },
      }),
      el(
        "div",
        {},
        row.state === "proposed" && msg.sheet.layout === "current"
          ? el("button", { class: e.approve ? "" : "secondary", disabled: locked || norm(e.answer) !== norm(row.answer), text: e.approve ? "Approved as is (undo)" : "Approve this answer as is", on: { click: () => setClar(row, { answer: row.answer, approve: !e.approve }) } })
          : null,
        row.answer || e.answer ? el("button", { class: "secondary", disabled: locked, text: "Clear answer", on: { click: () => setClar(row, { answer: "", approve: false }) } }) : null,
        dirty ? el("button", { class: "secondary", text: "Undo", on: { click: () => { draft.delete(row.id); sendDraft(); render(); } } }) : null,
        next ? el("span", { class: "muted", text: " Saved as: " + next }) : null
      )
    );
  }

  // ---- approval ----
  function apprEdit(row) {
    return draft.get(row.id) || { id: row.id, approved: row.understood ? row.approved : "", comment: row.comment };
  }
  function setAppr(row, change) {
    const e = Object.assign({}, apprEdit(row), change);
    const same = (row.understood ? e.approved === row.approved : false) && norm(e.comment) === norm(row.comment);
    if (same) draft.delete(row.id);
    else draft.set(row.id, e);
    sendDraft();
  }
  function apprRow(row) {
    const e = apprEdit(row);
    const blocked = row.sheet === "changed" || row.sheet === "not-a-case";
    const recorded = { approved: "approved", rejected: "rejected", changes: "changes requested", awaiting: "awaiting", invalidated: "awaiting (an earlier version was decided)" }[row.recorded] || row.recorded;
    const select = el(
      "select",
      { disabled: msg.readOnly || (blocked && !e.approved), "aria-label": "Approved for " + row.id, on: { change: (ev) => { setAppr(row, { approved: ev.target.value }); render(); } } },
      ["", "yes", "no", "changes"].map((v) => el("option", { value: v, selected: e.approved === v, text: v || "(blank)" }))
    );
    return el(
      "tr",
      { class: (draft.has(row.id) ? "dirty " : "") + (blocked ? "stale" : "") },
      el("td", {}, el("strong", { text: row.id }), el("div", { class: "muted", text: row.version + (row.run ? " · " + row.run : "") })),
      el("td", { class: "pre", text: row.title }),
      el("td", { class: "pre", text: row.keySteps }),
      el("td", { class: "pre", text: row.expected }),
      el("td", { text: row.priority }),
      el("td", {}, recorded, row.toRecord ? el("div", { class: "muted", text: "sheet differs: run Approve module to record" }) : null),
      el(
        "td",
        {},
        select,
        !row.understood ? el("div", { class: "status warning", text: "The sheet says '" + row.approved + "', which approve does not understand" }) : null,
        blocked ? el("div", { class: "muted", text: row.sheet === "changed" ? "Changed since rendered: no decision until the sheet is re-rendered" : "Not a current test case" }) : null
      ),
      el("td", {}, el("input", { class: "comment", value: e.comment, readOnly: msg.readOnly, "aria-label": "Comment for " + row.id, on: { input: (ev) => setAppr(row, { comment: ev.target.value }), change: () => render() } }))
    );
  }

  function render() {
    app.replaceChildren();
    if (!msg) return app.append(el("p", { text: "Loading…" }));
    const head = el("header", {}, el("h1", { text: msg.title }));
    app.append(head);
    if (msg.error) {
      head.append(el("div", { class: "status error", text: msg.error }), el("button", { class: "secondary", text: "Reload", on: { click: () => post({ type: "reload" }) } }), el("button", { class: "secondary", text: "Open as text", on: { click: () => post({ type: "openText" }) } }));
      return;
    }
    const v = msg.sheet;
    const c = v.counts;
    const n = draft.size;
    add(
      head,
      el("div", { class: "counts", text: kind === "clarifications" ? c.total + " rows · " + c.open + " open · " + c.proposed + " awaiting approval · " + c.answered + " answered" : c.cases + " cases · " + c.pending + " pending · " + c.approved + " approved · " + c.rejected + " rejected · " + c.changes + " changes · " + c.toRecord + " to record" }),
      el("button", { class: "primary", disabled: msg.readOnly || !n, text: n ? "Save (" + n + ")" : "Save", on: { click: () => post({ type: "save", edits: [...draft.values()] }) } }),
      el("button", { class: "secondary", disabled: !n, text: "Revert", on: { click: () => { draft = new Map(); sendDraft(); render(); } } }),
      el("button", { class: "secondary", text: "Reload from disk", on: { click: () => post({ type: "reload" }) } }),
      el("button", { class: "secondary", text: "Open as text", on: { click: () => post({ type: "openText" }) } }),
      el("button", { class: "secondary", text: showAll ? "Show pending only" : "Show all rows", on: { click: () => { showAll = !showAll; render(); } } }),
      kind === "approval" ? el("button", { class: "primary", text: "Approve module…", title: "Shows the saved sheet's decisions, then records them after you type the module slug", on: { click: () => post({ type: "approveModule" }) } }) : null
    );
    if (msg.readOnly) head.append(el("div", { class: "status warning", text: "Read only: " + (msg.readOnlyReason || "this sheet can't be edited here") }));
    if (status) head.append(el("div", { class: "status " + status.level, text: status.text }));
    if (kind === "clarifications") {
      const rows = v.rows.filter((r) => showAll || r.state !== "answered" || draft.has(r.id));
      add(app, rows.length ? rows.map(clarRow) : el("p", { text: "No open rows and no answers awaiting approval." }));
      return;
    }
    head.append(el("div", { class: "muted", text: "Approve module… records the saved sheet after you type the module slug in its dialog. Nothing is approved here." }));
    if (!v.built) app.append(el("div", { class: "banner", text: "The test cases were never built (no coverage.json): the sheet can't be checked against them." }));
    if (v.stale) app.append(el("div", { class: "banner", text: "This sheet is out of date against the test cases" + (v.changed.length ? ": changed since rendered or no longer a case: " + v.changed.join(", ") : "") + (v.missingCases.length ? "; not in the sheet: " + v.missingCases.join(", ") : "") + ". The next test cases build re-renders it and keeps your entries for unchanged cases." }));
    if (v.unreadable.length) app.append(el("div", { class: "banner", text: "Version unreadable (Excel may have changed it): " + v.unreadable.join(", ") + ". approve reports these rows until the Version is right." }));
    const rows = v.rows.filter((r) => showAll || r.recorded === "awaiting" || r.recorded === "invalidated" || r.toRecord || draft.has(r.id));
    if (!rows.length) return app.append(el("p", { text: "No case is pending approval." }));
    app.append(el("table", {}, el("thead", {}, el("tr", {}, ["TC ID", "Title", "Key steps", "Expected", "Priority", "Recorded", "Approved", "Comment"].map((h) => el("th", { text: h })))), el("tbody", {}, rows.map(apprRow))));
  }

  window.addEventListener("message", (event) => {
    const m = event.data;
    if (!validateHostMessage(m)) return; // anything else is ignored, never rendered
    if (m.type === "status") {
      status = { level: m.level, text: m.text };
      return render();
    }
    if (m.kind !== kind) return;
    msg = m;
    status = m.notice && typeof m.notice === "object" && typeof m.notice.text === "string" ? { level: ["info", "warning", "error"].includes(m.notice.level) ? m.notice.level : "info", text: m.notice.text } : null;
    draft = new Map(m.draft.filter((e) => e && typeof e.id === "string").map((e) => [e.id, e]));
    render();
  });
  post({ type: "ready" });
}
