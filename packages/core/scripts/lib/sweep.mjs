// The human's cleanup of what earlier runs left in the target (D-075): `ledger.mjs sweep`. A crashed or abandoned run can
// leave entities its own cleanup never reached, and D-005 lets a run delete only what IT created, so nothing in a later
// run may touch them. The sweep is the one other way: a human, in their own terminal (the guard denies it to every tool
// call), between runs, deletes the live entities of ended runs through the cleanup recipe recorded with each one at
// creation (the catalogue's delete endpoint and the path parameter that takes the id), and records each `deleted`.
//   - only with no active run, and only when the run-config the last run started from is full-run now;
//   - only an entity with a recipe whose endpoint is a delete of the module's catalogue, on a first-party host, with no
//     path parameter left unfilled; anything else is listed for the human to clean up by hand (`manual`);
//   - the product slug typed at an interactive terminal confirms it, unless --dry-run (which sends nothing), or the VS
//     Code extension's dialog does: --confirm-file names its one-time file, which must be the environment's
//     state/sweep-confirm.json, is checked (scripts/lib/confirm.mjs) and deleted before anything else;
//   - every request carries the run-config's credentials (session cookies, api.auth_header) like the probes, follows no
//     redirect, and 2xx, 404 and 410 count as gone.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { loadJson, paths } from "./contract.mjs";
import { SWEEP_CONFIRM, consumeConfirmation, discardConfirmation } from "./confirm.mjs";
import { readJson } from "./files.mjs";
import { append, live } from "./ledger.mjs";
import { netFetch } from "./net.mjs";
import { firstPartyHosts, loadAuth } from "./probe.mjs";
import { validateRunConfig } from "../run-config.mjs";
import { expandFw } from "./roots.mjs";

const GONE = (status) => (status >= 200 && status < 300) || status === 404 || status === 410;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// What a sweep would do. -> {errors} | {cfg, items: [{entry, method, url}], manual: [{entry, reason}]}
export function sweepPlan(product, { root, run } = {}) {
  const p = paths(product, root);
  if (existsSync(p.lockFile)) return { errors: [expandFw(`a run is active for '${product}': end it first (node {fw}/scripts/run.mjs end ${product}); the sweep never races a run's own cleanup`)] };
  if (!existsSync(p.runFile)) return { errors: [`no run state for '${product}': nothing was ever recorded`] };
  const configPath = path.resolve(root, loadJson(p.runFile).configPath ?? "");
  if (!existsSync(configPath)) return { errors: [`the run-config the last run started from (${configPath}) is gone: the sweep needs its target and credentials`] };
  const { errors, normalized: cfg } = validateRunConfig(yaml.load(readFileSync(configPath, "utf8")), { root });
  if (errors?.length) return { errors: errors.map((e) => `${path.relative(root, configPath)}: ${e}`) };
  if (cfg.authorizations.mode !== "full-run")
    return { errors: [`${path.relative(root, configPath)} is readonly: a sweep deletes in the target, so it needs authorizations.mode: full-run, set by a human authorized to test it (D-004)`] };
  const hosts = firstPartyHosts(cfg);
  const items = [];
  const manual = [];
  for (const entry of live(p.ledgerFile).filter((e) => !run || e.runId === run)) {
    const c = entry.cleanup;
    if (!c) {
      manual.push({ entry, reason: "no cleanup recipe was recorded with it" });
      continue;
    }
    const catalogue = readJson(path.join(p.module(entry.module), "api", "discovered-endpoints.json"), []);
    const ep = catalogue.find((x) => x.id === c.endpoint);
    if (!ep) {
      manual.push({ entry, reason: `its cleanup endpoint ${c.endpoint} is not in the ${entry.module} catalogue` });
      continue;
    }
    if (ep.crud !== "delete") {
      manual.push({ entry, reason: `${c.endpoint} (${ep.method} ${ep.path}) is not a delete` });
      continue;
    }
    const filled = ep.path.replace(`{${c.param}}`, encodeURIComponent(entry.ref));
    if (filled === ep.path || /\{[^}]+\}/.test(filled)) {
      manual.push({ entry, reason: `${ep.method} ${ep.path} needs path values other than {${c.param}}` });
      continue;
    }
    let url;
    try {
      url = new URL(filled, ep.server).href; // the catalogue path is the full path from the server's origin
    } catch {
      manual.push({ entry, reason: `${ep.server}${filled} is not a URL` });
      continue;
    }
    if (!hosts.includes(new URL(url).hostname.toLowerCase())) {
      manual.push({ entry, reason: `${new URL(url).hostname} is not a host of the product (target.url, target.api_urls)` });
      continue;
    }
    items.push({ entry, method: ep.method, url });
  }
  return { cfg, items, manual };
}

const brief = ({ entry, ...rest }) => ({ runId: entry.runId, type: entry.type, ref: entry.ref, module: entry.module, ...(entry.label ? { label: entry.label } : {}), ...rest });

// The extension dialog's confirmation of a sweep: the environment's state folder (D-081), never the product's other ones.
export const sweepConfirmFile = (product, root) => path.join(paths(product, root).state, SWEEP_CONFIRM);

// interactive: {isTTY, ask(question) -> answer}; confirmFile: the --confirm-file path, which stands in for the terminal.
// -> {errors} | {dryRun, deleted, failed, manual}
export async function sweep(product, { root, run, dryRun = false, interactive, confirmFile, fetchImpl = netFetch, sleep = defaultSleep, delayMs = 200, timeoutMs = 15000 } = {}) {
  if (confirmFile != null) {
    const file = sweepConfirmFile(product, root);
    if (dryRun) return { errors: [`confirmation refused: a dry run sends nothing and needs no confirmation${discardConfirmation(file) ? ` (${path.relative(root, file).replaceAll("\\", "/")} was deleted)` : ""}`] };
    const c = consumeConfirmation(confirmFile, { file, root, want: { action: "sweep", product, environment: paths(product, root).environment }, slug: product });
    if (c.problem) return { errors: [`${c.problem}; nothing was sent`] };
    interactive = c.interactive;
  }
  const plan = sweepPlan(product, { root, run });
  if (plan.errors) return plan;
  const out = { dryRun, deleted: [], failed: [], manual: plan.manual.map(brief) };
  if (dryRun) return { ...out, wouldDelete: plan.items.map(brief) };
  if (!plan.items.length) return out;
  if (!interactive?.isTTY) return { errors: [expandFw("the sweep is human-only: run it yourself in an interactive terminal (in Git Bash's mintty: winpty node {fw}/scripts/ledger.mjs sweep ...); nothing was sent")] };
  const answer = await interactive.ask(`Delete ${plan.items.length} entit${plan.items.length === 1 ? "y" : "ies"} that earlier runs of ${product} left in the target? Type the product slug (${product}) to confirm: `);
  if (String(answer ?? "").trim() !== product) return { errors: ["not confirmed: nothing was sent"] };
  const auth = loadAuth(plan.cfg, root);
  const ledgerFile = paths(product, root).ledgerFile;
  for (const [i, item] of plan.items.entries()) {
    if (i) await sleep(delayMs);
    let status;
    try {
      status = (await fetchImpl(item.url, { method: item.method, headers: auth.headersFor(item.url), redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })).status;
    } catch (e) {
      out.failed.push(brief({ ...item, error: e.name === "TimeoutError" ? "timeout" : "network error" }));
      continue;
    }
    if (!GONE(status)) {
      out.failed.push(brief({ ...item, status }));
      continue;
    }
    const { entry } = item;
    append(ledgerFile, { runId: entry.runId, event: "deleted", type: entry.type, ref: entry.ref, module: entry.module, stage: "sweep", agent: "human-sweep", note: `swept by a human: ${item.method} answered ${status}` });
    out.deleted.push(brief({ ...item, status }));
  }
  return out;
}
