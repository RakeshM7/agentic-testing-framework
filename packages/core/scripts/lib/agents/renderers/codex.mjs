// OpenAI Codex agent file (.codex/agents/<name>.toml), read by the Codex CLI, the Codex app and the IDE extension.
// Required keys: name, description, developer_instructions. Codex has no per-agent tool list, sandbox or MCP servers (a
// subagent inherits its parent's), so none is written: the guard enforces each agent's permissions through
// .codex/hooks.json, and the MCP servers go into .codex/config.toml's atf block (lib/codex-config.mjs).
// `model` comes from config/models.yaml (`inherit`: the agent runs the session's model, so no key is written).
// UNVERIFIED (Codex spike pending, docs/codex-spike/): the keys model, and [features] shell_tool, are as
// learn.chatgpt.com/docs describe them.
import { generatedNote } from "./common.mjs";

const ESCAPES = { "\\": "\\\\", '"': '\\"', "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r" };
const hex = (c) => "\\u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0");

// text -> a one-line TOML basic string: \ and " escaped, every control character (and DEL) escaped.
export const tomlString = (text) =>
  '"' + String(text).replace(/[\\"\u0000-\u001F\u007F]/g, (c) => ESCAPES[c] ?? hex(c)) + '"';

// A literal string holds no control character but tab, and CR only before LF (a bare CR is not allowed).
const LITERAL_UNSAFE = /'''|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|\r(?!\n)/;

// body -> a TOML multi-line string value (the opening delimiter's newline is trimmed by TOML, the closing one is the
// body's last line ending, so the value is exactly the body): a literal string when the body allows it, else a basic one.
export function tomlMultiline(body, eol) {
  if (!LITERAL_UNSAFE.test(body)) return `'''${eol}${body}${eol}'''`;
  const escaped = body
    .replace(/\\/g, "\\\\")
    .replace(/"{3,}/g, (m) => '\\"'.repeat(m.length))
    .replace(/\r(?!\n)/g, "\\r")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, hex);
  return `"""${eol}${escaped}${eol}"""`;
}

export function render({ name, meta, body, eol, caps, model, fw = "", installed = false, dev }) {
  const lines = [generatedNote(name, fw, installed, dev), `name = ${tomlString(name)}`, `description = ${tomlString(meta.description.trim())}`];
  if (model && model !== "inherit") lines.push(`model = ${tomlString(model)}`);
  // the body's own leading and trailing line breaks are dropped: the closing ''' on its own line ends the value with one
  lines.push(`developer_instructions = ${tomlMultiline(body.replace(/^(?:\r?\n)+/, "").replace(/(?:\r?\n)+$/, ""), eol)}`);
  // defence in depth, never the authority (the guard is): an agent whose permissions give it no shell gets no shell tool
  if (!caps.shell) lines.push("", "[features]", "shell_tool = false");
  return lines.join(eol) + eol;
}
