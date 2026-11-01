// The Cockpit's Safety & ledger tab (W7d; docs/cockpit-plan.md C1 `safety`, `run`, `missing`, and C3). renderSafety is
// embedded into the editor tab's webview by its source text, so it uses browser globals and the `kit` argument only,
// with no imports and no reference to anything outside its body. It posts only C3's `sweep` message.
export function renderSafety(data, ctx, kit, post) {
  const { el, btn, idChip, modeBadge, table, empty } = kit;
  const run = data ? data.run : null;
  const safety = (data && data.safety) || {};
  const ledger = safety.ledger || {};
  const entries = (Array.isArray(ledger.entries) ? ledger.entries : []).filter((e) => e && typeof e === "object");
  const live = Number(ledger.live) || 0;
  const notes = ((data && data.missing) || []).filter((m) => m && m.section === "safety");
  const missingNotes = () => notes.map((m) => el("div", { class: "muted", text: `not available: ${m.reason}` }));

  const root = el("div", { class: "safety" });

  // how a customized config file was made (the same wording as the report's notice)
  const how = (c) => {
    const files = c.files || [];
    if (c.source === "overlay") return `the framework's ${files[0]} overlaid by ${files.slice(1).join(", ")}`;
    if (c.source === "ejected") return `replaced by the workspace's ${files.join(", ")}`;
    return `the run-config's permissions_file ${files.join(", ")}`;
  };

  // framework config: the permissions (the safety ceiling) first and flagged, then the other overlaid or ejected files
  const configSection = () => {
    const cc = safety.customConfig;
    const nodes = [];
    if (!cc) {
      nodes.push(el("div", { class: "muted", text: "Framework config: not recorded for this run" }));
    } else {
      if (cc.permissions) {
        nodes.push(
          el(
            "div",
            { class: "card needs" },
            el("strong", { text: "Custom safety config: " }),
            `permissions.yaml, the ceiling on what every agent may do, is not the framework's own copy: ${how(cc.permissions)}.`,
          ),
        );
      } else {
        nodes.push(el("div", { class: "muted", text: "permissions.yaml: the framework's own copy" }));
      }
      for (const o of cc.other || []) {
        nodes.push(el("div", {}, el("code", { class: "id", text: o.name || "" }), ` ${o.source === "ejected" ? "replaced" : "overlaid"}: ${how(o)}`));
      }
      if (!(cc.other || []).length) nodes.push(el("div", { class: "muted", text: "No other framework config was customized" }));
    }
    return [el("div", { class: "section-title", text: "Framework config" }), ...nodes];
  };

  // before the first run: the mode the run-config would give the next run, marked as not yet a run's
  if (!run) {
    root.append(empty("No run yet"));
    if (safety.planned) {
      root.append(
        el("div", { class: "section-title", text: "Safety mode (before the first run)" }),
        el("div", { class: "toolbar" }, modeBadge(safety.mode), el("span", { class: "muted", text: ` from ${safety.configFile || "the run-config"}` })),
        el("p", { text: safety.explanation || "" }),
        ...configSection(),
      );
    } else if (safety.explanation) {
      root.append(el("p", { class: "muted", text: safety.explanation }));
    }
    root.append(...missingNotes());
    return root;
  }

  // mode and explanation
  root.append(
    el("div", { class: "section-title", text: "Safety mode" }),
    el("div", { class: "toolbar" }, modeBadge(safety.mode)),
    el("p", { text: safety.explanation || "" }),
  );

  // ledger, filtered by a closure: "Live only" re-renders the table
  const columns = [
    { key: "time", label: "time" },
    { key: "event", label: "event" },
    { key: "type", label: "type" },
    { key: "ref", label: "ref / label" },
    { key: "module", label: "module" },
    { key: "stage", label: "stage" },
    { key: "agent", label: "agent" },
    { key: "state", label: "live / cleaned" },
  ];
  const cell = (r, key) => {
    if (key === "time") return r.ts || "";
    if (key === "event") return r.event || "";
    if (key === "type") return r.type || "";
    if (key === "ref") return el("span", {}, idChip(String(r.ref ?? "")), r.label ? el("span", { class: "muted", text: ` ${r.label}` }) : null);
    if (key === "module") return r.module || "";
    if (key === "stage") return r.stage || "";
    if (key === "agent") return r.agent || "";
    return el("span", { class: "chip", text: r.live ? "live" : "cleaned" });
  };

  let liveOnly = false;
  const body = el("div");
  const render = () => {
    const rows = liveOnly ? entries.filter((e) => e.live) : entries;
    body.replaceChildren(rows.length ? table(columns, rows, cell) : empty(liveOnly ? "No live entities" : "No ledger entries"));
  };
  const liveBox = el("input", {
    type: "checkbox",
    checked: liveOnly,
    on: {
      change: () => {
        liveOnly = liveBox.checked;
        render();
      },
    },
  });

  const sweep =
    live > 0 && !run.active
      ? el(
          "div",
          { class: "card needs" },
          el("span", { text: `${live} entities this run created are still live` }),
          " ",
          btn("Sweep leftovers…", () => post({ type: "sweep" })),
        )
      : null;

  render();
  root.append(
    el("div", { class: "section-title", text: "Ledger" }),
    el("div", { class: "toolbar" }, el("label", {}, liveBox, " Live only")),
    ...(sweep ? [sweep] : []),
    body,
  );

  root.append(...configSection());

  // framework issues
  root.append(el("div", { class: "section-title", text: "Framework issues" }), el("p", { text: `${Number(safety.frameworkIssues) || 0} framework issues` }));

  root.append(...missingNotes());
  return root;
}
