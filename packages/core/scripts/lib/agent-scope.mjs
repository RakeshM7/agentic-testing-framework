// The scope rules of agent-written API code (D-056, B3): an allowlist, not a blocklist. Every identifier of agent code is
// declared in it, imported, or one of a few pure globals, and a pure global is only called, constructed or has an allowed
// member called; it is never a value (no alias, no argument, no spread, no destructuring), so no agent code can reach a
// built-in to change it. A member is assigned only on an object the same code created (a literal or a construction).
// Types are stripped first with Node's own type stripper, so only code that runs is read, and that code is read as an
// acorn syntax tree (S9-2b): a rule sees a node, never a guess about what a run of characters means.
import * as nodeModule from "node:module";
import { finding } from "./gate/common.mjs";
import * as acorn from "acorn";
import { readEscape } from "./ts-scan.mjs";

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
// These three are values, not bindings. `this` and `with` have their own findings below.
const KEYWORDS = new Set(["undefined", "NaN", "Infinity"]);
const OWN_FINDING = { this: "uses this: agent code has no receiver", with: "uses with: it changes what every name inside it means" };
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


// ---------- the syntax tree ----------

// The JavaScript that runs, as an acorn tree: -> {ast, src} or null when it does not parse. A module first (imports and
// exports), then a script (`with` and legacy octal escapes are scripts only: they parse, so a rule can reject them).
// A slot body has `return` and `await` at its top level.
export function parseJs(src) {
  const text = String(src ?? "");
  for (const sourceType of ["module", "script"]) {
    try {
      const ast = acorn.parse(text, { ecmaVersion: "latest", sourceType, locations: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true, preserveParens: true });
      return { ast, src: text };
    } catch {
      /* the other source type, then null */
    }
  }
  return null;
}
// Strip (types become spaces) and parse. -> {ast, src} | null
export function parseAgentCode(code, { wrap = false } = {}) {
  return parseJs(stripTypes(code, { wrap }) ?? String(code ?? ""));
}
const isNode = (v) => v && typeof v === "object" && typeof v.type === "string";
// Every node, parents first: visit(node, parent, key, grandparent).
export function walk(node, visit, parent = null, key = null, grand = null) {
  visit(node, parent, key, grand);
  for (const k of Object.keys(node)) {
    if (k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) isNode(c) && walk(c, visit, node, k, parent);
    else if (isNode(v)) walk(v, visit, node, k, parent);
  }
}
// Every node with its ancestors (nearest last) and the key it hangs on: visit(node, ancestors, key).
export function walkPath(node, visit, up = [], key = null) {
  visit(node, up, key);
  const path = [...up, node];
  for (const k of Object.keys(node)) {
    if (k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) for (const c of v) isNode(c) && walkPath(c, visit, path, k);
    else if (isNode(v)) walkPath(v, visit, path, k);
  }
}
const lineOf = (n) => ({ line: n?.loc?.start?.line ?? null });
// The escapes inside a piece of source (a string literal, a template's text or an identifier), as written.
function escapesIn(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== "\\") continue;
    const e = readEscape(raw, i);
    out.push(e.raw);
    i = Math.max(e.end, i + 2) - 1;
  }
  return out;
}
// The identifiers a binding pattern declares (an identifier, an object or array pattern, with defaults and rests).
function patternIds(p, out = []) {
  if (!p) return out;
  if (p.type === "Identifier") out.push(p);
  else if (p.type === "ObjectPattern") for (const x of p.properties) patternIds(x.type === "RestElement" ? x.argument : x.value, out);
  else if (p.type === "ArrayPattern") for (const x of p.elements) patternIds(x, out);
  else if (p.type === "AssignmentPattern") patternIds(p.left, out);
  else if (p.type === "RestElement") patternIds(p.argument, out);
  return out;
}
const isFunction = (n) => n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression";

// The names code declares: const, let, var (patterns too), function and class names, parameters, catch bindings and
// imports. -> {names, tokens} (tokens: each declaring identifier node)
export function declaredNames(tree) {
  const tokens = [];
  walk(tree.ast, (n) => {
    if (n.type === "VariableDeclarator") tokens.push(...patternIds(n.id));
    else if ((n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ClassDeclaration" || n.type === "ClassExpression") && n.id) tokens.push(n.id);
    if (isFunction(n)) for (const p of n.params) tokens.push(...patternIds(p));
    else if (n.type === "CatchClause") tokens.push(...patternIds(n.param));
    else if (n.type === "ImportSpecifier" || n.type === "ImportDefaultSpecifier" || n.type === "ImportNamespaceSpecifier") tokens.push(n.local);
  });
  return { names: new Set(tokens.map((t) => t.name)), tokens };
}

// The member expressions and identifiers an assignment target holds, destructuring included.
function targetsOf(p, out = []) {
  if (!p) return out;
  if (p.type === "ParenthesizedExpression") targetsOf(p.expression, out);
  else if (p.type === "Identifier" || p.type === "MemberExpression") out.push(p);
  else if (p.type === "ObjectPattern") for (const x of p.properties) targetsOf(x.type === "RestElement" ? x.argument : x.value, out);
  else if (p.type === "ArrayPattern") for (const x of p.elements) targetsOf(x, out);
  else if (p.type === "AssignmentPattern") targetsOf(p.left, out);
  else if (p.type === "RestElement") targetsOf(p.argument, out);
  return out;
}
// Every write to a target: [{node, target, op, right}] for an assignment, an update (++, --) and a for-in/of head.
export function writesOf(tree) {
  const out = [];
  walk(tree.ast, (n) => {
    if (n.type === "AssignmentExpression") for (const t of targetsOf(n.left)) out.push({ node: n, target: t, op: n.operator, right: n.right });
    else if (n.type === "UpdateExpression") for (const t of targetsOf(n.argument)) out.push({ node: n, target: t, op: n.operator });
    else if ((n.type === "ForInStatement" || n.type === "ForOfStatement") && n.left.type !== "VariableDeclaration") for (const t of targetsOf(n.left)) out.push({ node: n, target: t, op: "for" });
  });
  return out;
}

// The names this code creates itself, the only ones whose members it may assign: every declaration of the name is a
// const, let or var initialised with an object or array literal or a construction (so no parameter, import, function,
// catch binding or shadowing declaration can stand behind the name), and the name is never reassigned.
export function createdNames(tree) {
  const decls = declaredNames(tree);
  const literal = new Set();
  walk(tree.ast, (n) => {
    if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && ["ObjectExpression", "ArrayExpression", "NewExpression"].includes(n.init?.type)) literal.add(n.id);
  });
  const bad = new Set(decls.tokens.filter((t) => !literal.has(t)).map((t) => t.name));
  for (const w of writesOf(tree)) if (w.target.type === "Identifier") bad.add(w.target.name);
  return new Set(decls.tokens.map((t) => t.name).filter((n) => !bad.has(n)));
}

// ---------- X1 (round 3): no property that reaches a constructor, a prototype or a caller; no computed access ----------

// The property names that walk from any value to the Function constructor, a prototype or a calling frame.
export const POISON_PROPERTIES = Object.freeze(["constructor", "prototype", "__proto__", "caller", "callee", "arguments"]);
const POISON = new Set(POISON_PROPERTIES);
// The escapes agent code may write in a string, a template or a name (D-1, round 4): none of them can spell a letter.
// \x, \u, \u{}, octal escapes and line continuations are findings (escape); the tree holds every escape decoded anyway.
export const SAFE_ESCAPES = new Set(["\\n", "\\t", "\\r", "\\\\", "\\'", '\\"', "\\`"]);

// The loop counters of code: `for (let|var i = <number>; …)`, declared once, and only ever stepped by ++, --, += or -= a
// number: never assigned, destructured into or used as a for-in/of head, so it only ever holds a number. Only these may
// index a member (x[i]).
function loopCounters(tree) {
  const counts = new Map();
  for (const t of declaredNames(tree).tokens) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  const cand = new Set();
  walk(tree.ast, (n) => {
    if (n.type !== "ForStatement" || n.init?.type !== "VariableDeclaration" || n.init.kind === "const" || n.init.declarations.length !== 1) return;
    const d = n.init.declarations[0];
    if (d.id.type === "Identifier" && d.init?.type === "Literal" && typeof d.init.value === "number" && counts.get(d.id.name) === 1) cand.add(d.id.name);
  });
  for (const w of writesOf(tree)) {
    if (w.target.type !== "Identifier" || !cand.has(w.target.name)) continue;
    const step = w.node.type === "UpdateExpression" || (w.node.type === "AssignmentExpression" && w.node.left === w.target && ["+=", "-="].includes(w.op) && w.right.type === "Literal" && typeof w.right.value === "number");
    if (!step) cand.delete(w.target.name);
  }
  return cand;
}

// The rules on every agent-written file and slot, on the JavaScript that runs (types stripped): no property named
// constructor, prototype, __proto__, caller, callee or arguments in any position (member access, a key, a destructuring
// key, renamed or nested, a string or a template's text, so not in an `in` check or a descriptor lookup either), and
// no computed member access or computed key but a number literal or a loop counter. code: TypeScript (a whole file, or
// a slot's body with wrap); at(token): the reported line. -> findings
export function propertyFindings(file, code, { wrap = false, at = (t) => t?.line ?? null, kind = "agent" } = {}) {
  const tree = parseAgentCode(code, { wrap });
  if (!tree) {
    // code that does not parse is rejected; its escapes are still named (a legacy octal escape is a syntax error in a module)
    const bad = escapesIn(String(code ?? "")).find((e) => !SAFE_ESCAPES.has(e));
    const out = [finding("major", file, at({ line: 1 }), "free-identifier", `${kind} code does not parse as TypeScript that only strips to JavaScript`, "write plain TypeScript: types, functions and data")];
    if (bad !== undefined) out.push(finding("major", file, at({ line: 1 }), "escape", `${kind} code writes an escape (${bad.replace(/\r?\n/, "<newline>")}): an escape can spell a name no rule sees`, `write the characters themselves; only ${[...SAFE_ESCAPES].join(" ")} are allowed`));
    return out;
  }
  return propertyRules(file, tree, at, kind);
}
function propertyRules(file, tree, at, kind) {
  const out = [];
  const { src } = tree;
  const counters = loopCounters(tree);
  const poison = (n, what) => out.push(finding("major", file, at(lineOf(n)), "forbidden-property", `${kind} code names ${what}: it reaches a constructor, a prototype or a calling frame`, `never name ${POISON_PROPERTIES.join(", ")} (as a member, a key, a destructuring key or a string); use plain data and the generated clients`));
  const computed = (n, inner) => out.push(finding("major", file, at(lineOf(n)), "computed-access", `${kind} code uses a computed member or key ([${inner.slice(0, 40)}])`, "use .name or a literal key; index only by a number literal or a for-loop counter"));
  const escape = (n, raws, what) => {
    const bad = raws.find((e) => !SAFE_ESCAPES.has(e));
    if (bad !== undefined) out.push(finding("major", file, at(lineOf(n)), "escape", `${kind} code writes ${what} with the escape ${bad.replace(/\r?\n/, "<newline>")}: an escape can spell a name no rule sees`, `write the characters themselves; only ${[...SAFE_ESCAPES].join(" ")} are allowed`));
  };
  const seen = new Set();
  const okIndex = (p) => (p.type === "Literal" && typeof p.value === "number") || (p.type === "Identifier" && counters.has(p.name));
  walk(tree.ast, (n) => {
    if (n.type === "Identifier") {
      if (seen.has(n.start)) return; // a shorthand property is a key and a value in one place
      seen.add(n.start);
      const raw = src.slice(n.start, n.end);
      if (raw.includes("\\")) escape(n, escapesIn(raw), "a name");
      if (POISON.has(n.name)) poison(n, n.name);
    } else if (n.type === "Literal" && typeof n.value === "string") {
      escape(n, escapesIn(n.raw), "a string");
      if (POISON.has(n.value.trim()) || n.value.includes("__proto__")) poison(n, `'${n.value.slice(0, 40)}'`);
    } else if (n.type === "TemplateLiteral") {
      const cooked = n.quasis.map((q) => q.value.cooked ?? "").join("");
      for (const q of n.quasis) escape(q, escapesIn(q.value.raw), "a string");
      if (!n.expressions.length) {
        if (POISON.has(cooked.trim()) || cooked.includes("__proto__")) poison(n, `'${cooked.slice(0, 40)}'`);
      } else if (POISON_PROPERTIES.some((p) => cooked.includes(p))) poison(n, "a property in a template literal");
    } else if (n.type === "MemberExpression" && n.computed) {
      if (!okIndex(n.property)) computed(n, src.slice(n.property.start, n.property.end));
    } else if ((n.type === "Property" || n.type === "MethodDefinition" || n.type === "PropertyDefinition") && n.computed) {
      if (!okIndex(n.key)) computed(n, src.slice(n.key.start, n.key.end));
    }
  });
  return out;
}

// The names a whole file declares (its imports, declarations and parameters), for the slots inside it. -> Set
export function scopeOf(code) {
  const tree = parseAgentCode(code);
  return tree === null ? new Set() : new Set([...declaredNames(tree).names].filter((n) => !GLOBAL_NAMES.has(n)));
}

// B3: the free identifiers of a piece of agent code. code: TypeScript (a whole file, or a slot's function body with
// wrap); declared: the names the code may use without declaring them (the generated file's own declarations and
// bindings); at(line): the reported line for a line of code. -> findings
export function freeIdentifierFindings(file, code, { declared = [], wrap = false, at = (line) => line } = {}) {
  const tree = stripTypes(code, { wrap }) === null ? null : parseAgentCode(code, { wrap });
  if (!tree) return [finding("major", file, at(1), "free-identifier", "the code does not parse as TypeScript that only strips to JavaScript (no enum, namespace or other code-generating TypeScript)", "write plain TypeScript: types, functions and data")];
  return identifierFindings(file, tree, new Set(declared), at);
}
function identifierFindings(file, tree, outer, at) {
  const out = [];
  const push = (n, problem) => out.push(finding("major", file, at(n.loc.start.line), "free-identifier", problem, "use only what this code declares or imports and the pure globals as calls (String(x), Object.keys(x), new Date()); never a built-in as a value"));
  const { names, tokens } = declaredNames(tree);
  for (const t of tokens) if (GLOBAL_NAMES.has(t.name)) push(t, `declares ${t.name}, a name of the runtime's globals`);
  const scope = new Set([...outer, ...[...names].filter((n) => !GLOBAL_NAMES.has(n))]);
  const declaring = new Set(tokens);
  const isRef = (n, parent, key) => {
    if (declaring.has(n)) return false;
    if (!parent) return true;
    if (parent.type === "MemberExpression") return key !== "property" || parent.computed;
    if (parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") return key !== "key" || parent.computed;
    if (["LabeledStatement", "BreakStatement", "ContinueStatement", "MetaProperty"].includes(parent.type)) return false;
    if (parent.type === "ExportSpecifier" && key === "exported") return false;
    if (parent.type.startsWith("Import")) return false;
    return true;
  };
  walk(tree.ast, (n, parent, key, grand) => {
    if (n.type === "ThisExpression") return push(n, OWN_FINDING.this);
    if (n.type === "WithStatement") return push(n, OWN_FINDING.with);
    if (n.type !== "Identifier" || !isRef(n, parent, key) || KEYWORDS.has(n.name) || scope.has(n.name)) return;
    const g = Object.hasOwn(PURE_GLOBALS, n.name) ? PURE_GLOBALS[n.name] : null;
    if (!g) return push(n, `${n.name} is not declared here, imported, or an allowed pure global`);
    if (parent?.type === "CallExpression" && key === "callee" && g.call) return;
    if (parent?.type === "NewExpression" && key === "callee" && g.construct) return;
    if (parent?.type === "MemberExpression" && key === "object" && !parent.computed && parent.property.type === "Identifier") {
      const member = parent.property.name;
      const called = grand?.type === "CallExpression" && grand.callee === parent;
      if (called && (g.members ?? []).includes(member)) return;
      const assigned = (grand?.type === "AssignmentExpression" && grand.left === parent) || grand?.type === "UpdateExpression" || ((grand?.type === "ForInStatement" || grand?.type === "ForOfStatement") && grand.left === parent);
      if (!called && (g.constants ?? []).includes(member) && !assigned) return;
      return push(n, `${n.name}.${member}${called ? "(…)" : ""} is not an allowed use of ${n.name}`);
    }
    push(n, `${n.name} is used as a value (an alias, an argument, a spread or a destructuring hands on the built-in)`);
  });
  return out;
}
