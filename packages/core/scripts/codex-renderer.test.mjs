// The Codex renderer (renderers/codex.mjs): exact TOML for representative bodies, and that developer_instructions and
// description round-trip through a tiny TOML string reader (the repo has no TOML parser; Codex will parse the file).
import test from "node:test";
import assert from "node:assert/strict";
import { render, tomlString } from "./lib/agents/renderers/codex.mjs";
import { generatedNote, isGenerated } from "./lib/agents/renderers/common.mjs";

const caps = (shell = true) => ({ shell });
const make = (over = {}) =>
  render({ name: "pw-ui-fixer", meta: { description: "Does a thing." }, body: "Line one\nLine two\n", eol: "\n", tools: [], caps: caps(), model: "inherit", fw: "packages/core", ...over });

// Reads the value of a TOML string starting at `src[i]` (basic, literal, multi-line either): { value, end }.
function readString(src, i) {
  const ml = src.startsWith('"""', i) || src.startsWith("'''", i);
  const q = src[i];
  const delim = ml ? q.repeat(3) : q;
  i += delim.length;
  if (ml) i += src.startsWith("\r\n", i) ? 2 : src[i] === "\n" ? 1 : 0; // a newline right after the opening is trimmed
  let value = "";
  for (;;) {
    if (i >= src.length) throw new Error("unterminated string");
    if (src.startsWith(delim, i) && !(ml && src.startsWith(delim + q, i))) return { value, end: i + delim.length };
    if (src.startsWith(delim, i)) { value += q; i++; continue; } // 4+ quotes: the extra ones belong to the value
    const c = src[i];
    if (q === "'") {
      assert.ok(!/[\u0000-\u0008\u000A-\u001F\u007F]/.test(c) || (ml && (c === "\n" || (c === "\r" && src[i + 1] === "\n"))), `control char in literal at ${i}`);
      value += c; i++; continue;
    }
    if (c === "\\") {
      const n = src[i + 1];
      const map = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
      if (n in map) { value += map[n]; i += 2; continue; }
      if (n === "u") { value += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)); i += 6; continue; }
      throw new Error(`bad escape \\${n}`);
    }
    assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(c) && (c !== "\r" || src[i + 1] === "\n"), `control char in basic string at ${i}`);
    value += c; i++;
  }
}
const valueOf = (text, key) => {
  const m = new RegExp(`^${key} = `, "m").exec(text);
  assert.ok(m, `${key} present`);
  return readString(text, m.index + m[0].length).value;
};

const NOTE = "# GENERATED from packages/core/agents/pw-ui-fixer.md by packages/core/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.";

test("exact output for a plain body: marker first, name, description, literal developer_instructions, no model", () => {
  assert.equal(make(), `${NOTE}\nname = "pw-ui-fixer"\ndescription = "Does a thing."\ndeveloper_instructions = '''\nLine one\nLine two\n'''\n`);
  assert.equal(make().split("\n")[0], generatedNote("pw-ui-fixer", "packages/core"));
});

test("a model other than inherit is written as model; inherit writes none", () => {
  assert.match(make({ model: "gpt-x" }), /^description = .*\nmodel = "gpt-x"\ndeveloper_instructions = /m);
  assert.doesNotMatch(make({ model: "inherit" }), /^model/m);
});

test("[features] shell_tool = false only for an agent with no shell, after every top-level key", () => {
  assert.doesNotMatch(make(), /features|shell_tool/);
  const t = make({ caps: caps(false) });
  assert.ok(t.endsWith("'''\n\n[features]\nshell_tool = false\n"));
  assert.ok(t.indexOf("developer_instructions") < t.indexOf("[features]"));
});

test("description is a basic string: backslash, quote, newline and control characters escaped", () => {
  const d = 'He said "hi" \\ path\n\ttab\u0001 \u007f end';
  assert.equal(tomlString(d), '"He said \\"hi\\" \\\\ path\\n\\ttab\\u0001 \\u007F end"');
  const text = make({ meta: { description: `  ${d}  ` } });
  assert.ok(text.split("\n")[2].startsWith("description = ") && text.split("\n")[3].startsWith("developer_instructions"), "the description stays on one line");
  assert.equal(valueOf(text, "description"), d);
});

test("backslashes and quotes in a body stay literal and round-trip", () => {
  const body = 'Run `a\\b` and say "hi" and \'x\' and \'\'two\n\\n is not a newline\n';
  const text = make({ body });
  assert.ok(text.includes(`developer_instructions = '''\n${body}'''`));
  assert.equal(valueOf(text, "developer_instructions"), body, "the body's own last line break, once");
});

test("a body containing ''' falls back to a multi-line basic string with \\ and \"\"\" escaped", () => {
  const body = "a '''b''' c \\ d \"q\" \"\"\"e\"\"\"\"\" f\n";
  const text = make({ body });
  assert.ok(text.includes('developer_instructions = """\na \'\'\'b\'\'\' c \\\\ d "q" \\"\\"\\"e\\"\\"\\"\\"\\" f\n"""\n'), text);
  assert.equal(valueOf(text, "developer_instructions"), body, "the body's own last line break, once");
});

test("control characters and a bare CR also force the basic form, escaped", () => {
  const body = "x\u0001y\rz\n";
  const text = make({ body });
  assert.ok(text.includes('"""\nx\\u0001y\\rz\n"""'));
  assert.equal(valueOf(text, "developer_instructions"), body, "the body's own last line break, once");
});

test("CRLF eol: every line ends CRLF, in both string forms, and the value round-trips", () => {
  const body = "one\r\ntwo\r\n";
  const lit = make({ body, eol: "\r\n" });
  assert.equal(lit, `${NOTE}\r\nname = "pw-ui-fixer"\r\ndescription = "Does a thing."\r\ndeveloper_instructions = '''\r\none\r\ntwo\r\n'''\r\n`);
  assert.doesNotMatch(lit, /[^\r]\n/);
  assert.equal(valueOf(lit, "developer_instructions"), body);
  const basic = make({ body: "a ''' b\r\nc\r\n", eol: "\r\n", caps: caps(false) });
  assert.doesNotMatch(basic, /[^\r]\n/);
  assert.ok(basic.includes('developer_instructions = """\r\na \'\'\' b\r\nc\r\n"""\r\n'));
  assert.equal(valueOf(basic, "developer_instructions"), "a ''' b\r\nc\r\n");
  assert.ok(basic.endsWith("[features]\r\nshell_tool = false\r\n"));
});

test("the output always ends with the eol; an empty body is still valid", () => {
  assert.ok(make({ body: "" }).endsWith("'''\n"));
  assert.equal(valueOf(make({ body: "" }), "developer_instructions"), "\n");
  assert.ok(make({ body: "no trailing newline" }).endsWith("\n"));
});

test("an installed workspace's note is the first line too, and the file counts as generated", () => {
  const text = make({ installed: true });
  assert.match(text.split("\n")[0], /^# GENERATED by atf sync from @testagentic\/atf \(agents\/pw-ui-fixer\.md\)/);
  assert.ok(isGenerated(text));
});

test("isGenerated: the markdown marker still works, a TOML first line (BOM allowed) counts, a later or foreign line does not", () => {
  assert.ok(isGenerated(`---\n${generatedNote("a", "packages/core")}\nname: a\n---\n`));
  assert.ok(isGenerated(`---\r\n# GENERATED by atf sync from x\r\n`));
  assert.ok(isGenerated(make()));
  assert.ok(isGenerated("﻿# GENERATED from x by y\nname = \"a\"\n"));
  assert.ok(!isGenerated('name = "a"\n# GENERATED from x\n'));
  assert.ok(!isGenerated("# GENERATED other\n"));
  assert.ok(!isGenerated("# my own agent\nname = \"a\"\n"));
  assert.ok(!isGenerated("---\nname: a\n---\n"));
});
