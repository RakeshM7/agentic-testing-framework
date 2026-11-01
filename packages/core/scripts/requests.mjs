#!/usr/bin/env node
// Worker requests for the domain orchestrator (docs/agent-handoffs.md, G10): the only way a worker writes requests.json.
//
//   requests.mjs add  <product> <domain> <module> --from <agent> --kind K --target T --summary S [--detail D] [--files a,b]
//   requests.mjs add  <product> <domain> <module> --from <agent> --file entries.json    a JSON list of {kind, target, summary, detail?, files?}
//        -> {added: [ids], duplicates: [{id, status}], errors}; exit 1 on errors. A duplicate (same kind, target and summary) is
//        not added again; `status` says whether it was already handled or declined.
//   requests.mjs list <product> <domain> <module>      -> the file's requests
//   requests.mjs check <product> <domain> <module>     -> schema-check requests.json
// <domain>: playwright-ui | playwright-api | k6. Kinds: repo-change, missing-method, lib-export, foundation-gap.
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, workspaceRoot, validateFile } from "./lib/contract.mjs";
import { HANDLERS, addRequests, readRequests, requestsPath } from "./lib/requests.mjs";

export async function main(argv, { root = workspaceRoot } = {}) {
  const [cmd, product, domain, module, ...rest] = argv;
  const { values: v } = parseArgs({ args: rest, options: { from: { type: "string" }, kind: { type: "string" }, target: { type: "string" }, summary: { type: "string" }, detail: { type: "string" }, files: { type: "string" }, file: { type: "string" } } });
  if (!["add", "list", "check"].includes(cmd) || !product || !domain || !module) return { code: 2, out: { errors: ["usage: requests.mjs add|list|check <product> <domain> <module> ... (see header comment)"] } };
  if (!HANDLERS[domain]) return { code: 2, out: { errors: [`domain must be one of [${Object.keys(HANDLERS)}]`] } };
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) return { code: 1, out: { errors: [`no active run for product '${product}'`] } };
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) return { code: 1, out: { errors: [`module must be one of [${run.modules}]`] } };
  const file = requestsPath(p.productDir, run.runId, module, domain);
  if (cmd === "list") return { code: 0, out: readRequests(file, domain, module) };
  if (cmd === "check") return { code: 0, out: { problems: existsSync(file) ? await validateFile("requests", file) : [] } };
  let entries;
  if (v.file) {
    try {
      entries = JSON.parse(readFileSync(path.resolve(root, v.file), "utf8"));
    } catch (e) {
      // never echo the file's content: a JSON parse message quotes the text it choked on, and the path is any file
      return { code: 1, out: { errors: [e instanceof SyntaxError ? "--file: not valid JSON" : "--file: cannot read the file"] } };
    }
    if (!Array.isArray(entries)) return { code: 1, out: { errors: ["--file must hold a JSON list of requests"] } };
  } else entries = [{ kind: v.kind, target: v.target, summary: v.summary, ...(v.detail ? { detail: v.detail } : {}), ...(v.files ? { files: v.files.split(",").map((s) => s.trim()).filter(Boolean) } : {}) }];
  const r = addRequests(file, domain, module, entries, { from: v.from });
  return { code: r.errors.length ? 1 : 0, out: r };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, out } = await main(process.argv.slice(2)).catch((e) => ({ code: 1, out: { errors: [e.message] } }));
  console.log(JSON.stringify(out, null, 2));
  process.exit(code);
}
