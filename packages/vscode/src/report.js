// The report webview (P-12, packaging §3.13): `atf.openReport` shows a run's deck, the
// artifacts/<product>/results/<run>/report/index.html that report.mjs renders from report.json (D-061).
//
// The deck is one self-contained file today (templates/report/deck.html inlines deck.css and deck.js, charts are inline
// SVG, no CDN), but nothing here depends on that: any relative asset it may reference is rewritten to a webview URI
// inside the report folder, and anything outside that folder is dropped. The webview is locked down:
//   - localResourceRoots is the report folder only, so the deck can't read the rest of the workspace (credentials,
//     .auth/, other runs);
//   - a CSP with default-src 'none': no network at all, styles and scripts only from the report folder or carrying
//     this load's nonce (the deck's inline <style> and <script> get it), no inline event handlers or style attributes,
//     no <base>, no forms. A deck that ships an inline handler would stop working here, visibly, rather than the
//     policy being loosened.
// The deck's own script (slide navigation, arrow/PageUp/PageDown/Home/End keys, #s<n> fragments) runs unchanged.
//
// When index.html is missing but report.json exists, the report was collected and never rendered: a message offers
// the render command (`node {fw}/scripts/report.mjs render <product>`), run inside the extension (cli.runStreaming,
// behind a cancellable notification, its output in the `atf` channel; no terminal, user 2026-10-29). render
// works on the product's current run of an environment, so it is offered only for a run that is one; for an older
// run the message says so instead. The extension never renders or writes the report itself (SPEC: no new runtime
// behaviour, writes only through the framework's scripts).
//
// The pure core (finding reports, the render command, the HTML rewrite, the CSP) takes no `vscode` and is tested with
// node:test (test/report.test.mjs); registerReport is the thin VS Code layer over it.
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resultsDir } from "./workspace.js";

// ---- finding a run's report ------------------------------------------------------------------------------------------

// Product and run ids are folder names under artifacts/; anything else (a separator, `..`) is refused so a tree item
// or a picked value can never point the webview at another folder.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const isId = (s) => typeof s === "string" && ID_RE.test(s) && !s.includes("..");

// The report folder of a run (contract.paths(product).results(runId) + report/, scripts/lib/report.mjs reportPaths).
export function reportDir(root, product, runId) {
  if (!isId(product) || !isId(runId)) throw new Error(`not a product and run id: '${product}', '${runId}'`);
  return path.join(resultsDir(root, product, runId), "report");
}

const isFile = (f) => {
  try {
    return statSync(f).isFile();
  } catch {
    return false;
  }
};

// What a run has: `html` (index.html, the deck), `data` (report.json only: collected, not rendered) or `none`.
export function findReport(root, product, runId) {
  const dir = reportDir(root, product, runId);
  const html = path.join(dir, "index.html");
  const json = path.join(dir, "report.json");
  const state = isFile(html) ? "html" : isFile(json) ? "data" : "none";
  return { product, runId, dir, html, json, state };
}

const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && isId(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
};
const mtime = (f) => {
  try {
    return statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};

// Every run of every product that has a report (rendered or not), newest first: the runs that reached the report
// stage, which is what "pick an ended run" offers when the command is not run from the tree.
export function listReports(root) {
  const out = [];
  for (const product of subdirs(path.join(root, "artifacts")))
    for (const runId of subdirs(path.join(root, "artifacts", product, "results"))) {
      const r = findReport(root, product, runId);
      if (r.state !== "none") out.push({ ...r, time: Math.max(mtime(r.html), mtime(r.json)) });
    }
  return out.sort((a, b) => b.time - a.time || (a.runId < b.runId ? 1 : a.runId > b.runId ? -1 : 0));
}

// A run item from the Runs tree (context value `atf.run`), or a plain { product, runId }: the ids it names, or null.
export function runOf(item) {
  if (!item || typeof item !== "object") return null;
  const run = item.run && typeof item.run === "object" ? item.run : item;
  const product = run.product ?? item.product;
  const runId = run.runId ?? run.run_id ?? item.runId;
  return isId(product) && isId(runId) ? { product, runId } : null;
}

// ---- the render command (fallback) ----------------------------------------------------------------------------------

// The environment whose current run is runId (contract.stateDirOf: default is state/, else envs/<env>/state/), or null.
export function environmentOf(root, product, runId) {
  const productDir = path.join(root, "artifacts", product);
  const candidates = [["default", path.join(productDir, "state", "run.json")], ...subdirs(path.join(productDir, "envs")).map((e) => [e, path.join(productDir, "envs", e, "state", "run.json")])];
  for (const [env, file] of candidates) {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).runId === runId) return env;
    } catch {
      // no run state in this environment, or unreadable: not this one
    }
  }
  return null;
}

// What to tell the human when a run has report.json but no index.html. `framework` is the installed package's folder
// (node_modules/@testagentic/atf); the command is shown with {fw} as the workspace-relative path, the way the docs
// write it, and returned as an argv (["node", script, …]) whose script cli.runStreaming runs with the configured Node.js.
export function renderFallback({ root, framework, product, runId }) {
  const env = environmentOf(root, product, runId);
  if (!env)
    return {
      text: `The report of ${product} · ${runId} was collected but never rendered, and it is no longer the product's current run, so report.mjs render can't render it (render works on the current run only). Its data is in report/report.json.`,
      command: null,
    };
  const script = path.join(framework, "scripts", "report.mjs");
  const shown = path.relative(root, script).split(path.sep).join("/");
  const args = ["node", script, "render", product];
  const envVars = env === "default" ? {} : { ATF_ENV: env };
  const prefix = env === "default" ? "" : `ATF_ENV=${env} `;
  return {
    text: `The report of ${product} · ${runId} has report.json but no index.html: it was never rendered. Render it with ${prefix}node ${shown} render ${product}`,
    command: { args, env: envVars, display: `${prefix}node ${shown} render ${product}` },
  };
}

// ---- the webview content ----------------------------------------------------------------------------------------------

export const makeNonce = (bytes = randomBytes(18)) => Buffer.from(bytes).toString("base64").replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);

// The policy. cspSource is webview.cspSource (the webview's resource origin); localResourceRoots narrows what it
// serves to the report folder, so "from cspSource" means "from the report folder".
export function buildCsp({ cspSource, nonce }) {
  if (!cspSource || !/^[A-Za-z0-9_-]+$/.test(nonce ?? "")) throw new Error("buildCsp needs the webview's cspSource and a nonce");
  return [
    "default-src 'none'",
    `img-src ${cspSource}`,
    `media-src ${cspSource}`,
    `font-src ${cspSource}`,
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src ${cspSource} 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// A URL that names a file relative to the page: not a fragment, not absolute (/x, //host, C:\x), no scheme.
export const isRelativeUrl = (v) => {
  const s = v.trim();
  return s !== "" && !/^[#/\\]/.test(s) && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s);
};

// The file a relative URL names inside `dir`, with its ?query#fragment kept apart; null when it escapes `dir`.
export function resolveInside(dir, url) {
  const m = /^([^?#]*)(.*)$/s.exec(url.trim());
  let rel;
  try {
    rel = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  const file = path.resolve(dir, rel);
  const back = path.relative(dir, file);
  if (back === "" || back.startsWith("..") || path.isAbsolute(back)) return null;
  return { file, suffix: m[2] };
}

const decodeAttr = (s) => s.replace(/&(amp|quot|#39|apos|lt|gt);/g, (_, e) => ({ amp: "&", quot: '"', "#39": "'", apos: "'", lt: "<", gt: ">" })[e]);
const encodeAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Elements whose src/href/poster load a resource into the page (an <a href> is navigation and is left alone).
const ASSET_TAGS = new Set(["script", "style", "link", "img", "source", "video", "audio", "track", "image", "use", "input", "embed", "object", "iframe"]);
const URL_ATTR_RE = /(\s)(src|href|poster|xlink:href|data)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
const NONCE_ATTR_RE = /\snonce(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gi;
const CSP_META_RE = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi;
const BASE_RE = /<base\b[^>]*>/gi;
// raw-text elements and comments are copied as they are (only a script's or style's start tag is rewritten), so text
// inside a script that merely looks like a tag is never touched
const CHUNK_RE = /(<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>)/gi;
const START_TAG_RE = /<([A-Za-z][A-Za-z0-9:-]*)(\s[^<>]*?)?(\/?)>/g;

// Rewrites the deck for the webview: the CSP meta first in <head> (any earlier CSP and every <base> removed), the
// nonce on every <script> and <style>, each relative asset URL turned into toUri(file) + its ?query#fragment, and an
// asset URL that leaves the report folder (or an absolute path) dropped. Returns the html and what was dropped.
export function rewriteHtml(html, { dir, nonce, csp, toUri }) {
  const blocked = [];
  const tag = (whole, name, attrs = "", selfClose = "") => {
    const lower = name.toLowerCase();
    if (!ASSET_TAGS.has(lower)) return whole;
    let a = attrs.replace(URL_ATTR_RE, (m, sp, attr, eq, dq, sq, bare) => {
      if (attr.toLowerCase() === "data" && lower !== "object") return m;
      const raw = decodeAttr(dq ?? sq ?? bare);
      if (!raw.trim() || raw.trim().startsWith("#")) return m;
      if (!isRelativeUrl(raw)) {
        // a scheme URL (http:, data:) stays as written: the CSP refuses it; an absolute path is outside the folder
        if (!/^[/\\]/.test(raw.trim())) return m;
        blocked.push(raw);
        return `${sp}${attr}${eq}""`;
      }
      const hit = resolveInside(dir, raw);
      if (!hit) {
        blocked.push(raw);
        return `${sp}${attr}${eq}""`;
      }
      return `${sp}${attr}${eq}"${encodeAttr(String(toUri(hit.file)) + hit.suffix)}"`;
    });
    if (lower === "script" || lower === "style") a = `${a.replace(NONCE_ATTR_RE, "")} nonce="${nonce}"`;
    return `<${name}${a}${selfClose}>`;
  };
  const startTags = (s) => s.replace(START_TAG_RE, tag);
  let out = html
    .replace(CSP_META_RE, "")
    .replace(BASE_RE, "")
    .split(CHUNK_RE)
    .map((chunk, i) => {
      if (i % 2 === 0) return startTags(chunk);
      if (chunk.startsWith("<!--")) return chunk;
      const end = chunk.indexOf(">") + 1;
      return startTags(chunk.slice(0, end)) + chunk.slice(end);
    })
    .join("");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${encodeAttr(csp)}">`;
  const head = /<head\b[^>]*>/i.exec(out);
  out = head ? out.slice(0, head.index + head[0].length) + `\n${meta}` + out.slice(head.index + head[0].length) : `${meta}\n${out}`;
  return { html: out, blocked };
}

// ---- the VS Code layer --------------------------------------------------------------------------------------------------

// deps: { vscode, workspace, cli, output } (SPEC). workspace gives the atf workspace root and the installed framework;
// cli.runStreaming runs the render in the background, its output in the `atf` channel.
export function registerReport(context, deps) {
  const { vscode, output } = deps;
  const panels = new Map(); // `${product}/${runId}` -> { panel, watcher }

  // the latest detection (src/workspace.js): the workspace root, and the installed package's folder when there is one
  const roots = () => (deps.workspace?.root ? { root: deps.workspace.root, framework: deps.workspace.framework } : null);

  const show = (report) => {
    const key = `${report.product}/${report.runId}`;
    const title = `Report · ${report.product} · ${report.runId}`;
    let entry = panels.get(key);
    if (!entry) {
      const panel = vscode.window.createWebviewPanel("atf.report", title, vscode.ViewColumn.Active, {
        enableScripts: true,
        enableForms: false,
        enableFindWidget: true,
        localResourceRoots: [vscode.Uri.file(report.dir)],
      });
      // re-render the panel when report.mjs render rewrites the deck
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(report.dir), "index.html"));
      entry = { panel, watcher };
      const reload = () => load(entry.panel, report);
      watcher.onDidChange(reload);
      watcher.onDidCreate(reload);
      panel.onDidDispose(() => {
        watcher.dispose();
        panels.delete(key);
      });
      panels.set(key, entry);
    } else entry.panel.reveal();
    load(entry.panel, report);
  };

  const load = (panel, report) => {
    let html;
    try {
      html = readFileSync(report.html, "utf8");
    } catch (e) {
      output?.appendLine(`report: can't read ${report.html}: ${e.message}`);
      return;
    }
    const { webview } = panel;
    const nonce = makeNonce();
    const r = rewriteHtml(html, {
      dir: report.dir,
      nonce,
      csp: buildCsp({ cspSource: webview.cspSource, nonce }),
      toUri: (file) => webview.asWebviewUri(vscode.Uri.file(file)).toString(),
    });
    if (r.blocked.length) output?.appendLine(`report: ${report.html} references files outside its folder, not loaded: ${r.blocked.join(", ")}`);
    webview.html = r.html;
  };

  const pick = async (root) => {
    const reports = listReports(root);
    if (!reports.length) {
      vscode.window.showInformationMessage("atf: no run has a report yet. The report stage writes it at the end of a run.");
      return null;
    }
    const chosen = await vscode.window.showQuickPick(
      reports.map((r) => ({ label: `${r.product} · ${r.runId}`, description: r.state === "html" ? "" : "collected, not rendered", report: r })),
      { placeHolder: "The run whose report to open", matchOnDescription: true },
    );
    return chosen?.report ?? null;
  };

  const open = async (item) => {
    const where = roots();
    if (!where) {
      vscode.window.showWarningMessage("atf: no atf workspace is open (atf/atf.json).");
      return;
    }
    const ids = runOf(item);
    const report = ids ? findReport(where.root, ids.product, ids.runId) : await pick(where.root);
    if (!report) return;
    if (report.state === "html") return show(report);
    if (report.state === "none") {
      vscode.window.showInformationMessage(`atf: ${report.product} · ${report.runId} has no report yet. The report stage writes it at the end of the run.`);
      return;
    }
    if (!where.framework) {
      vscode.window.showWarningMessage(`atf: ${report.product} · ${report.runId} was never rendered, and @testagentic/atf is not installed in this workspace to render it.`);
      return;
    }
    const fb = renderFallback({ root: where.root, framework: where.framework, product: report.product, runId: report.runId });
    if (!fb.command) return void vscode.window.showInformationMessage(`atf: ${fb.text}`);
    const action = "Render it";
    if ((await vscode.window.showInformationMessage(`atf: ${fb.text}`, action)) !== action) return;
    const [, script, ...args] = fb.command.args;
    let result;
    let error;
    await vscode.window.withProgress({ location: vscode.ProgressLocation?.Notification ?? 15, title: `Rendering the report of ${report.product} · ${report.runId}…`, cancellable: true }, async (_p, token) => {
      try {
        result = await deps.cli.runStreaming(args, { script, env: { ATF_ENV: "", ...fb.command.env }, cwd: where.root, token });
      } catch (e) {
        error = e;
      }
    });
    if (result?.cancelled) return;
    const rendered = !error && result.code === 0 ? findReport(where.root, report.product, report.runId) : null;
    if (rendered?.state === "html") return show(rendered);
    const why = error ? error.message : `report.mjs render exited ${result.code}`;
    if ((await vscode.window.showErrorMessage(`atf: the report of ${report.product} · ${report.runId} was not rendered: ${why}`, "Show output")) === "Show output") output?.show?.(true);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("atf.openReport", open),
    { dispose: () => [...panels.values()].forEach((e) => e.panel.dispose()) },
  );
  return { open };
}
