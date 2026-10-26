// A dependency-free TypeScript scanner shared by the script-built code writers (D-055 ui-code, D-056 api-code): tokens
// with comments, strings, template literals and regular expressions handled, call arguments, bracket matching and every
// function with its parameters. No compiler needed: the framework has no TypeScript dependency.

// One escape sequence of a string, a template or an identifier, at src[i] (the backslash), decoded the way JavaScript
// decodes it: \xHH, \uHHHH, \u{H…}, a legacy octal, a line continuation (nothing), a single-character escape.
// -> {value (cooked), raw (the escape's source), end}
export function readEscape(src, i) {
  const c = src[i + 1];
  const at = (value, end) => ({ value, raw: src.slice(i, end), end });
  if (c === undefined) return at("", i + 1);
  if (c === "\r") return at("", src[i + 2] === "\n" ? i + 3 : i + 2);
  if (c === "\n" || c === " " || c === " ") return at("", i + 2);
  if (c === "x" && /^[0-9a-f]{2}$/i.test(src.slice(i + 2, i + 4))) return at(String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)), i + 4);
  if (c === "u" && src[i + 2] === "{") {
    const close = src.indexOf("}", i + 3);
    const hex = close < 0 ? "" : src.slice(i + 3, close);
    if (/^[0-9a-f]{1,8}$/i.test(hex) && parseInt(hex, 16) <= 0x10ffff) return at(String.fromCodePoint(parseInt(hex, 16)), close + 1);
  }
  if (c === "u" && /^[0-9a-f]{4}$/i.test(src.slice(i + 2, i + 6))) return at(String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16)), i + 6);
  const octal = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(src.slice(i + 1, i + 4));
  if (octal) return at(String.fromCharCode(parseInt(octal[0], 8)), i + 1 + octal[0].length);
  return at({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v" }[c] ?? c, i + 2);
}

// -> [{type: ident|str|tpl|regex|num|punct|comment, value, line, start, end, escapes?, cooked?}]. Strings and
// identifiers are cooked (every escape decoded, so \x75 or \u{75} can't hide a name from a rule); escapes: the raw
// escape sequences of a string, an identifier or a template's own text. A template literal without ${} is a str, with
// one a tpl (value: its source; cooked: its text parts joined). Comments are kept, for the reason rule.
export function scanTs(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  const prevSig = () => {
    for (let k = toks.length - 1; k >= 0; k--) if (toks[k].type !== "comment") return toks[k];
    return null;
  };
  const regexOk = () => {
    const p = prevSig();
    if (!p) return true;
    if (p.type === "punct") return !/^[)\]}]$/.test(p.value);
    if (p.type === "ident") return /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(p.value);
    return false;
  };
  // A template literal from its opening backtick: -> {end, cooked, dynamic, escapes}
  const template = (from) => {
    let j = from + 1;
    let cooked = "";
    let dynamic = false;
    const escapes = [];
    while (j < n && src[j] !== "`") {
      if (src[j] === "\\") {
        const e = readEscape(src, j);
        cooked += e.value;
        escapes.push(e.raw);
        j = e.end;
      } else if (src[j] === "$" && src[j + 1] === "{") {
        dynamic = true;
        let depth = 1;
        j += 2;
        while (j < n && depth) {
          const c = src[j];
          if (c === "`") j = template(j).end;
          else if (c === "'" || c === '"') {
            j++;
            while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
            j++;
          } else {
            if (c === "{") depth++;
            else if (c === "}") depth--;
            j++;
          }
        }
      } else cooked += src[j++];
    }
    return { end: j + 1, cooked, dynamic, escapes };
  };
  while (i < n) {
    const c = src[i];
    const start = i;
    const at = line;
    const push = (type, value, more) => {
      line += (src.slice(start, i).match(/\n/g) ?? []).length;
      toks.push({ type, value, line: at, start, end: i, ...more });
    };
    const escaped = (escapes) => (escapes.length ? { escapes } : undefined);
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      push("comment", src.slice(start, i));
    } else if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      push("comment", src.slice(start, i));
    } else if (c === "'" || c === '"') {
      i++;
      let v = "";
      const escapes = [];
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") {
          const e = readEscape(src, i);
          v += e.value;
          escapes.push(e.raw);
          i = e.end;
        } else v += src[i++];
      }
      i++;
      push("str", v, escaped(escapes));
    } else if (c === "`") {
      const t = template(i);
      i = t.end;
      push(t.dynamic ? "tpl" : "str", t.dynamic ? src.slice(start, i) : t.cooked, { cooked: t.cooked, ...escaped(t.escapes) });
    } else if (c === "/" && regexOk()) {
      i++;
      let cls = false;
      while (i < n && src[i] !== "\n" && (cls || src[i] !== "/")) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") cls = true;
        else if (src[i] === "]") cls = false;
        i++;
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      push("regex", src.slice(start, i));
    } else if (/[A-Za-z_$]/.test(c) || (c === "\\" && src[i + 1] === "u")) {
      // an identifier, its \u escapes decoded: constr\u{75}ctor is the name constructor
      let v = "";
      const escapes = [];
      while (i < n && (/[\w$]/.test(src[i]) || (src[i] === "\\" && src[i + 1] === "u"))) {
        if (src[i] === "\\") {
          const e = readEscape(src, i);
          v += e.value;
          escapes.push(e.raw);
          i = Math.max(e.end, i + 2);
        } else v += src[i++];
      }
      push("ident", v, escaped(escapes));
    } else if (/\d/.test(c)) {
      while (i < n && /[\w.]/.test(src[i])) i++;
      push("num", src.slice(start, i));
    } else if (src.startsWith("?.", i) && !/\d/.test(src[i + 2] ?? "")) {
      i += 2;
      push("punct", ".");
    } else if (src.startsWith("...", i) || src.startsWith("=>", i)) {
      i += src[i] === "." ? 3 : 2;
      push("punct", src.slice(start, i));
    } else if ("=!<>".includes(c)) {
      while (i < n && "=!<>".includes(src[i])) i++;
      push("punct", src.slice(start, i));
    } else {
      i++;
      push("punct", c);
    }
  }
  return toks;
}

// The arguments of the call whose "(" is sig[open]: [[tokens]] (top-level commas split them), and the index of ")".
export function callArgs(sig, open) {
  const args = [[]];
  let depth = 0;
  for (let k = open + 1; k < sig.length; k++) {
    const t = sig[k];
    if (t.type === "punct" && "([{".includes(t.value)) depth++;
    if (t.type === "punct" && ")]}".includes(t.value)) {
      if (depth === 0) return { args: args.filter((a, x) => a.length || x === 0), close: k };
      depth--;
    }
    if (depth === 0 && t.type === "punct" && t.value === ",") args.push([]);
    else args.at(-1).push(t);
  }
  return { args, close: sig.length };
}
export const isOpen = (t) => t?.type === "punct" && "([{".includes(t.value);
export const isClose = (t) => t?.type === "punct" && ")]}".includes(t.value);
export function matchClose(sig, open) {
  let d = 0;
  for (let k = open; k < sig.length; k++) {
    if (isOpen(sig[k])) d++;
    else if (isClose(sig[k]) && --d === 0) return k;
  }
  return sig.length;
}
export function matchOpen(sig, close) {
  let d = 0;
  for (let k = close; k >= 0; k--) {
    if (isClose(sig[k])) d++;
    else if (isOpen(sig[k]) && --d === 0) return k;
  }
  return -1;
}

const CONTROL_KW = new Set(["if", "for", "while", "switch", "catch", "with", "return", "typeof", "await", "new", "super", "import", "else", "do", "yield", "in", "of"]);
const MODIFIERS = new Set(["public", "private", "protected", "readonly", "override"]);

// The parameters between sig[open] "(" and sig[close] ")": [{name, string}] (string: typed exactly `string`).
export function paramsOf(sig, open, close) {
  const out = [];
  let cur = [];
  let d = 0;
  const flush = () => {
    const toks = cur.filter((t, i) => !(i === 0 && MODIFIERS.has(t.value)) && !(MODIFIERS.has(t.value) && cur.slice(0, i).every((x) => MODIFIERS.has(x.value))));
    const first = toks[0];
    if (first) {
      const colon = toks.findIndex((t) => t.value === ":");
      const eq = toks.findIndex((t) => t.value === "=");
      const type = colon < 0 ? [] : toks.slice(colon + 1, eq < 0 ? undefined : eq);
      out.push({ name: first.type === "ident" ? first.value : null, string: type.length === 1 && type[0].value === "string" });
    }
    cur = [];
  };
  for (let k = open + 1; k < close; k++) {
    const t = sig[k];
    if (isOpen(t)) d++;
    if (isClose(t)) d--;
    if (d === 0 && t.value === ",") flush();
    else cur.push(t);
  }
  flush();
  return out;
}

// Every function of a file: methods, functions and arrows. -> [{name|null, params, async, from, to, returnsOnly}], with
// from..to the body's token range; returnsOnly: a block body that is only `return <expression>`.
export function functionsOf(sig) {
  const fns = [];
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    if (t.type !== "punct") continue;
    if (t.value === "=>") {
      const p = sig[k - 1];
      let params = [];
      const name = null;
      let async = false;
      if (p?.value === ")") {
        const o = matchOpen(sig, k - 1);
        params = paramsOf(sig, o, k - 1);
        async = sig[o - 1]?.value === "async";
        // an arrow stays anonymous: its call sites (`pick(…)`, `this.pick(…)` of a field) can't be traced like a
        // method's, so a locator built from its parameter is a finding; data-driven locators are methods
      } else if (p?.type === "ident") params = [{ name: p.value, string: false }];
      if (sig[k + 1]?.value === "{") {
        const to = matchClose(sig, k + 1);
        fns.push({ name, params, async, from: k + 2, to, returnsOnly: sig[k + 2]?.value === "return" });
      } else {
        let d = 0;
        let j = k + 1;
        for (; j < sig.length; j++) {
          if (isOpen(sig[j])) d++;
          else if (isClose(sig[j])) {
            if (d === 0) break;
            d--;
          } else if (d === 0 && [",", ";"].includes(sig[j].value)) break;
        }
        fns.push({ name, params, async, from: k + 1, to: j, returnsOnly: true });
      }
      continue;
    }
    if (t.value !== "{") continue;
    // a method or function body: `name(params)[: ReturnType] {`
    let j = k - 1;
    for (let n = 0; j >= 0 && n < 40 && sig[j].value !== ")"; j--, n++) if ([";", "{", "}", "="].includes(sig[j].value)) break;
    if (sig[j]?.value !== ")" || (j !== k - 1 && sig[j + 1]?.value !== ":")) continue;
    const o = matchOpen(sig, j);
    const nameTok = sig[o - 1];
    if (!nameTok || nameTok.type !== "ident" || CONTROL_KW.has(nameTok.value)) continue;
    const name = nameTok.value === "function" ? null : nameTok.value;
    const async = [sig[o - 2]?.value, sig[o - 3]?.value].includes("async");
    const to = matchClose(sig, k);
    fns.push({ name, params: paramsOf(sig, o, j), async, from: k + 1, to, returnsOnly: sig[k + 1]?.value === "return" });
  }
  return fns;
}
