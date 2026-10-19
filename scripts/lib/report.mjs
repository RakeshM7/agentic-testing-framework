// The run report (G11, docs/conventions.md "Script-built agents"): a slide deck rendered deterministically from the
// schema-validated report.json (scripts/report-data.mjs) and the agent's cited narrative overlay (narrative.json).
// Every number, table and chart comes from report.json; the narrative is checked against it: a number in a statement
// must equal a number at one of its cited paths and every cited path must exist. A passing `check` stamps
// report-check.json (lib/verified.mjs) over report.json, narrative.json and index.html; the `report` stage requires it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stampVerified, unverifiedReason } from "./verified.mjs";

const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "report");
const FRAMEWORK_LABEL = { "playwright-ui": "Playwright UI", "playwright-api": "Playwright API", k6: "k6" };
const LIMIT = 20;

// results/<run>/report/: report.json (report-data.mjs), narrative.json (the agent's), index.html and report-check.json (report.mjs)
export function reportPaths(productDir, runId) {
  const dir = path.join(productDir, "results", runId ?? "-", "report");
  return { dir, report: path.join(dir, "report.json"), narrative: path.join(dir, "narrative.json"), html: path.join(dir, "index.html"), state: path.join(dir, "report-check.json") };
}

const inputsOf = (rp) => ({ report: rp.report, narrative: rp.narrative, html: rp.html });
export const stampReport = (rp) => stampVerified(inputsOf(rp));

// null when report-check.json matches report.json, narrative.json and index.html on disk, else why not (what the stage reads)
export function reportUnverified(rp) {
  if (!existsSync(rp.state)) return "report.mjs check never passed (no report-check.json)";
  let state;
  try {
    state = JSON.parse(readFileSync(rp.state, "utf8"));
  } catch {
    return "report-check.json is not valid JSON";
  }
  return unverifiedReason(state.verified, inputsOf(rp), { unstamped: "report.mjs check never passed", changed: "report.json, narrative.json or index.html changed after report.mjs check" });
}

// ---------- citations ----------

const SEG = /^(?:\.?([A-Za-z_][A-Za-z0-9_-]*)|\[(\d+)\]|\[([A-Za-z_][A-Za-z0-9_]*)=([^\][]+)\])/;

// -> {found: boolean, value} for a path like totals.approvals.awaiting, bugs[0].id or modules[module=contacts].testcases
export function resolveCite(data, cite) {
  let cur = data;
  let rest = String(cite);
  while (rest) {
    const m = SEG.exec(rest);
    if (!m) return { found: false };
    rest = rest.slice(m[0].length);
    if (m[1] !== undefined) {
      if (cur === null || typeof cur !== "object" || Array.isArray(cur) || !Object.hasOwn(cur, m[1])) return { found: false };
      cur = cur[m[1]];
    } else if (m[2] !== undefined) {
      if (!Array.isArray(cur) || Number(m[2]) >= cur.length) return { found: false };
      cur = cur[Number(m[2])];
    } else {
      if (!Array.isArray(cur)) return { found: false };
      const item = cur.find((x) => x && typeof x === "object" && String(x[m[3]]) === m[4]);
      if (item === undefined) return { found: false };
      cur = item;
    }
  }
  return { found: cur !== undefined, value: cur };
}

// every number inside a value, plus the length of every array in it
function numbersIn(v, out = new Set()) {
  if (typeof v === "number") out.add(v);
  else if (Array.isArray(v)) {
    out.add(v.length);
    for (const x of v) numbersIn(x, out);
  } else if (v && typeof v === "object") for (const x of Object.values(v)) numbersIn(x, out);
  return out;
}

// the numbers a statement writes (digits not part of an id, a date or a word)
export function numbersOf(text) {
  return [...String(text).matchAll(/(?<![\w.-])\d+(?:,\d{3})*(?:\.\d+)?(?![\w-]|\.\d)/g)].map((m) => Number(m[0].replaceAll(",", "")));
}

const SECTIONS = ["executiveSummary", "risks", "recommendations"];

// -> problems[]: a cited path that does not exist, a number that no cited path holds
export function narrativeProblems(report, narrative) {
  const problems = [];
  for (const sec of SECTIONS)
    (narrative[sec] ?? []).forEach((s, i) => {
      const where = `${sec}[${i}]`;
      const held = new Set();
      let missing = false;
      for (const c of s.cites) {
        const r = resolveCite(report, c);
        if (!r.found) {
          problems.push(`${where}: cites '${c}', which is not in report.json`);
          missing = true;
        } else numbersIn(r.value, held);
      }
      if (missing) return;
      for (const n of numbersOf(s.text)) if (!held.has(n)) problems.push(`${where}: the number ${n} is not at any cited path (cited values hold: ${[...held].sort((a, b) => a - b).join(", ") || "no numbers"})`);
    });
  return problems;
}

// ---------- rendering ----------

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => (n === null || n === undefined ? "n/a" : String(n));
const code = (s) => `<code>${esc(s)}</code>`;
const badge = (s, cls = "") => `<span class="badge${cls ? ` ${cls}` : ""}">${esc(s)}</span>`;

function table(caption, head, rows, { numeric = [] } = {}) {
  const th = head.map((h, i) => `<th scope="col"${numeric.includes(i) ? ' class="num"' : ""}>${esc(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c, i) => `<td${numeric.includes(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("");
  return `<table><caption>${esc(caption)}</caption><thead><tr>${th}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}">None</td></tr>`}</tbody></table>`;
}

// the first LIMIT rows of a list, and a line saying how many more report.json holds
const capped = (list, at) => ({ shown: list.slice(0, LIMIT), more: list.length > LIMIT ? `<p class="muted">and ${list.length - LIMIT} more in report.json (${esc(at)})</p>` : "" });

function bars(title, rows, segs) {
  const w = 760, lab = 170, rh = 26;
  const h = rows.length * rh + 8;
  const max = Math.max(1, ...rows.map((r) => segs.reduce((n, s) => n + (r.values[s.key] ?? 0), 0)));
  const unit = (w - lab - 70) / max;
  const label = `${title}: ${rows.map((r) => `${r.label} ${segs.map((s) => `${r.values[s.key] ?? 0} ${s.name}`).join(", ")}`).join("; ")}`;
  const g = rows.map((r, i) => {
    let x = lab;
    const y = 4 + i * rh;
    const parts = segs.map((s) => {
      const v = r.values[s.key] ?? 0;
      const seg = v ? `<rect class="${s.cls}" x="${x}" y="${y}" width="${(v * unit).toFixed(1)}" height="18"><title>${esc(r.label)}: ${v} ${esc(s.name)}</title></rect>` : "";
      x += v * unit;
      return seg;
    });
    const total = segs.reduce((n, s) => n + (r.values[s.key] ?? 0), 0);
    return `<text x="0" y="${y + 14}">${esc(r.label.slice(0, 26))}</text>${parts.join("")}<text x="${(x + 6).toFixed(1)}" y="${y + 14}">${total}</text>`;
  });
  const legend = `<p class="legend">${segs.map((s) => `<span><svg width="12" height="12" aria-hidden="true"><rect class="${s.cls}" width="12" height="12"/></svg> ${esc(s.name)}</span>`).join("")}</p>`;
  return `<svg role="img" aria-label="${esc(label)}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${g.join("")}</svg>${legend}`;
}

const EXEC_SEGS = [{ key: "passed", name: "passed", cls: "b-pass" }, { key: "failed", name: "failed", cls: "b-fail" }, { key: "flaky", name: "flaky", cls: "b-flaky" }, { key: "skipped", name: "skipped", cls: "b-skip" }];
const COV_SEGS = [{ key: "mapped", name: "mapped", cls: "b-pass" }, { key: "excluded", name: "excluded", cls: "b-skip" }, { key: "deferred", name: "deferred", cls: "b-flaky" }, { key: "pending", name: "pending", cls: "b-fail" }];

const slide = (id, title, body) => `<section class="slide" id="${id}" aria-labelledby="${id}-h"><h2 id="${id}-h">${esc(title)}</h2>${body}</section>`;

function statements(list, withSeverity) {
  if (!list.length) return `<p class="muted">None.</p>`;
  return `<ul>${list.map((s) => `<li>${withSeverity ? `${badge(s.severity, `sev-${s.severity}`)} ` : ""}${esc(s.text)}<span class="cites">Source: ${s.cites.map(code).join(", ")}</span></li>`).join("")}</ul>`;
}

export function renderDeck(report, narrative = null) {
  const t = report.totals;
  const slides = [];
  const gaps = (section) => report.missing.filter((m) => m.section === section);
  const gapNote = (section) => (gaps(section).length ? `<div class="callout gap" role="note"><strong>Data not available (${gaps(section).length}):</strong> ${gaps(section).slice(0, 6).map((m) => `${m.module ? `${esc(m.module)}: ` : ""}${esc(m.reason)}`).join("; ")}${gaps(section).length > 6 ? "; more under Data gaps" : ""}</div>` : "");

  slides.push(`<section class="slide" id="s-title" aria-labelledby="s-title-h"><h1 id="s-title-h">${esc(report.product)}: test run report</h1>
<p>Target: ${code(report.target)}</p><p>Run: ${code(report.runId)} &middot; ${esc(report.generatedAt.slice(0, 10))}</p>
<p>Mode: <strong>${esc(report.mode)}</strong>${report.mode === "readonly" ? " &mdash; nothing that changes data was run; mutating tests and k6 load were not executed." : " &mdash; mutating tests ran; deletes were limited to entities this run created."}</p></section>`);

  const tile = (n, l) => `<div class="tile"><div class="n">${esc(num(n))}</div><div class="l">${esc(l)}</div></div>`;
  slides.push(slide("s-glance", "At a glance", `<div class="tiles">${[
    tile(`${t.modulesExplored} / ${t.modules}`, "modules explored"),
    tile(`${t.clarifications.answered} / ${t.clarifications.total}`, "clarifications answered"),
    tile(t.testcases, "test cases"),
    tile(t.approvals.awaiting, "test cases awaiting approval"),
    tile(t.playwrightUiSpecs, "Playwright UI specs"),
    tile(t.playwrightApiSpecs, "Playwright API specs"),
    tile(t.k6Scripts, "k6 scripts"),
    tile(t.triage.bugClusters.length, "product bug clusters"),
    tile(t.stages.failed + t.stages.blocked, "failed or blocked stages"),
    tile(t.missing, "data gaps"),
  ].join("")}</div>`));

  if (narrative) slides.push(slide("s-summary", "Executive summary", statements(narrative.executiveSummary, false)));

  slides.push(slide("s-modules", "Modules", gapNote("modules") + gapNote("testcases") + table("Per module", ["Module", "Explored", "Clarifications answered / total", "Unconfirmed", "Test cases", "UI specs", "API specs", "k6 scripts"],
    report.modules.map((m) => [esc(m.module), m.explored ? "yes" : "no", `${m.clarifications.answered} / ${m.clarifications.total}`, num(m.clarifications.unconfirmed), num(m.testcases), num(m.playwrightUiSpecs), num(m.playwrightApiSpecs), m.k6Planned === null ? `${m.k6Scripts} (no workload)` : `${m.k6Scripts} / ${m.k6Planned}`]), { numeric: [3, 4, 5, 6] })));

  for (const fw of Object.keys(FRAMEWORK_LABEL)) {
    const rows = report.modules.map((m) => ({ m, r: m.results[fw] }));
    const ran = rows.filter((x) => x.r && x.r.status === "ran");
    const e = t.execution[fw];
    slides.push(slide(`s-${fw}`, `${FRAMEWORK_LABEL[fw]} results`,
      gapNote("results") +
        `<p>${e.passed} passed, ${e.failed} failed, ${e.flaky} flaky, ${e.skipped} skipped of ${e.total}; ${e.modulesRun} modules run, ${e.modulesNotRun} not run, ${e.modulesNoResults} without results.</p>` +
        (ran.length ? bars(`${FRAMEWORK_LABEL[fw]} results per module`, ran.map((x) => ({ label: x.m.module, values: x.r.totals })), EXEC_SEGS) : `<p class="muted">No module ran this framework.</p>`) +
        table("Modules not run or without results", ["Module", "State", "Reason"], rows.filter((x) => !x.r || x.r.status !== "ran").map((x) => [esc(x.m.module), x.r ? "not run" : "no results", esc(x.r?.reason ?? "results.json is missing")]))));
  }

  const classes = Object.entries(t.triage.byClass).sort(([a], [b]) => a.localeCompare(b));
  const bugRows = capped(report.bugs, "bugs");
  slides.push(slide("s-bugs", "Triage and product bugs",
    (t.triage.unverified.length ? `<div class="callout gap" role="note">Triage not verified for ${t.triage.unverified.map((u) => `${esc(u.module)} (${esc(u.framework)})`).join(", ")}.</div>` : "") +
      (classes.length ? bars("Triage rows by class", classes.map(([label, n]) => ({ label, values: { n } })), [{ key: "n", name: "rows", cls: "b-acc" }]) : `<p class="muted">No triage rows.</p>`) +
      table("Product bug clusters", ["Bug", "Module", "Severity", "Title", "Affected", "Evidence"], bugRows.shown.map((b) => [code(b.id), esc(b.module), b.severity ? badge(b.severity, `sev-${b.severity}`) : "no draft", esc(b.title ?? "no bug draft written"), b.affected.map(code).join(" "), b.evidence.map(code).join(" ") || "none"])) + bugRows.more));

  const apprRows = report.queues.testcaseApprovals;
  const clar = capped(report.queues.clarifications, "queues.clarifications");
  slides.push(slide("s-queues", "Waiting for a human",
    gapNote("approvals") +
      table("Test cases awaiting approval", ["Module", "Awaiting", "Changes requested", "Rejected", "Approved", "Sheet"], apprRows.map((a) => [esc(a.module), num(a.awaiting), num(a.changes), num(a.rejected), num(a.approved), a.approvalCsv ? code(a.approvalCsv) : "not built yet"]), { numeric: [1, 2, 3, 4] }) +
      table("Clarifications unanswered or awaiting approval", ["Id", "Module", "State", "Question", "Next step"], clar.shown.map((c) => [code(c.id), esc(c.module), esc(c.kind), esc(c.question), esc(c.nextStep ?? "")])) + clar.more));

  const ledgers = report.coverage.ledgers;
  const avail = ledgers.filter((l) => l.available);
  const deferred = capped(avail.flatMap((l) => l.deferred.map((d) => [esc(l.ledger), esc(l.module ?? "product"), code(d.id), esc(d.detail ?? "")])), "coverage.ledgers[].deferred");
  const reasons = {};
  for (const l of avail) for (const x of l.excluded) reasons[`${l.ledger}|${x.reason}`] = (reasons[`${l.ledger}|${x.reason}`] ?? 0) + 1;
  slides.push(slide("s-coverage", "Coverage and deferrals",
    gapNote("coverage") +
      (avail.length ? bars("Coverage items per ledger", avail.map((l) => ({ label: `${l.ledger}${l.module ? `: ${l.module}` : ""}`, values: l.counts })), COV_SEGS) : `<p class="muted">No coverage ledger is available.</p>`) +
      table("Ledgers", ["Ledger", "Module", "Total", "Mapped", "Excluded", "Deferred", "Pending"], ledgers.map((l) => [esc(l.ledger), esc(l.module ?? "product"), ...(l.available ? [l.counts.total, l.counts.mapped, l.counts.excluded, l.counts.deferred, l.counts.pending].map(String) : [`<em>not available: ${esc(l.reason)}</em>`, "", "", "", ""])]), { numeric: [2, 3, 4, 5, 6] }) +
      table("Deferred by budget", ["Ledger", "Module", "Item", "Detail"], deferred.shown) + deferred.more +
      table("Excluded, by reason", ["Ledger", "Reason", "Items"], Object.entries(reasons).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => [esc(k.split("|")[0]), esc(k.split("|")[1]), String(n)]), { numeric: [2] })));

  const a = report.assumptions;
  const thr = capped(a.k6Thresholds, "assumptions.k6Thresholds");
  const cases = capped(a.assumptionCases, "assumptions.assumptionCases");
  const facts = capped(a.ruleFacts, "assumptions.ruleFacts");
  slides.push(slide("s-assumptions", "Assumptions and known limits",
    gapNote("assumptions") + gapNote("k6") +
      table("k6 thresholds that are assumed, not from an SLO", ["Script", "Scenario", "Endpoint", "Metric", "Limit"], thr.shown.map((x) => [code(x.script), esc(x.scenario), esc(x.endpoint ?? ""), esc(x.metric), esc(x.limit)])) + thr.more +
      table("@assumption test cases", ["Module", "Case", "Assumes"], cases.shown.map((x) => [esc(x.module), code(x.id), esc(x.assumptions.join("; "))])) + cases.more +
      table("Knowledge rule facts resting on weaker evidence", ["Module", "Evidence", "Fact"], facts.shown.map((x) => [esc(x.module), esc(x.evidence), esc(x.text)])) + facts.more +
      table("Known limits of the exploration", ["Limit", "Source"], a.knownLimits.map((x) => [esc(x.text), code(x.source)])) +
      table("Entities this run created and left live", ["Type", "Reference", "Module", "Stage"], a.k6Leftovers.slice(0, LIMIT).map((x) => [esc(x.type), code(x.ref), esc(x.module ?? ""), esc(x.stage ?? "")])) +
      table("k6 creates whose id could not be read", ["Script", "Run", "Creates", "Types", "File"], a.k6Untracked.map((x) => [code(x.script), x.retry ? "retry" : "first", String(x.creates), esc(x.types.join(", ")), code(x.file)]), { numeric: [2] })));

  const findings = (f) => (f && f.length ? `<ul>${f.slice(0, 5).map((x) => `<li>${esc(typeof x === "string" ? x : [x.severity, x.location, x.reason ?? x.summary ?? x.title].filter(Boolean).join(" ") || JSON.stringify(x))}</li>`).join("")}</ul>${f.length > 5 ? `<p class="muted">and ${f.length - 5} more findings in report.json</p>` : ""}` : "");
  slides.push(slide("s-stages", "Stages that did not finish",
    table("Failed", ["Stage", "Attempts", "Error and open findings"], report.failedStages.map((s) => [code(s.key), String(s.attempts), esc(s.error ?? "") + findings(s.findings)]), { numeric: [1] }) +
      table("Blocked by a failed stage", ["Stage"], report.blockedStages.map((s) => [code(s.key)])) +
      table("Awaiting human approval", ["Stage"], report.awaitingApprovalStages.map((s) => [code(s.key)])) +
      table("Incomplete", ["Stage", "Status", "Problems"], report.incompleteStages.map((s) => [code(s.key), esc(s.status), esc(s.problems.join("; "))]))));

  if (narrative) slides.push(slide("s-risks", "Risks and recommendations", `<h3>Risks</h3>${statements(narrative.risks, true)}<h3>Recommendations</h3>${statements(narrative.recommendations, false)}`));

  const gapList = capped(report.missing, "missing");
  slides.push(slide("s-gaps", "Data gaps", report.missing.length ? table("Sources that were absent or unreadable", ["Section", "Module", "Reason"], gapList.shown.map((m) => [esc(m.section), esc(m.module ?? "product"), esc(m.reason)])) + gapList.more : `<p>Every data source was present.</p>`));

  const read = (f) => readFileSync(path.join(templateDir, f), "utf8").replace(/\r\n/g, "\n").trimEnd();
  const fill = { title: `${report.product} test run report`, css: read("deck.css"), js: read("deck.js"), slides: slides.join("\n") };
  return read("deck.html").replace(/\{\{(title|css|js|slides)\}\}/g, (_, k) => (k === "title" ? esc(fill.title) : fill[k])) + "\n";
}

