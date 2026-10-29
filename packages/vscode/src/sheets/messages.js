// The messages between a sheet's webview and the extension, validated on both sides. Pure; no vscode.
//
// The webview is untrusted input to the extension (its script renders text a script or an agent wrote, so treat it as
// able to send anything): validateWebviewMessage accepts only the known types with the exact fields and bounded sizes,
// and every edit is validated again by the sheet model at save time. The other way, validateHostMessage is embedded in
// the webview's script (by its source text, see webview.js), so it must stay self-contained: no references to anything
// outside its own body.

export const LIMITS = { rows: 5000, text: 32000, id: 200, path: 1000 };

const isObj = (m) => !!m && typeof m === "object" && !Array.isArray(m);
const str = (v, max) => typeof v === "string" && v.length <= max;
const only = (m, keys) => Object.keys(m).every((k) => keys.includes(k));

function editOk(kind, e) {
  if (!isObj(e) || !str(e.id, LIMITS.id) || !e.id) return false;
  if (kind === "clarifications") return only(e, ["id", "answer", "approve"]) && str(e.answer, LIMITS.text) && typeof e.approve === "boolean";
  return only(e, ["id", "approved", "comment"]) && str(e.approved, 16) && str(e.comment, LIMITS.text);
}

// kind: "clarifications" | "approval". -> { ok: true, message } | { ok: false, error }
export function validateWebviewMessage(m, kind) {
  if (!["clarifications", "approval"].includes(kind)) return { ok: false, error: `unknown sheet kind '${kind}'` };
  if (!isObj(m) || typeof m.type !== "string") return { ok: false, error: "a message is an object with a type" };
  const bad = (why) => ({ ok: false, error: `${m.type}: ${why}` });
  switch (m.type) {
    case "ready":
    case "revert":
    case "reload":
    case "openText":
      return only(m, ["type"]) ? { ok: true, message: { type: m.type } } : bad("takes no fields");
    case "approveModule":
      if (kind !== "approval") return bad("only the approval sheet approves a module");
      return only(m, ["type"]) ? { ok: true, message: { type: m.type } } : bad("takes no fields");
    case "draft":
    case "save": {
      if (!only(m, ["type", "edits"]) || !Array.isArray(m.edits)) return bad("needs edits: []");
      if (m.edits.length > LIMITS.rows) return bad(`at most ${LIMITS.rows} edits`);
      if (!m.edits.every((e) => editOk(kind, e))) return bad(kind === "clarifications" ? "each edit is { id, answer, approve }" : "each edit is { id, approved, comment }");
      return { ok: true, message: { type: m.type, edits: m.edits.map((e) => ({ ...e })) } };
    }
    case "openEvidence": {
      if (kind !== "clarifications") return bad("only the clarifications sheet has evidence");
      if (!only(m, ["type", "id", "file"]) || !str(m.id, LIMITS.id) || !str(m.file, LIMITS.path) || !m.id || !m.file) return bad("needs id and file");
      return { ok: true, message: { type: m.type, id: m.id, file: m.file } };
    }
    default:
      return { ok: false, error: `unknown message type '${m.type}'` };
  }
}

// The extension's messages, checked by the webview before it renders anything. Self-contained (embedded by source).
export function validateHostMessage(m) {
  const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
  const s = (x) => typeof x === "string";
  if (!isObj(m) || !s(m.type)) return false;
  if (m.type === "status") return s(m.level) && ["info", "warning", "error"].includes(m.level) && s(m.text);
  if (m.type !== "load") return false;
  if (!["clarifications", "approval"].includes(m.kind) || !s(m.title) || typeof m.readOnly !== "boolean") return false;
  if (m.error !== null && !s(m.error)) return false;
  if (m.readOnlyReason !== undefined && !s(m.readOnlyReason)) return false;
  if (m.notice !== undefined && m.notice !== null && !(isObj(m.notice) && s(m.notice.text) && ["info", "warning", "error"].includes(m.notice.level))) return false;
  if (!Array.isArray(m.draft)) return false;
  if (m.error !== null) return m.sheet === null;
  const v = m.sheet;
  if (!isObj(v) || !Array.isArray(v.rows) || !isObj(v.counts)) return false;
  const text = (r, keys) => keys.every((k) => s(r[k]));
  if (m.kind === "clarifications")
    return v.rows.every((r) => isObj(r) && text(r, ["id", "question", "steps", "answer", "answerStatus", "notes", "runId", "state"]) && Array.isArray(r.problems) && Array.isArray(r.evidence) && r.evidence.every(s));
  return v.rows.every((r) => isObj(r) && text(r, ["id", "title", "keySteps", "expected", "priority", "approved", "comment", "run", "version", "sheet", "recorded"]));
}
