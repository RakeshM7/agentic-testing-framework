// the Cockpit's look and DOM kit (D-110, docs/cockpit-plan.md C4): the one stylesheet and the one set of builders that
// the sidebar page and the editor tab's page share, so both read as one product. Pure; no vscode import.
//
// - COCKPIT_CSS is theme-native: VS Code's own variables (so light, dark and high contrast follow the user's theme),
//   plus one accent, taken from the atf icon. It works at a 240px sidebar and in a wide editor tab.
// - cockpitKit is embedded in each page by source, as `(${cockpitKit})()`, so it is self-contained: browser globals
//   only, no reference to anything in this module. It returns the helpers (el, btn, glyph, idChip, ...).
// - Text always goes in as textContent, never as HTML; a glyph always carries its words (title and aria-label),
//   never colour alone.

export const COCKPIT_CSS = `
:root{--atf-accent:color-mix(in srgb,#2fd1a8 70%,var(--vscode-foreground))}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:transparent;margin:0;padding:0 10px 24px}
.muted{opacity:.75}
.section-title{font-weight:600;text-transform:uppercase;font-size:.85em;letter-spacing:.04em;margin:14px 0 6px;display:flex;align-items:center;gap:6px}
.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0}
.chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:10px;font-size:.9em;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background)}
.empty{padding:12px 8px;margin:8px 0;opacity:.8;text-align:center;border:1px dashed var(--vscode-panel-border);border-radius:3px}
.id{font-family:var(--vscode-editor-font-family,monospace);font-size:.92em;padding:0 4px;border-radius:2px;background:var(--vscode-textCodeBlock-background);overflow-wrap:anywhere}

/* glyphs: the symbol is coloured, its words live in title and aria-label */
.glyph{display:inline-block;width:1.2em;flex:none;text-align:center;line-height:1}
.g-done{color:var(--vscode-testing-iconPassed,#3fb950)}
.g-running{color:var(--vscode-charts-blue,#3794ff)}
.g-pending{opacity:.7}
.g-awaiting-approval{color:var(--vscode-editorWarning-foreground,#cca700)}
.g-blocked{color:var(--vscode-editorWarning-foreground,#cca700)}
.g-failed{color:var(--vscode-testing-iconFailed,#f14c4c)}
.g-not-chosen{opacity:.55}
.g-unverified{color:var(--vscode-editorWarning-foreground,#cca700);font-weight:700}

/* the pipeline rail: nodes joined by a line, solid through the last done node, dashed after (vertical when narrow) */
.rail{display:flex;flex-direction:column;margin:6px 0;padding:0}
.rail-node{position:relative;display:flex;align-items:center;gap:6px;padding:3px 0 3px 2px;font:inherit;color:inherit;background:none;border:none;text-align:left;min-width:0}
button.rail-node{cursor:pointer}
button.rail-node:hover{background:var(--vscode-list-hoverBackground)}
.rail-node:not(:first-child)::before{content:"";position:absolute;left:.7em;top:-50%;height:100%;border-left:2px dashed var(--vscode-panel-border)}
.rail-node.solid:not(:first-child)::before{border-left-style:solid;border-left-color:var(--atf-accent)}
.rail-node .glyph{position:relative;z-index:1;background:var(--vscode-editor-background,transparent);border-radius:50%}
.rail-node.state-done .glyph{color:var(--atf-accent)}
.rail-node .label{overflow-wrap:anywhere}
@media (min-width:640px){
  .rail{flex-direction:row;flex-wrap:wrap;gap:0}
  .rail-node{flex-direction:column;align-items:center;padding:0 10px;text-align:center}
  .rail-node:not(:first-child)::before{left:-50%;top:.6em;width:100%;height:0;border-left:none;border-top:2px dashed var(--vscode-panel-border)}
  .rail-node.solid:not(:first-child)::before{border-top-style:solid;border-top-color:var(--atf-accent)}
}

/* cards: the Needs you items */
.card{padding:6px 8px;margin:6px 0;border-left:3px solid var(--atf-accent);background:var(--vscode-textBlockQuote-background);border-radius:0 2px 2px 0;overflow-wrap:anywhere}
.card.needs{border-left-color:var(--vscode-editorWarning-foreground,#cca700)}

/* the safety-mode badge */
.mode{display:inline-block;padding:0 7px;border-radius:9px;font-size:.85em;font-weight:600;white-space:nowrap}
.mode-readonly{border:1px solid var(--atf-accent);color:var(--atf-accent);background:transparent}
.mode-full-run{border:1px solid var(--vscode-editorWarning-foreground,#cca700);background:var(--vscode-editorWarning-foreground,#cca700);color:var(--vscode-editor-background,#1e1e1e)}

/* tabs (the editor tab's four views) */
.tabs{display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--vscode-panel-border);margin:8px 0}
.tab{font:inherit;color:var(--vscode-foreground);background:none;border:none;border-bottom:2px solid transparent;padding:5px 10px;cursor:pointer;opacity:.8}
.tab:hover{opacity:1;background:var(--vscode-list-hoverBackground)}
.tab.active{opacity:1;font-weight:600;border-bottom-color:var(--atf-accent);color:var(--atf-accent)}

/* buttons, as the sidebar's */
button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:none;padding:3px 9px;margin:2px 4px 2px 0;cursor:pointer;border-radius:2px}
button:hover{background:var(--vscode-button-hoverBackground)}
button.secondary{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}
button.link{background:none;color:var(--vscode-textLink-foreground);padding:0;text-decoration:underline}
button:disabled{opacity:.5;cursor:default}
button.tab,button.rail-node{margin:0}
button.tab{background:none;color:var(--vscode-foreground)}
button.tab.active{color:var(--atf-accent)}
button.rail-node{background:none;color:inherit;padding:3px 0 3px 2px}
button:focus-visible,.tab:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px}

/* the grid: a table in a scroller, sticky header; scrolls sideways at narrow widths */
.grid{border-collapse:collapse;width:100%;font-size:.95em}
.grid th,.grid td{text-align:left;vertical-align:top;padding:4px 8px;border-bottom:1px solid var(--vscode-panel-border)}
.grid th{position:sticky;top:0;z-index:2;font-weight:600;background:var(--vscode-editor-background,var(--vscode-sideBar-background));border-bottom:1px solid var(--vscode-panel-border)}
.grid tbody tr:hover{background:var(--vscode-list-hoverBackground)}
.grid td>div+div{margin-top:2px}

/* what the tabs share: their filter controls, pressed chips, collapsible details, the focused stage */
.toolbar select,.toolbar label{font:inherit;font-size:.92em;color:var(--vscode-descriptionForeground,var(--vscode-foreground))}
.toolbar select{color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border,transparent);padding:1px 4px}
button.chip{border:1px solid transparent;cursor:pointer;font:inherit;font-size:.9em}
.chip[aria-pressed="true"]{border-color:var(--atf-accent);box-shadow:inset 0 0 0 1px var(--atf-accent)}
.chip.warn{color:var(--vscode-editorWarning-foreground);background:transparent;border:1px solid var(--vscode-editorWarning-foreground)}
details>summary{cursor:pointer;margin:2px 0;color:var(--vscode-descriptionForeground,var(--vscode-foreground))}
details>*:not(summary){margin-left:14px}
[data-focus="true"]{outline:2px solid var(--atf-accent);outline-offset:2px}
button.link.muted{opacity:.75}

/* high contrast: borders, not fills */
body.vscode-high-contrast .card,body.vscode-high-contrast .chip,body.vscode-high-contrast .id,body.vscode-high-contrast .empty{background:transparent;border:1px solid var(--vscode-contrastBorder,var(--vscode-panel-border))}
body.vscode-high-contrast .card{border-left:3px solid var(--vscode-contrastActiveBorder,var(--atf-accent))}
body.vscode-high-contrast .mode-full-run{background:transparent;color:var(--vscode-editorWarning-foreground);border-width:2px}
body.vscode-high-contrast .mode-readonly{border-width:2px}
body.vscode-high-contrast .tab.active{border:1px solid var(--vscode-contrastActiveBorder,var(--vscode-focusBorder));background:transparent}
body.vscode-high-contrast .grid th{background:var(--vscode-editor-background);border-bottom:2px solid var(--vscode-contrastBorder,var(--vscode-panel-border))}
body.vscode-high-contrast button{border:1px solid var(--vscode-contrastBorder,var(--vscode-button-foreground))}
`;

// Embedded by source in the page: no references outside this function, and no imports.
export function cockpitKit() {
  const GLYPHS = {
    done: ["●", "done"],
    running: ["◐", "running"],
    pending: ["○", "pending"],
    "awaiting-approval": ["◆", "awaiting approval"],
    blocked: ["⊘", "blocked"],
    failed: ["✗", "failed"],
    "not-chosen": ["·", "not chosen"],
    unverified: ["?", "unverified"],
  };

  // DOM append() would write null as "null": flatten, skip the empty, wrap strings as text nodes
  const add = (n, ...kids) => {
    for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) n.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
    return n;
  };

  const el = (tag, props, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = String(v);
      else if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === "dataset") for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = String(dv);
      else if (k === "aria") for (const [ak, av] of Object.entries(v)) n.setAttribute(`aria-${ak}`, String(av));
      else if (["value", "checked", "disabled", "type", "name", "placeholder", "rows", "title", "open"].includes(k)) n[k] = v;
    }
    return add(n, ...kids);
  };

  const btn = (text, onClick, cls, extra) => el("button", Object.assign({ class: cls || "", text, on: onClick ? { click: onClick } : {} }, extra || {}));

  const glyph = (state) => {
    const g = GLYPHS[state] || GLYPHS.unverified;
    const key = GLYPHS[state] ? state : "unverified";
    return el("span", { class: `glyph g-${key}`, text: g[0], title: g[1], aria: { label: g[1] } });
  };

  const idChip = (id) => el("code", { class: "id", text: id });

  const modeBadge = (mode) => {
    const m = mode === "full-run" ? "full-run" : "readonly";
    return el("span", { class: `mode mode-${m}`, text: m, title: m === "full-run" ? "full-run: this run may change the product under test" : "readonly: this run changes nothing" });
  };

  // items: [{ label, state, onClick? }]. A node's connector is solid when it lies at or before the last done node.
  const rail = (items) => {
    const list = items || [];
    let lastDone = -1;
    list.forEach((it, i) => {
      if (it.state === "done") lastDone = i;
    });
    return el(
      "div",
      { class: "rail" },
      list.map((it, i) =>
        el(it.onClick ? "button" : "div", { class: `rail-node state-${it.state}${i <= lastDone ? " solid" : ""}`, on: it.onClick ? { click: it.onClick } : {} }, glyph(it.state), el("span", { class: "label", text: it.label })),
      ),
    );
  };

  const table = (columns, rows, cell) => {
    const t = el("table", { class: "grid" });
    t.append(el("thead", {}, el("tr", {}, columns.map((c) => el("th", { text: c.label })))));
    t.append(
      el(
        "tbody",
        {},
        (rows || []).map((r) =>
          el(
            "tr",
            {},
            columns.map((c) => {
              const v = cell ? cell(r, c.key) : r[c.key];
              return el("td", {}, v !== null && typeof v === "object" ? v : v === undefined || v === null ? "" : String(v));
            }),
          ),
        ),
      ),
    );
    return t;
  };

  const empty = (text) => el("div", { class: "empty", text });

  // "3m 12s", "850 ms", "1h 5m"; "—" for anything that isn't a duration
  const dur = (ms) => {
    if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
    if (ms < 1000) return `${Math.round(ms)} ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  return { el, btn, glyph, idChip, modeBadge, rail, table, empty, dur };
}
