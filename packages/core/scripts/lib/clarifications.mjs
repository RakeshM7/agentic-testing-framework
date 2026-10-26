// Product-level clarifications CSV: artifacts/<product>/modules/<module>/clarifications.csv
// The ONLY code that writes this file. Agents and humans share it, so every agent write is a locked
// read-modify-write that preserves rows/cells it does not own, and human-entered Answers are never overwritten
// (unless the incoming requirement changed the behavior -- an explicit, recorded flag).
//
// Columns (fixed order): ID | Module | Question | Steps to execute | Answer | Answer status | Clarification agent notes | Run ID
//   ID             <module>-<n>, n = per-module sequence, assigned here, never reused
//   Answer status  agent-proposed (an agent recorded it; downstream treats it as an assumption until a human approves),
//                  human-approved (a human approved the agent's answer), human (a human wrote it). An answer with an
//                  empty status was typed by a human, or predates the column (D-048).
//   Run ID         the run that CREATED the row; never changed afterwards
//
// The clarification-explorer records a row's outcome as a structured outcome.json (recordOutcome): the script checks
// it against the row's evidence before anything is written -- cited files exist, quoted product text appears in the
// captured evidence, created entities are in the ledger -- and leaves record.json beside the evidence as proof.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, serializeCsv } from "./csv.mjs";
import { withFileLock, writeAtomic } from "./files.mjs";

export const HEADERS = ["ID", "Module", "Question", "Steps to execute", "Answer", "Answer status", "Clarification agent notes", "Run ID"];
const KEYS = ["id", "module", "question", "steps", "answer", "answerStatus", "notes", "runId"];
// The layout before the Answer status column (D-048); read as is and rewritten in the current layout on the next write.
const LEGACY_HEADERS = HEADERS.filter((h) => h !== "Answer status");
const LEGACY_KEYS = KEYS.filter((k) => k !== "answerStatus");
export const UNRESOLVED_POLICIES = ["stop", "continue-flagged"];
export const ANSWER_STATUSES = ["agent-proposed", "human-approved", "human"];

export const csvPath = (productDir, module) => path.join(productDir, "modules", module, "clarifications.csv");
export const evidenceDir = (file, id) => path.join(path.dirname(file), "clarification-evidence", id);
const clean = (s) => String(s ?? "").trim();
// The de-duplication key of a question; read-only, also used by scripts/lib/explore.mjs to link a new-questions.json
// entry to the row it was appended as.
export const normQuestion = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const isAnswered = (r) => clean(r.answer) !== "";
// Answered by a human, or an agent's answer a human approved. Downstream relies on these; anything else is an assumption.
export const isAuthoritative = (r) => isAnswered(r) && ["human", "human-approved"].includes(r.answerStatus);

function normStatus(raw, answered) {
  const s = clean(raw).toLowerCase().replace(/[\s_]+/g, "-");
  if (!answered) return s;
  if (!s) return "human";
  return s === "approved" ? "human-approved" : s;
}

export function readRows(file) {
  if (!existsSync(file)) return [];
  const rows = parseCsv(readFileSync(file, "utf8"));
  if (!rows.length) return [];
  const header = rows[0].map(clean);
  const same = (h) => header.length >= h.length && h.every((x, i) => header[i] === x) && header.slice(h.length).every((x) => !x);
  const keys = same(HEADERS) ? KEYS : same(LEGACY_HEADERS) ? LEGACY_KEYS : null;
  if (!keys) throw new Error(`${file}: header must be exactly: ${HEADERS.join(" | ")}`);
  return rows.slice(1).map((r, i) => {
    if (r.slice(keys.length).some((c) => clean(c))) throw new Error(`${file}: row ${i + 2} has values beyond the ${keys.length} columns`);
    const row = Object.fromEntries(KEYS.map((k) => [k, r[keys.indexOf(k)] ?? ""]));
    row.answerStatus = normStatus(row.answerStatus, isAnswered(row));
    return row;
  });
}

export function ensureCsv(file) {
  if (!existsSync(file)) writeAtomic(file, serializeCsv([HEADERS]));
}

const write = (file, rows) => writeAtomic(file, serializeCsv([HEADERS, ...rows.map((r) => KEYS.map((k) => r[k] ?? ""))]));

function nextNumber(rows, module) {
  const re = new RegExp(`^${module}-(\\d+)$`);
  return rows.reduce((n, r) => Math.max(n, Number(re.exec(clean(r.id))?.[1] ?? 0)), 0) + 1;
}

// items: [{question, steps}] -> appends genuinely new questions (normalized-text de-dup within the module).
// raisedBy: the row whose exploration raised them (a clarification-explorer follow-up); their notes say so, and that
// they wait for the next run (orchestration.mjs explores only the rows open when the domain started).
export function append(file, module, runId, items, { raisedBy } = {}) {
  return withFileLock(file, () => {
    const rows = readRows(file);
    const seen = new Map(rows.map((r) => [normQuestion(r.question), r.id]));
    const added = [];
    const duplicates = [];
    let n = nextNumber(rows, module);
    for (const it of items) {
      if (!clean(it.question) || !clean(it.steps)) throw new Error("each item needs a non-empty 'question' and 'steps'");
      const k = normQuestion(it.question);
      if (seen.has(k)) {
        duplicates.push({ question: clean(it.question), existingId: seen.get(k) });
        continue;
      }
      const notes = raisedBy ? `[${runId}] raised while exploring ${raisedBy}; explored in the next run.\nNext step: answer it directly, or let the next run explore it.` : "";
      const row = { id: `${module}-${n++}`, module, question: clean(it.question), steps: it.steps.trim(), answer: "", answerStatus: "", notes, runId };
      rows.push(row);
      seen.set(k, row.id);
      added.push(row.id);
    }
    if (added.length) write(file, rows);
    return { added, duplicates };
  });
}

function update(file, id, fn) {
  return withFileLock(file, () => {
    const rows = readRows(file);
    const row = rows.find((r) => clean(r.id) === id);
    if (!row) throw new Error(`${id}: no such row in ${file}`);
    fn(row);
    write(file, rows);
    return row;
  });
}

// module-explorer: rewrite Question/Steps of a row that is still unanswered (labels changed since it was written).
export function setSteps(file, id, { question, steps }) {
  return update(file, id, (row) => {
    if (isAnswered(row)) throw new Error(`${id} is already answered; Question/Steps are frozen`);
    if (question !== undefined) row.question = clean(question);
    if (steps !== undefined) row.steps = String(steps).trim();
  });
}

// Record the outcome of a row: module-explorer's requirement changes, and the script's own "no valid record" verdict.
// (clarification-explorer records through recordOutcome.)
//   answer -> the behavior; an agent's answer is agent-proposed until a human approves it
//   notes  -> why still unconfirmed / what was tried / evidence path, with a "Next step: ..." line for a human
// An answered row is trusted as is: changing it requires requirementChange=true, which is stamped into the notes.
export function record(file, id, { answer, notes, runId, requirementChange = false }) {
  return update(file, id, (row) => {
    if (isAnswered(row) && !requirementChange)
      throw new Error(`${id} is already answered (possibly by a human); it is trusted as is unless --requirement-change`);
    if (answer !== undefined) {
      row.answer = String(answer).trim();
      row.answerStatus = row.answer ? "agent-proposed" : "";
    }
    if (notes !== undefined) row.notes = String(notes).trim();
    if (requirementChange) row.notes = [row.notes, `[${runId}] updated: incoming requirement changed this behavior`].filter(Boolean).join("\n");
  });
}

// ---------- the clarification-explorer's outcome (outcome.json -> CSV + record.json) ----------

export const VERDICTS = ["confirmed", "unconfirmed", "blocked"];
export const REASONS = {
  unconfirmed: ["needs-full-run", "inconsistent", "evidence-insufficient", "steps-ambiguous", "element-not-found"],
  blocked: ["auth", "no-access", "environment", "precondition-missing", "guard-denied", "no-valid-record"],
};
const SCRIPT_REASONS = ["no-valid-record"]; // set by orchestration.mjs only
const BASIS_RE = /^(observed|network|dom|documented:S\d+)$/;
const OUTCOME_KEYS = ["verdict", "reason", "answer", "basis", "quotes", "evidence", "summary", "nextStep", "created", "followUps"];
const ANSWER_KEYS = ["context", "action", "result", "scope"];
const TEXT_EXT = /\.(md|txt|json|ya?ml|html?|log)$/i;
// Quoted product text in the Result: "..." or curly quotes.
const QUOTED = /"([^"\n]+)"|“([^”\n]+)”/g;
const squash = (s) => String(s).replace(/\s+/g, " ").trim();

// ctx: {id, mode, runId, ledgerEntries: [{event, type, ref, runId}], sourceIds: Set<"S1"...>, resolve(rel) -> abs path}
// -> problems[] (empty = the outcome may be recorded)
export function checkOutcome(o, ctx) {
  const problems = [];
  const P = (m) => problems.push(m);
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["outcome must be a JSON object"];
  for (const k of Object.keys(o)) if (!OUTCOME_KEYS.includes(k)) P(`unknown key '${k}' (allowed: ${OUTCOME_KEYS.join(", ")})`);
  if (!VERDICTS.includes(o.verdict)) return [...problems, `verdict must be one of ${VERDICTS.join(" | ")}`];
  const list = (k) => (o[k] === undefined ? [] : Array.isArray(o[k]) ? o[k] : (P(`${k} must be a list`), []));
  const basis = list("basis");
  const quotes = list("quotes");
  const evidence = list("evidence");
  const created = list("created");
  const followUps = list("followUps");

  if (o.verdict === "confirmed") {
    if (o.reason !== undefined) P("a confirmed outcome has no reason");
    for (const k of ["summary", "nextStep"]) if (o[k] !== undefined) P(`a confirmed outcome has no ${k}`);
    const a = o.answer;
    if (!a || typeof a !== "object") P(`a confirmed outcome needs answer {${ANSWER_KEYS.join(", ")}}`);
    else {
      for (const k of Object.keys(a)) if (!ANSWER_KEYS.includes(k)) P(`answer: unknown key '${k}'`);
      for (const k of ANSWER_KEYS) if (typeof a[k] !== "string" || !clean(a[k])) P(`answer.${k} must be a non-empty string`);
    }
    if (!basis.length) P("a confirmed outcome needs at least one basis: observed, network, dom or documented:S<n>");
  } else {
    if (!REASONS[o.verdict].includes(o.reason)) P(`a ${o.verdict} outcome needs reason one of ${REASONS[o.verdict].join(" | ")}`);
    else if (SCRIPT_REASONS.includes(o.reason)) P(`reason '${o.reason}' is set by the orchestration script only`);
    if (o.answer !== undefined) P(`a ${o.verdict} outcome has no answer; leave the Answer to a human`);
    for (const k of ["summary", "nextStep"]) if (typeof o[k] !== "string" || !clean(o[k])) P(`a ${o.verdict} outcome needs a non-empty ${k}`);
  }
  if (o.reason === "needs-full-run" && ctx.mode === "full-run") P("reason needs-full-run, but this run is full-run: do the step, or give the real reason");

  // evidence: files relative to the module (or knowledge/... relative to the product), all present, incl. observation.md
  const own = `clarification-evidence/${ctx.id}/`;
  const files = [];
  for (const e of evidence) {
    if (typeof e !== "string" || !e || path.isAbsolute(e) || e.split(/[\\/]/).includes("..")) {
      P(`evidence '${e}': must be a path relative to the module (or knowledge/...), without '..'`);
      continue;
    }
    const rel = e.replaceAll("\\", "/");
    if (!existsSync(ctx.resolve(rel))) P(`evidence '${rel}' does not exist`);
    else files.push(rel);
  }
  const observation = `${own}observation.md`;
  if (!evidence.map((e) => String(e).replaceAll("\\", "/")).includes(observation)) P(`evidence must include ${observation}`);
  else if (files.includes(observation)) {
    const v = /^Verdict:\s*(\S+)/m.exec(readFileSync(ctx.resolve(observation), "utf8"))?.[1];
    if (v !== o.verdict) P(`${observation} says 'Verdict: ${v ?? "(none)"}', the outcome says '${o.verdict}'`);
  }
  const captures = files.filter((f) => f !== observation && !/\/(outcome|record|follow-ups)\.json$/.test(f));
  const base = (f) => path.posix.basename(f);

  for (const b of basis) {
    if (typeof b !== "string" || !BASIS_RE.test(b)) {
      P(`basis '${b}': must be observed, network, dom or documented:S<n>`);
      continue;
    }
    if (b === "observed" && !captures.some((f) => f.startsWith(own))) P("basis observed needs a capture of this row in evidence (a screenshot, snapshot, network or console file)");
    if (b === "network" && !captures.some((f) => /^network/i.test(base(f)))) P("basis network needs a network-<n>.txt capture in evidence");
    if (b === "dom" && !captures.some((f) => /^snapshot/i.test(base(f)) || f.startsWith("explore/"))) P("basis dom needs a snapshot-<n> capture or an explore/ DOM snapshot in evidence");
    if (b.startsWith("documented:") && !ctx.sourceIds.has(b.slice("documented:".length))) P(`basis ${b}: no such source in knowledge/sources.json`);
  }

  // every quote -- listed, or "..." in the Result -- must appear verbatim in a captured text file
  const fromResult = o.answer && typeof o.answer.result === "string" ? [...o.answer.result.matchAll(QUOTED)].map((m) => m[1] ?? m[2]) : [];
  const allQuotes = [...new Set([...quotes, ...fromResult].map(squash).filter(Boolean))];
  const texts = captures.filter((f) => TEXT_EXT.test(f)).map((f) => squash(readFileSync(ctx.resolve(f), "utf8")));
  for (const q of allQuotes) if (!texts.some((t) => t.includes(q))) P(`quote "${q}" appears in no captured text file in evidence (snapshot, network, console or knowledge); quote the product exactly`);

  for (const c of created) {
    if (!c || typeof c.type !== "string" || typeof c.ref !== "string") {
      P("created entries are {type, ref}");
      continue;
    }
    if (ctx.mode !== "full-run") P(`created ${c.type} '${c.ref}': a readonly run creates nothing`);
    else if (!ctx.ledgerEntries.some((e) => e.event === "created" && e.runId === ctx.runId && e.type === c.type && e.ref === c.ref))
      P(`created ${c.type} '${c.ref}' is not in state/ledger.jsonl for this run; add it with ledger.mjs add right after creating it`);
  }
  for (const f of followUps) if (!f || !clean(f.question) || !clean(f.steps)) P("followUps entries are {question, steps}, both non-empty");
  return problems;
}

export const renderAnswer = (o) =>
  [`Basis: ${o.basis.join(", ")}`, `Context: ${clean(o.answer.context)}`, `Action: ${clean(o.answer.action)}`, `Result: ${clean(o.answer.result)}`, `Scope: ${clean(o.answer.scope)}`].join("\n");

function renderNotes(o, id, runId) {
  const ev = `Evidence: clarification-evidence/${id}/observation.md`;
  if (o.verdict === "confirmed")
    return [`[${runId}] confirmed by clarification-explorer (${o.basis.join(", ")}).`, ev, "Awaiting approval: set Answer status to human-approved, or correct the Answer and set it to human."].join("\n");
  return [`[${runId}] ${o.verdict} (${o.reason}): ${clean(o.summary)}`, ev, `Next step: ${clean(o.nextStep)}`].join("\n");
}

// ctx: {id, module, runId, mode, ledgerEntries, sourceIds, productDir}
// -> {id, verdict, answerStatus, followUps} | throws with every problem (nothing is written then)
export function recordOutcome(file, outcome, ctx) {
  const moduleDir = path.dirname(file);
  const resolve = (rel) => (rel.startsWith("knowledge/") ? path.join(ctx.productDir, rel) : path.join(moduleDir, rel));
  const problems = checkOutcome(outcome, { ...ctx, resolve });
  if (problems.length) throw new Error(`${ctx.id}: outcome not recorded:\n- ${problems.join("\n- ")}`);
  const row = update(file, ctx.id, (r) => {
    if (isAnswered(r)) throw new Error(`${ctx.id} is already answered (possibly by a human); it is trusted as is`);
    if (outcome.verdict === "confirmed") {
      r.answer = renderAnswer(outcome);
      r.answerStatus = "agent-proposed";
    } else r.answerStatus = "";
    r.notes = renderNotes(outcome, ctx.id, ctx.runId);
  });
  const followUps = outcome.followUps?.length ? append(file, ctx.module, ctx.runId, outcome.followUps, { raisedBy: ctx.id }) : { added: [], duplicates: [] };
  const rec = {
    id: ctx.id,
    runId: ctx.runId,
    mode: ctx.mode,
    at: new Date().toISOString(),
    verdict: outcome.verdict,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(outcome.basis ? { basis: outcome.basis } : {}),
    evidence: outcome.evidence,
    created: outcome.created ?? [],
    followUps,
  };
  writeAtomic(path.join(evidenceDir(file, ctx.id), "record.json"), JSON.stringify(rec, null, 2) + "\n");
  return { id: ctx.id, verdict: outcome.verdict, answerStatus: row.answerStatus, followUps };
}

// The proof a row was recorded in this run: record.json from recordOutcome. -> object | null
export function readRecord(file, id) {
  const f = path.join(evidenceDir(file, id), "record.json");
  try {
    return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
  } catch {
    return null;
  }
}

// ---------- status, summary, stage check ----------

export function status(file) {
  const rows = readRows(file);
  const open = rows.filter((r) => !isAnswered(r));
  const proposed = rows.filter((r) => isAnswered(r) && !isAuthoritative(r));
  return { total: rows.length, answered: rows.length - open.length, proposed: proposed.map((r) => clean(r.id)), unconfirmed: open.map((r) => clean(r.id)) };
}

export const summaryPath = (file) => path.join(path.dirname(file), "clarifications-summary.md");

// What a human should do next for an unanswered row: its notes' "Next step:" line, else their first line.
function nextStep(r) {
  const lines = clean(r.notes).split(/\r?\n/).map(clean).filter(Boolean);
  const next = lines.find((l) => /^next step:/i.test(l));
  return next ? clean(next.replace(/^next step:/i, "")) : lines[0] ?? `no notes recorded; see clarification-evidence/${clean(r.id)}/`;
}

// clarifications-summary.md, rendered from the CSV alone, so it always agrees with it. Written even when the module
// has no rows: the clarifications stage requires the file.
export function renderSummary(file, module) {
  const rows = readRows(file);
  const { total, answered, proposed } = status(file);
  const cell = (s) => clean(s).replace(/\r?\n+/g, " ").replace(/\|/g, "\\|");
  const unconfirmed = rows.filter((r) => !isAnswered(r)).map((r) => ({ id: clean(r.id), next: nextStep(r) }));
  const shown = (r) => (!isAnswered(r) ? "Unconfirmed" : isAuthoritative(r) ? cell(r.answer) : `${cell(r.answer)} _(${r.answerStatus || "no status"}: awaiting human approval)_`);
  const text = [
    `# Clarifications -- ${module}`,
    "",
    `Answered: ${answered} / ${total} (awaiting approval: ${proposed.length}) · Unconfirmed: ${total - answered}`,
    "",
    "| ID | Question | Answer or status |",
    "|---|---|---|",
    ...rows.map((r) => `| ${cell(r.id)} | ${cell(r.question)} | ${shown(r)} |`),
    "",
    "## Needs a human",
    ...(unconfirmed.length ? unconfirmed.map((u) => `- ${u.id}: ${cell(u.next)}`) : ["None."]),
    "",
    "## Awaiting approval",
    "Agent answers are assumptions downstream until a human sets Answer status to human-approved (or corrects the Answer and sets it to human).",
    ...(proposed.length ? proposed.map((id) => `- ${id}`) : ["None."]),
    "",
  ].join("\n");
  writeAtomic(summaryPath(file), text);
  return { file: summaryPath(file), total, answered, proposed, unconfirmed };
}

// Stage-completion check used by run.mjs (contract CHECKS). Policy comes from the run-config.
// An agent-proposed answer counts as answered here (D-048): the run goes on, and test cases treat it as an assumption.
export function checkComplete(file, { clarificationsPolicy = "stop" } = {}) {
  let rows;
  try {
    rows = readRows(file);
  } catch (e) {
    return [e.message];
  }
  const problems = [];
  for (const r of rows) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*-\d+$/.test(clean(r.id))) problems.push(`row '${r.id}': ID must be <module>-<n>`);
    if (!clean(r.question) || !clean(r.steps)) problems.push(`${r.id}: Question and Steps to execute are required`);
    if (!clean(r.runId)) problems.push(`${r.id}: Run ID is required`);
    if (isAnswered(r) && !ANSWER_STATUSES.includes(r.answerStatus))
      problems.push(`${r.id}: Answer status '${r.answerStatus}' must be one of ${ANSWER_STATUSES.join(" | ")} (or empty for an answer a human wrote)`);
    if (!isAnswered(r)) {
      if (clarificationsPolicy === "stop") problems.push(`${r.id}: unanswered -- a human must fill the Answer column (policy: stop)`);
      else if (!clean(r.notes)) problems.push(`${r.id}: unanswered rows need Clarification agent notes (policy: continue-flagged)`);
    }
  }
  return problems;
}
