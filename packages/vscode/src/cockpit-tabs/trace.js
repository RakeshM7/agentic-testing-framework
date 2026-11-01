// Cockpit tab: Traceability (D-110, docs/cockpit-plan.md W7b): one row per test case, case -> approval -> automation -> last result.
// Embedded in the page by source: browser globals only, no imports, no module-scope references. Reads C1's `trace`
// and `missing`; posts C3 messages (openFile, openSheet). Filters live in a closure and re-render only the body.
export function renderTrace(data, ctx, kit, post) {
  const { el, btn, glyph, idChip, table, empty } = kit;
  const KEY = { ui: "ui", api: "api", performance: "k6" };
  const modules = ((data && data.trace && data.trace.modules) || []).map((m) => ({ module: m.module, cases: m.cases || [] }));
  const missing = ((data && data.missing) || []).filter((m) => m && m.section === "trace");
  const filters = { module: "", type: "", gaps: false };

  const typesOf = (c) => c.types || [];
  const autoOf = (c, t) => (c.automation && c.automation[KEY[t] || t]) || { status: "none" };
  // automated: every type is mapped or deliberately excluded, and at least one is mapped
  const automated = (c) => {
    const ts = typesOf(c);
    return ts.length > 0 && ts.every((t) => ["mapped", "excluded"].includes(autoOf(c, t).status)) && ts.some((t) => autoOf(c, t).status === "mapped");
  };
  // a gap: some type is neither mapped nor deliberately excluded
  const unautomated = (c) => typesOf(c).length === 0 || typesOf(c).some((t) => !["mapped", "excluded"].includes(autoOf(c, t).status));
  const approved = (c) => c.approval === "approved";
  const results = (c) => c.results || [];
  const passing = (c) => results(c).length > 0 && results(c).every((r) => r.status === "passed" || r.status === "skipped") && results(c).some((r) => r.status === "passed");
  const badResult = (c) => results(c).some((r) => r.status === "failed" || r.status === "flaky");
  const isGap = (c) => !approved(c) || unautomated(c) || badResult(c);

  const rows = () => {
    const out = [];
    for (const m of modules) {
      if (filters.module && m.module !== filters.module) continue;
      for (const c of m.cases) {
        if (filters.type && !typesOf(c).includes(filters.type)) continue;
        if (filters.gaps && !isGap(c)) continue;
        out.push({ module: m.module, c });
      }
    }
    return out;
  };

  const link = (path) => btn(String(path).split("/").pop() || path, () => post({ type: "openFile", path }), "link", { title: path });
  const approvalState = { approved: "done", rejected: "failed", changes: "awaiting-approval", pending: "awaiting-approval", stale: "unverified" };
  const resultState = { passed: "done", failed: "failed", flaky: "unverified", skipped: "not-chosen" };

  const caseCell = (r) => {
    const c = r.c;
    return el("div", {}, [
      el("div", {}, idChip(c.id), " ", el("span", { class: "muted", text: r.module })),
      el("div", { text: c.title || "(untitled)" }),
      el("div", { class: "toolbar" }, typesOf(c).map((t) => el("span", { class: "chip", text: t }))),
      el("div", {}, glyph(approvalState[c.approval] || "unverified"), c.approval === "pending"
        ? btn("pending approval", () => post({ type: "openSheet", module: r.module, sheet: "approval" }), "link")
        : el("span", { text: c.approval || "unknown" })),
    ]);
  };

  const autoCell = (r) => {
    const c = r.c;
    if (!typesOf(c).length) return el("span", { class: "muted", text: "no types" });
    return el("div", {}, typesOf(c).map((t) => {
      const a = autoOf(c, t);
      const ids = (a.scenarios || []).concat(a.ids || []);
      return el("div", {}, [
        el("span", { class: "chip", text: t }), " ", el("span", { text: a.status || "none" }),
        a.reason ? el("span", { class: "muted", text: ` (${a.reason})` }) : null,
        ids.length ? el("div", {}, ids.map((i) => [idChip(i), " "])) : null,
        (a.files || []).length ? el("div", {}, a.files.map((f) => [link(f), " "])) : null,
      ]);
    }));
  };

  const resultCell = (r) => {
    const rs = results(r.c);
    if (!rs.length) return el("span", { class: "muted", text: "no result yet" });
    return el("div", {}, rs.map((x) => el("div", { title: x.title || "" }, [
      glyph(resultState[x.status] || "unverified"), el("span", { text: `${x.framework} ${x.status}` }),
      x.attempts > 1 ? el("span", { class: "muted", text: ` ×${x.attempts}` }) : null,
      x.passedOnRetry ? el("span", { class: "chip", text: "passed on retry" }) : null,
      x.triageClass ? el("span", { class: "chip", text: x.triageClass }) : null,
    ])));
  };

  const body = el("div", {});
  const counts = el("div", { class: "toolbar" });
  const render = () => {
    const all = modules.flatMap((m) => m.cases);
    counts.replaceChildren(
      el("span", { text: `${all.length} cases` }), " · ",
      el("span", { text: `${all.filter(approved).length} approved` }), " · ",
      el("span", { text: `${all.filter(automated).length} automated` }), " · ",
      el("span", { text: `${all.filter(passing).length} passing` }),
    );
    const list = rows();
    const notes = missing.map((m) => el("div", { class: "muted", text: `not available: ${m.reason}${m.module ? ` (${m.module})` : ""}` }));
    if (!list.length) {
      body.replaceChildren(...notes, empty(all.length ? "No cases match the filters." : "No test cases yet."));
      return;
    }
    body.replaceChildren(...notes, table([{ key: "case", label: "Case" }, { key: "auto", label: "Automation" }, { key: "result", label: "Last result" }], list, (r, k) => (k === "case" ? caseCell(r) : k === "auto" ? autoCell(r) : resultCell(r))));
  };

  const select = (name, label, options) => {
    const s = el("select", { name, aria: { label }, on: { change: (e) => { filters[name] = e.target.value; render(); } } },
      [["", label]].concat(options.map((o) => [o, o])).map(([v, t]) => el("option", { value: v, text: t })));
    s.value = filters[name];
    return s;
  };
  const gaps = el("input", { type: "checkbox", name: "gaps", on: { change: (e) => { filters.gaps = !!e.target.checked; render(); } } });

  const bar = el("div", { class: "toolbar" }, [
    select("module", "All modules", modules.map((m) => m.module)),
    select("type", "All types", ["ui", "api", "performance"]),
    el("label", {}, gaps, " gaps only"),
  ]);
  render();
  return el("div", {}, [el("div", { class: "section-title", text: "Traceability" }), counts, bar, body]);
}
