// The Cockpit's Failures tab (D-110, docs/cockpit-plan.md W7c): triage classes as filter chips, clusters by severity,
// each with its rows, evidence and bug draft, the healable summary and the unverified-triage warning.
// Embedded by source: browser globals only, no imports, no module-scope references. Posts C3 messages only.
export function renderFailures(data, ctx, kit, post) {
  const { el, btn, glyph, idChip, empty } = kit;
  const f = (data && data.failures) || {};
  const byClass = f.byClass || {};
  const clusters = Array.isArray(f.clusters) ? f.clusters : [];
  const healable = Array.isArray(f.healable) ? f.healable : [];
  const unverified = Array.isArray(f.unverified) ? f.unverified : [];
  const missing = ((data && data.missing) || []).filter((m) => m && m.section === "failures");
  const SEV = ["critical", "major", "minor", "trivial"];
  const rank = (s) => (SEV.includes(s) ? SEV.indexOf(s) : SEV.length);
  const sorted = clusters.slice().sort((a, b) => rank(a.severity) - rank(b.severity) || (b.count || 0) - (a.count || 0));
  const hasResults = !!(data && data.trace && (data.trace.modules || []).some((m) => (m.cases || []).some((c) => (c.results || []).length > 0)));
  const classes = Object.keys(byClass);
  let selected = null; // the class filter, kept in this closure

  const link = (path, text) => btn(text || path, () => post({ type: "openFile", path }), "link", { title: path });
  const firstLine = (s) => String(s || "").split("\n")[0].slice(0, 300);
  const where = (c) => [c.module, c.framework].filter(Boolean).join(" · ");

  const rowView = (r) => {
    const ids = [r.tcId, r.scenarioId, r.k6Id].filter(Boolean);
    return el(
      "div",
      { class: "card" },
      el("div", {}, ids.map((i) => idChip(i)), ids.length ? " " : null, el("strong", { text: r.title || r.key })),
      r.error ? el("div", { class: "muted", text: firstLine(r.error) }) : null,
      r.fixHint ? el("div", {}, el("span", { class: "muted", text: "Fix hint: " }), r.fixHint) : null,
      (r.evidence || []).length ? el("div", {}, el("span", { class: "muted", text: "Evidence: " }), (r.evidence || []).map((p) => link(p))) : null,
    );
  };

  const clusterView = (c) =>
    el(
      "div",
      { class: "cluster" },
      el(
        "div",
        { class: "section-title" },
        el("span", { class: "chip", text: c.class || "unclassified" }),
        c.severity ? el("span", { class: "chip", text: c.severity }) : null,
        el("span", { text: `×${c.count || (c.rows || []).length}` }),
        el("span", { class: "muted", text: where(c) }),
      ),
      c.id ? el("div", {}, idChip(c.id), " ", el("span", { class: "muted", text: c.signature || "" })) : c.signature ? el("div", { class: "muted", text: c.signature }) : null,
      (c.rows || []).map(rowView),
      c.bugDraft ? el("div", {}, el("span", { class: "muted", text: "Bug draft: " }), link(c.bugDraft.file, c.bugDraft.title || c.bugDraft.file)) : null,
    );

  const toolbar = el("div", { class: "toolbar" });
  const body = el("div", {});
  const draw = () => {
    toolbar.replaceChildren(
      ...classes.map((k) => {
        const on = selected === k;
        return btn(`${k} ${byClass[k]}`, () => ((selected = on ? null : k), draw()), on ? "chip" : "chip muted", { aria: { pressed: on ? "true" : "false" }, title: on ? "Showing only this class; click to clear" : "Show only this class" });
      }),
    );
    const shown = sorted.filter((c) => !selected || c.class === selected);
    body.replaceChildren(
      ...(shown.length ? shown.map(clusterView) : [selected ? empty(`No ${selected} clusters`) : data && data.run && hasResults ? empty("No failures") : empty(data && data.run ? "No results yet: failures appear once tests have run" : "No run yet")]),
    );
  };
  draw();

  const heals = healable.filter((h) => h.count > 0).map((h) =>
    el("div", { class: "card" }, el("span", { text: `${h.count} healable in ${h.module} (${h.framework}) ` }), btn("Heal", () => post({ type: "heal", module: h.module, stage: h.stage }), "", { title: `Heal ${h.module} · ${h.stage}` })),
  );

  return el(
    "div",
    { class: "failures" },
    unverified.length
      ? el("div", { class: "card needs" }, glyph("unverified"), " Unverified triage: ", unverified.map((u) => `${u.module} (${u.framework})`).join(", "), ". Treat these classes as unconfirmed.")
      : null,
    missing.map((m) => el("div", { class: "muted", text: `Not available${m.module ? ` (${m.module})` : ""}: ${m.reason}` })),
    heals.length ? [el("div", { class: "section-title", text: "Healable" }), heals] : null,
    toolbar,
    body,
  );
}
