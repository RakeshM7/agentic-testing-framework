// Cockpit tab: Run timeline (D-110, docs/cockpit-plan.md W7a). Embedded in the editor tab's page by source, so it is
// self-contained: browser globals only, no imports, no module-scope references. Reads C1's `timeline`, `run` and
// `missing` only; posts only C3 messages (resume, openReport). All text goes in as textContent via the kit.
export function renderTimeline(data, ctx, kit, post) {
  const { el, btn, glyph, idChip, modeBadge, rail, empty, dur } = kit;
  const d = data || {};
  const tl = d.timeline || { stages: [], totals: null, history: [] };
  const stages = Array.isArray(tl.stages) ? tl.stages : [];
  const history = Array.isArray(tl.history) ? tl.history : [];
  const focus = (ctx && ctx.focus) || null;
  const notes = (Array.isArray(d.missing) ? d.missing : []).filter((m) => m && (m.section === "timeline" || m.section === "run"));
  let attentionOnly = false;

  // a tiny copy of runs.js stageState, for the timeline's status rows
  const stateOf = (s) => {
    const st = s.status;
    if (st === "not-chosen") return "not-chosen";
    if (st === "running") return "running";
    if (st === "done" || st === "complete") return "done";
    if (st === "awaiting-approval") return "awaiting-approval";
    if (st === "failed") return "failed";
    if (st === "blocked") return "blocked";
    return "pending";
  };
  const needsAttention = (s) => {
    const st = stateOf(s);
    return st === "failed" || st === "blocked" || st === "awaiting-approval" || !!s.reviewFailed;
  };
  const canResume = (s) => ["failed", "blocked", "pending"].includes(stateOf(s));
  const isFocus = (s) => !!(focus && focus.stage && s.stage === focus.stage && (focus.module === undefined || focus.module === null || (s.module || null) === focus.module));
  const text = (v) => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") return String(v.text || v.message || v.title || v.reason || JSON.stringify(v));
    return String(v);
  };

  const noteEls = notes.map((m) => el("div", { class: "muted", text: `not available: ${m.reason || "unknown"}${m.module ? ` (${m.module})` : ""}` }));
  const root = el("div", { class: "timeline" });

  if (!d.run && !stages.length) {
    return el("div", { class: "timeline" }, empty("No run yet. Start one from the sidebar and its stages show here."), noteEls);
  }

  const stageCard = (s) => {
    const st = stateOf(s);
    const focused = isFocus(s);
    const head = el(
      "div",
      { class: "toolbar" },
      glyph(st),
      el("strong", { text: s.stage }),
      el("span", { class: "muted", text: dur(s.durationMs) }),
      s.attempts > 1 ? el("span", { class: "chip", text: `×${s.attempts}`, title: `${s.attempts} attempts` }) : null,
      s.reviewFailed ? el("span", { class: "chip", text: "review failed" }) : null,
      canResume(s) ? btn("Resume", () => post({ type: "resume", stage: s.stage, module: s.module || null }), "secondary", { title: `Resume ${s.stage}` }) : null,
    );
    const findings = Array.isArray(s.findings) ? s.findings : [];
    const steps = Array.isArray(s.steps) ? s.steps : [];
    const errorBlock = s.error ? el("details", { open: true }, el("summary", { text: "Error" }), el("div", { text: s.error })) : null;
    const findingsBlock = findings.length ? el("details", {}, el("summary", { text: `Review findings (${findings.length})` }), findings.map((f) => el("div", { text: text(f) }))) : null;
    const stepsBlock = steps.length
      ? el("details", {}, el("summary", { text: `Steps (${steps.length})` }), steps.map((p) => el("div", { class: "toolbar" }, glyph(stateOf({ status: p.status })), el("span", { text: p.name }), el("span", { class: "muted", text: dur(p.durationMs) }))))
      : null;
    return el(
      "div",
      { class: focused ? "card needs" : "card", dataset: { stage: s.stage, module: s.module || "", focus: focused ? "true" : "false" }, aria: focused ? { current: "true" } : {} },
      head,
      errorBlock,
      findingsBlock,
      stepsBlock,
    );
  };

  const lane = (title, rows) => {
    const shown = attentionOnly ? rows.filter(needsAttention) : rows;
    return el(
      "div",
      { class: "lane" },
      el("div", { class: "section-title", text: title }),
      rail(rows.map((s) => ({ label: s.stage, state: stateOf(s) }))),
      shown.length ? shown.map(stageCard) : el("div", { class: "muted", text: "Nothing needs attention here." }),
    );
  };

  const body = el("div", { class: "timeline-body" });
  const drawBody = () => {
    const productRows = stages.filter((s) => !s.module);
    const modules = [];
    for (const s of stages) if (s.module && !modules.includes(s.module)) modules.push(s.module);
    const parts = [];
    if (productRows.length) parts.push(lane("Product", productRows));
    for (const m of modules) parts.push(lane(`Module ${m}`, stages.filter((s) => s.module === m)));
    if (!stages.length) parts.push(empty("The run has no stages yet."));
    body.replaceChildren(...parts);
    const f = body.find ? body.find(".card.needs") : null;
    if (f && typeof f.scrollIntoView === "function") f.scrollIntoView({ block: "center" });
  };

  const totals = tl.totals || null;
  const header = el(
    "div",
    { class: "toolbar" },
    d.run ? modeBadge(d.run.mode) : null,
    d.run ? idChip(d.run.runId) : null,
    d.run && d.run.active ? el("span", { class: "chip", text: "active" }) : null,
    totals ? el("span", { class: "chip", text: `total ${dur(totals.durationMs)}`, title: "Total duration" }) : null,
    totals ? el("span", { class: "chip", text: `${totals.spawns} spawns`, title: "Agent spawns" }) : null,
  );
  const filterBtn = btn("Needs attention only", () => {
    attentionOnly = !attentionOnly;
    filterBtn.textContent = attentionOnly ? "Show all" : "Needs attention only";
    filterBtn.setAttribute("aria-pressed", String(attentionOnly));
    drawBody();
  }, "secondary");
  filterBtn.setAttribute("aria-pressed", "false");

  root.append(header, el("div", { class: "toolbar" }, filterBtn), ...noteEls, body);
  drawBody();

  root.append(el("div", { class: "section-title", text: "Run history" }));
  if (!history.length) root.append(empty("No earlier runs."));
  else {
    for (const h of history) {
      root.append(
        el(
          "div",
          { class: "toolbar", dataset: { run: h.runId } },
          idChip(h.runId),
          el("span", { class: "chip", text: h.outcome || "unknown" }),
          el("span", { class: "muted", text: h.createdAt || "" }),
          h.report ? btn("Open report", () => post({ type: "openReport", runId: h.runId }), "secondary") : el("span", { class: "muted", text: "no report" }),
        ),
      );
    }
  }
  return root;
}
