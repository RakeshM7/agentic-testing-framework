// The scope rules of agent-written API code (D-056, B3): an allowlist, not a blocklist. Every identifier of agent code is
// declared in it, imported, or one of a few pure globals, and a pure global is only called, constructed or has an allowed
// member called; it is never a value (no alias, no argument, no spread, no destructuring), so no agent code can reach a
// built-in to change it. A member is assigned only on an object the same code created (a literal or a construction).
// Types are stripped first with Node's own type stripper, so only code that runs is read.
import * as nodeModule from "node:module";
import { finding } from "./gate/common.mjs";
import { isClose, isOpen, matchClose, scanTs } from "./ts-scan.mjs";

// The pure globals and how agent code may use each: call (`String(x)`), construct (`new Date()`), call a member
// (`Object.keys(x)`) or read a constant member (`Number.MAX_SAFE_INTEGER`).
export const PURE_GLOBALS = Object.freeze({
  String: { call: true },
  Number: { call: true, members: ["isInteger", "isFinite", "isNaN", "isSafeInteger", "parseInt", "parseFloat"], constants: ["MAX_SAFE_INTEGER", "MIN_SAFE_INTEGER", "EPSILON", "MAX_VALUE", "MIN_VALUE"] },
  Boolean: { call: true },
  Math: { members: ["abs", "ceil", "floor", "round", "trunc", "max", "min", "pow", "sqrt", "sign", "random"], constants: ["PI", "E"] },
  JSON: { members: ["parse", "stringify"] },
  Date: { call: true, construct: true, members: ["now", "UTC", "parse"] },
  Array: { members: ["isArray", "from", "of"] },
  Object: { members: ["keys", "entries", "values", "fromEntries", "freeze", "assign"] },
  Map: { construct: true },
  Set: { construct: true },
  URLSearchParams: { construct: true },
  Error: { construct: true },
  Promise: { members: ["all", "allSettled", "resolve"] },
  encodeURIComponent: { call: true },
  decodeURIComponent: { call: true },
  parseInt: { call: true },
  parseFloat: { call: true },
  isNaN: { call: true },
  isFinite: { call: true },
});
// Literal values and keywords: never a binding agent code could change.
// Every reserved word and keyword of JavaScript and TypeScript is a keyword, never an identifier (D-4, round 4), but
// `this` and `with`, which have their own findings below.
const KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof let new null of return static super switch throw true try typeof var void while yield async await from as get set implements interface package private protected public undefined NaN Infinity".split(" "));
const OWN_FINDING = { this: "uses this: agent code has no receiver", with: "uses with: it changes what every name inside it means" };
const CONTROL = new Set(["if", "for", "while", "switch", "catch", "with", "return", "typeof", "await", "new", "super", "import", "else", "do", "yield", "in", "of", "delete", "void", "throw", "case"]);
// Every global of the runtime and the module scope: agent code never declares one of these names (a shadow would let a
// misread declaration hide a global from the allowlist).
const GLOBAL_NAMES = new Set([...Object.getOwnPropertyNames(globalThis), ...Object.keys(PURE_GLOBALS), "require", "module", "exports", "__dirname", "__filename", "arguments", "undefined", "NaN", "Infinity", "eval", "Function", "Reflect", "Proxy", "Symbol", "globalThis", "global", "process", "window", "self"]);

// TypeScript to the JavaScript that runs, positions kept (types become spaces). wrap: the code is a function body (a
// slot). -> the code, or null when it does not parse.
export function stripTypes(code, { wrap = false } = {}) {
  const strip = nodeModule.stripTypeScriptTypes;
  if (typeof strip !== "function") return null;
  const head = "async function __slot__() {\n";
  const src = wrap ? `${head}${code}\n}` : String(code);
  const emit = process.emitWarning;
  process.emitWarning = () => {};
  try {
    const out = strip(src, { mode: "strip" });
    return wrap ? out.slice(head.length, out.length - 2) : out;
  } catch {
    return null;
  } finally {
    process.emitWarning = emit;
  }
}

// To the next "," or ";" at this depth, or the close of the enclosing bracket, or a statement keyword on a new line.
function skipExpr(sig, j, limit = sig.length) {
  let d = 0;
  for (; j < limit; j++) {
    const t = sig[j];
    if (isOpen(t)) d++;
    else if (isClose(t)) {
      if (d === 0) return j;
      d--;
    } else if (d === 0 && (t.value === "," || t.value === ";")) return j;
    else if (d === 0 && t.type === "ident" && ["const", "let", "var", "function", "class", "return", "if", "for", "while", "export", "import"].includes(t.value) && j > 0 && sig[j - 1].line < t.line) return j;
  }
  return j;
}
// The names a binding pattern at sig[k] declares (an identifier, an object or array pattern, with defaults and rests).
// -> the index after it
function binding(sig, k, add) {
  const t = sig[k];
  if (!t) return k + 1;
  if (t.value === "...") return binding(sig, k + 1, add);
  if (t.type === "ident") {
    add(t);
    return k + 1;
  }
  if (t.value !== "{" && t.value !== "[") return k + 1;
  const end = matchClose(sig, k);
  let j = k + 1;
  while (j < end) {
    const from = j;
    if (sig[j].value === ",") {
      j++;
      continue;
    }
    if (t.value === "{" && sig[j].value !== "...") {
      const keyEnd = sig[j].value === "[" ? matchClose(sig, j) + 1 : j + 1;
      if (sig[keyEnd]?.value === ":") j = binding(sig, keyEnd + 1, add);
      else {
        if (sig[j].type === "ident") add(sig[j]);
        j = keyEnd;
      }
    } else j = binding(sig, j, add);
    if (sig[j]?.value === "=") j = skipExpr(sig, j + 1, end);
    if (j <= from) j = from + 1;
  }
  return end + 1;
}
// Whether the "(" at sig[k] opens a parameter list: an arrow's, a function's or a method's.
function isParams(sig, k) {
  const c = matchClose(sig, k);
  if (sig[c + 1]?.value === "=>") return true;
  if (sig[c + 1]?.value !== "{") return false;
  const p = sig[k - 1];
  if (p?.value === "function") return true;
  if (p?.type !== "ident" || CONTROL.has(p.value)) return false;
  return ["function", "*", "{", ",", "}", ";", "get", "set", "async", "static"].includes(sig[k - 2]?.value) || sig[k - 2] === undefined;
}

// The names code declares: const, let, var (patterns too), function and class names, parameters, catch bindings and
// imports. -> {names, tokens} (tokens: each declaring identifier)
export function declaredNames(sig) {
  const tokens = [];
  const add = (t) => tokens.push(t);
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    const v = t.value;
    if (t.type === "ident" && ["const", "let", "var"].includes(v) && sig[k - 1]?.value !== ".") {
      let j = binding(sig, k + 1, add);
      while (sig[j]?.value === "=" || sig[j]?.value === ",") {
        if (sig[j].value === "=") j = skipExpr(sig, j + 1);
        if (sig[j]?.value === ",") j = binding(sig, j + 1, add);
      }
    } else if (t.type === "ident" && (v === "function" || v === "class") && sig[k - 1]?.value !== ".") {
      const n = sig[k + 1]?.value === "*" ? sig[k + 2] : sig[k + 1];
      if (n?.type === "ident") add(n);
    } else if (v === "catch" && sig[k + 1]?.value === "(") binding(sig, k + 2, add);
    else if (v === "(" && t.type === "punct" && isParams(sig, k)) {
      const c = matchClose(sig, k);
      let j = k + 1;
      while (j < c) {
        const from = j;
        j = binding(sig, j, add);
        if (sig[j]?.value === "=") j = skipExpr(sig, j + 1, c);
        if (sig[j]?.value === ",") j++;
        if (j <= from) j = from + 1;
      }
    } else if (v === "=>" && sig[k - 1]?.type === "ident") add(sig[k - 1]);
    else if (v === "import" && t.type === "ident" && sig[k + 1]?.value !== "(" && sig[k - 1]?.value !== ".") {
      for (let j = k + 1; j < sig.length && sig[j].type !== "str"; j++) {
        const x = sig[j];
        if (x.type !== "ident" || ["from", "as", "type"].includes(x.value)) continue;
        if (sig[j + 1]?.value === "as") continue; // `a as b`: b is the binding
        add(x);
      }
    }
  }
  return { names: new Set(tokens.map((t) => t.value)), tokens };
}

// The names this code creates itself, the only ones whose members it may assign: a const, let or var initialised with an
// object or array literal or a construction, never a parameter (any name inside a parameter list), never reassigned.
// Reads TypeScript or JavaScript tokens.
export function createdNames(sig) {
  const created = new Set();
  const demoted = new Set();
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    if (["const", "let", "var"].includes(t.value) && sig[k + 1]?.type === "ident") {
      let j = k + 2;
      if (sig[j]?.value === ":") for (let d = 0; j < sig.length && !(d === 0 && ["=", ";"].includes(sig[j].value)); j++) d += isOpen(sig[j]) ? 1 : isClose(sig[j]) ? -1 : 0;
      if (sig[j]?.value === "=" && ["{", "[", "new"].includes(sig[j + 1]?.value)) created.add(sig[k + 1].value);
    }
    // a parameter list (types kept or stripped): "(" … ")" followed by =>, a body or a return type
    if (t.value === "(" && t.type === "punct" && (isParams(sig, k) || [":", "=>", "{"].includes(sig[matchClose(sig, k) + 1]?.value))) for (let j = k + 1; j < matchClose(sig, k); j++) if (sig[j].type === "ident") demoted.add(sig[j].value);
    if (t.value === "=>" && sig[k - 1]?.type === "ident") demoted.add(sig[k - 1].value);
    if (t.type === "ident" && sig[k - 1]?.value !== "." && !["const", "let", "var"].includes(sig[k - 1]?.value) && (sig[k + 1]?.value === "=" || (["+", "-", "*", "/", "%", "|", "&", "?", "^"].includes(sig[k + 1]?.value) && sig[k + 2]?.value === "="))) demoted.add(t.value);
  }
  return new Set([...created].filter((n) => !demoted.has(n)));
}

// The ${} expressions of a template literal token's source.
function templateExprs(raw) {
  const out = [];
  let i = 1;
  while (i < raw.length - 1) {
    if (raw[i] === "\\") i += 2;
    else if (raw[i] === "$" && raw[i + 1] === "{") {
      const rest = raw.slice(i + 2);
      let d = 0;
      let end = rest.length;
      for (const t of scanTs(rest)) {
        if (t.type === "comment") continue;
        if (isOpen(t)) d++;
        else if (isClose(t)) {
          if (d === 0) {
            end = t.start;
            break;
          }
          d--;
        }
      }
      out.push(rest.slice(0, end));
      i += 2 + end + 1;
    } else i++;
  }
  return out;
}

// ---------- X1 (round 3): no property that reaches a constructor, a prototype or a caller; no computed access ----------

// The property names that walk from any value to the Function constructor, a prototype or a calling frame.
export const POISON_PROPERTIES = Object.freeze(["constructor", "prototype", "__proto__", "caller", "callee", "arguments"]);
const POISON = new Set(POISON_PROPERTIES);
// The escapes agent code may write in a string, a template or a name (D-1, round 4): none of them can spell a letter.
// \x, \u, \u{}, octal escapes and line continuations are findings (escape); the scanner decodes them all anyway.
export const SAFE_ESCAPES = new Set(["\\n", "\\t", "\\r", "\\\\", "\\'", '\\"', "\\`"]);
// A "[" after one of these opens an array literal or an array pattern (const [a, b] = …), never a member access.
const NOT_A_RECEIVER = new Set(["return", "typeof", "in", "of", "case", "await", "yield", "new", "delete", "void", "throw", "instanceof", "else", "do", "export", "extends", "default", "const", "let", "var"]);
// Whether the "[" at sig[k] reads a member: after a value (a name, a literal, a call, an index, `?.`), not an array literal.
function memberIndex(sig, k) {
  const p = sig[k - 1];
  if (!p) return false;
  if (p.type === "punct") return [")", "]", "}", "."].includes(p.value);
  if (p.type === "ident") return !NOT_A_RECEIVER.has(p.value);
  return ["str", "num", "regex", "tpl"].includes(p.type);
}
// The loop counters of code: `for (let|var i = <number>; …)`, declared once, only ever stepped by ++, --, += or -= a
// number, and never handed to a pattern, a spread or another binding. Only these may index a member (x[i]).
function loopCounters(sig) {
  const decls = new Map();
  for (const t of declaredNames(sig).tokens) decls.set(t.value, (decls.get(t.value) ?? 0) + 1);
  const out = new Set();
  for (let k = 0; k < sig.length; k++) {
    if (!(sig[k].value === "for" && sig[k + 1]?.value === "(" && ["let", "var"].includes(sig[k + 2]?.value) && sig[k + 3]?.type === "ident" && sig[k + 4]?.value === "=" && sig[k + 5]?.type === "num" && sig[k + 6]?.value === ";")) continue;
    const name = sig[k + 3].value;
    if (decls.get(name) !== 1) continue;
    let ok = true;
    for (let j = 0; j < sig.length && ok; j++) {
      const t = sig[j];
      if (j === k + 3 || t.type !== "ident" || t.value !== name) continue;
      const prev = sig[j - 1]?.value;
      const next = sig[j + 1]?.value;
      if (prev === "." || (["{", ","].includes(prev) && next === ":")) continue; // a property name, not the variable
      if (prev === "...") ok = false;
      else if (next === "=") ok = false;
      else if (["+", "-", "*", "/", "%", "|", "&", "^", "?", "<", ">"].includes(next) && sig[j + 2]?.value === "=" ) ok = ["+", "-"].includes(next) && sig[j + 3]?.type === "num";
      else if (["of", "in"].includes(next)) ok = false;
      else if ([",", "}", ":"].includes(next)) ok = false;
      else if (next === "]") ok = prev === "[" && memberIndex(sig, j - 1);
    }
    if (ok) out.add(name);
  }
  return out;
}

// The rules on every agent-written file and slot, on the JavaScript that runs (types stripped): no property named
// constructor, prototype, __proto__, caller, callee or arguments in any position (member access, a key, a destructuring
// key, renamed or nested, a string or a template's text, so not in an `in` check or a descriptor lookup either), and
// no computed member access or computed key but a number literal or a loop counter. code: TypeScript (a whole file, or
// a slot's body with wrap); at(token): the reported line. -> findings
export function propertyFindings(file, code, { wrap = false, at = (t) => t?.line ?? null, kind = "agent" } = {}) {
  const js = stripTypes(code, { wrap }) ?? String(code);
  return propertyRules(file, scanTs(js).filter((t) => t.type !== "comment"), at, kind);
}
function propertyRules(file, sig, at, kind, counters = loopCounters(sig)) {
  const out = [];
  const poison = (t, what) => out.push(finding("major", file, at(t), "forbidden-property", `${kind} code names ${what}: it reaches a constructor, a prototype or a calling frame`, `never name ${POISON_PROPERTIES.join(", ")} (as a member, a key, a destructuring key or a string); use plain data and the generated clients`));
  const computed = (t, inner) => out.push(finding("major", file, at(t), "computed-access", `${kind} code uses a computed member or key ([${inner.slice(0, 40)}])`, "use .name or a literal key; index only by a number literal or a for-loop counter"));
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    const bad = (t.escapes ?? []).find((e) => !SAFE_ESCAPES.has(e));
    if (bad !== undefined) out.push(finding("major", file, at(t), "escape", `${kind} code writes ${t.type === "ident" ? "a name" : "a string"} with the escape ${bad.replace(/\r?\n/, "<newline>")}: an escape can spell a name no rule sees`, `write the characters themselves; only ${[...SAFE_ESCAPES].join(" ")} are allowed`));
    if (t.type === "ident" && POISON.has(t.value)) poison(t, t.value);
    else if (t.type === "str" && (POISON.has(t.value.trim()) || t.value.includes("__proto__"))) poison(t, `'${t.value.slice(0, 40)}'`);
    else if (t.type === "tpl") {
      const exprs = templateExprs(t.value);
      // the template's own text, cooked (escapes decoded) and joined across its ${}
      if (POISON_PROPERTIES.some((n) => String(t.cooked ?? "").includes(n))) poison(t, "a property in a template literal");
      for (const e of exprs) out.push(...propertyRules(file, scanTs(e).filter((x) => x.type !== "comment").map((x) => ({ ...x, line: t.line })), at, kind, counters));
    } else if (t.value === "[" && t.type === "punct" && sig[k + 1]?.value !== "]") {
      const close = matchClose(sig, k);
      const keyed = ["{", ","].includes(sig[k - 1]?.value) && [":", "("].includes(sig[close + 1]?.value);
      if (!memberIndex(sig, k) && !keyed) continue;
      const inner = sig.slice(k + 1, close);
      const ok = inner.length === 1 && (inner[0].type === "num" || (inner[0].type === "ident" && counters.has(inner[0].value)));
      if (!ok) computed(t, inner.map((x) => x.value).join(" "));
    }
  }
  return out;
}

// The names a whole file declares (its imports, declarations and parameters), for the slots inside it. -> Set
export function scopeOf(code) {
  const js = stripTypes(code);
  return js === null ? new Set() : new Set([...declaredNames(scanTs(js).filter((t) => t.type !== "comment")).names].filter((n) => !GLOBAL_NAMES.has(n)));
}

// B3: the free identifiers of a piece of agent code. code: TypeScript (a whole file, or a slot's function body with
// wrap); declared: the names the code may use without declaring them (the generated file's own declarations and
// bindings); at(line): the reported line for a line of code. -> findings
export function freeIdentifierFindings(file, code, { declared = [], wrap = false, at = (line) => line } = {}) {
  const js = stripTypes(code, { wrap });
  if (js === null) return [finding("major", file, at(1), "free-identifier", "the code does not parse as TypeScript that only strips to JavaScript (no enum, namespace or other code-generating TypeScript)", "write plain TypeScript: types, functions and data")];
  return identifierFindings(file, scanTs(js).filter((t) => t.type !== "comment"), new Set(declared), at);
}
function identifierFindings(file, sig, outer, at) {
  const out = [];
  const push = (t, problem) => out.push(finding("major", file, at(t.line), "free-identifier", problem, "use only what this code declares or imports and the pure globals as calls (String(x), Object.keys(x), new Date()); never a built-in as a value"));
  const { names, tokens } = declaredNames(sig);
  for (const t of tokens) if (GLOBAL_NAMES.has(t.value)) push(t, `declares ${t.value}, a name of the runtime's globals`);
  const scope = new Set([...outer, ...[...names].filter((n) => !GLOBAL_NAMES.has(n))]);
  let inImport = false;
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    const prev = sig[k - 1];
    const next = sig[k + 1];
    if (t.type === "ident" && t.value === "import" && prev?.value !== ".") inImport = true;
    if (inImport) {
      if (t.type === "str" || t.value === ";") inImport = false;
      continue;
    }
    if (t.type === "tpl") {
      for (const expr of templateExprs(t.value)) out.push(...identifierFindings(file, scanTs(expr).filter((x) => x.type !== "comment").map((x) => ({ ...x, line: t.line })), scope, at));
      continue;
    }
    if (t.type !== "ident" || prev?.value === "." || KEYWORDS.has(t.value) || scope.has(t.value)) continue;
    // a property key, a method's name, a label
    if (["{", ","].includes(prev?.value) && next?.value === ":") continue;
    if (next?.value === "(" && sig[matchClose(sig, k + 1) + 1]?.value === "{" && ["{", ",", "}", ";", "get", "set", "async", "static", "*"].includes(prev?.value)) continue;
    if ([";", "{", "}"].includes(prev?.value) && next?.value === ":") continue;
    if (Object.hasOwn(OWN_FINDING, t.value)) {
      push(t, OWN_FINDING[t.value]);
      continue;
    }
    const g = Object.hasOwn(PURE_GLOBALS, t.value) ? PURE_GLOBALS[t.value] : null;
    if (!g) {
      push(t, `${t.value} is not declared here, imported, or an allowed pure global`);
      continue;
    }
    if (next?.value === "(" && g.call && prev?.value !== "new") continue;
    if (prev?.value === "new" && g.construct) continue;
    if (next?.value === "." && sig[k + 2]?.type === "ident") {
      const member = sig[k + 2].value;
      const called = sig[k + 3]?.value === "(";
      if (called && (g.members ?? []).includes(member)) continue;
      if (!called && (g.constants ?? []).includes(member) && !["=", "++", "--"].includes(sig[k + 3]?.value) && !(["+", "-", "*", "/", "%", "|", "&", "?", "^"].includes(sig[k + 3]?.value) && sig[k + 4]?.value === "=")) continue;
      push(t, `${t.value}.${member}${called ? "(…)" : ""} is not an allowed use of ${t.value}`);
      continue;
    }
    push(t, `${t.value} is used as a value (an alias, an argument, a spread or a destructuring hands on the built-in)`);
  }
  return out;
}
