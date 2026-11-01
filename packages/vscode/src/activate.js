// The extension's wiring (P-12), apart from src/extension.js so node:test can run it with a fake `vscode`
// (test/activate.test.mjs): the output channel, deps.workspace and deps.cli, the Runs view, Basil's commands, then the
// sheets (Poppy) and the report (Ivy) through their register functions, each with deps = { vscode, workspace, cli,
// output }. One part that fails to register is logged and the rest still load.
//
// Everything happens inside VS Code (user, 2026-10-29); no plain terminal hand-offs:
//   - init, sync, check, doctor, validate and `atf config` ask nothing, so they run in the background
//     (cli.runStreaming) behind a cancellable progress notification, their output in the `atf` channel, then a result
//     message ("Show output" on a failure). The doctor's checks are shown one per line, with their fixes.
//   - The sweep (human-only) is confirmed in the extension's own dialog, the product slug typed, and runs through the
//     framework's one-time confirmation file (cli.confirmedRun). Approval is the sheets' (src/sheets/commands.js).
//   - A project (D-107): Create new project…, Open existing project…, the registry token (Connect, Forget) and Install
//     the framework are src/project.js's flows, registered here; create and install run npm/npx in the background
//     (cli.runNpm), with the token only in their environment.
//   - the Cockpit (D-110, D-111; src/cockpit.js, src/cockpit-panel.js): the sidebar's first view (the environment
//     checks, the products, the New product form, and the selected product's pipeline, Needs you and intents) and its
//     editor tab (atf.openCockpit). Every session on a run's stages (GATED_COMMANDS: run, resume and the intents'
//     commands) starts only after its check (gateSession): a Node.js the framework accepts, always; the product's
//     dependency check, unless the human chooses Start anyway.
//   - An agent session (run, resume, the interview) follows atf.host: `claude`, `copilot-cli` and `codex` run `npx --no atf …
//     --host` in a terminal shown as a tab in the editor area (the agent CLI is an interactive program, the one thing
//     that needs a terminal); `copilot-chat` runs the CLI's own pre-check in the background, then opens VS Code Chat
//     with the CLI's own first prompt, for the human to send.
// The extension never registers, replaces or bypasses the hooks (no safety role, P-12).
import { existsSync } from "node:fs";
import path from "node:path";
import { createCli, lastJson } from "./cli.js";
import { VIEW_ID as COCKPIT_VIEW, createEnvironment, registerCockpit } from "./cockpit.js";
import { GATED_COMMANDS, intentArgv } from "./cockpit-actions.js";
import { COMMAND_ID as OPEN_COCKPIT, registerCockpitPanel } from "./cockpit-panel.js";
import { TOKEN_ENV, createProjectFlows, createRegistry, registryEnv } from "./project.js";
import { registerRuns } from "./runs.js";
import { CREATE_HINT, DEFAULT_ENV, FRAMEWORK_PACKAGE, INIT_BUTTON, INSTALL_BUTTON, configFileOf, createWorkspace, envArgs, findFramework, productNameProblem, targetUrlProblem } from "./workspace.js";

// Basil's commands, then D-107's project commands (the manifest declares every command; test/manifest.test.mjs checks
// both ways)
export const COMMANDS = ["atf.refresh", "atf.init", "atf.sync", "atf.check", "atf.doctor", "atf.run", "atf.resume", "atf.newProduct", "atf.openConfig", "atf.validate", "atf.sweep", "atf.createProject", "atf.openProject", "atf.connect", "atf.forgetToken", "atf.installFramework"];

// "New product…": how the run-config is made. `how` is also the command's optional argument (the welcome view's
// interview link passes "interview"), which skips this pick.
export const NEW_PRODUCT_WAYS = [
  { label: "$(checklist) Fill in the form", description: "in the atf panel: the product, its modules, references, login and steps; no agent", how: "form" },
  { label: "$(edit) Set it up myself", description: "the product's name and URL; atf config writes the run-config", how: "config" },
  { label: "$(comment-discussion) Let the orchestrator interview me", description: "atf interview: it asks a few questions and drafts the run-config", how: "interview" },
];
export const LOGIN_CHOICES = [
  { label: "Log in now", description: "Your browser opens on the target: you sign in, atf saves the session", login: true },
  { label: "No login needed", description: "the target needs no sign-in (or log in later: npx atf login <product>)", login: false },
];
// The arguments of `atf config` (scripts/lib/cli.mjs): the product, its URL, and --no-login when no login is wanted.
export const configArgs = (product, url, { login }) => ["config", product, "--url", url, ...(login ? [] : ["--no-login"])];

// Why a command failed, from its output: the errors (or problems) of the last JSON block a script printed, else the
// last line on stderr, else the last on stdout.
export function failureReason(lines) {
  const json = lastJson(lines);
  for (const k of ["errors", "problems"]) if (Array.isArray(json?.[k]) && json[k].length) return json[k].join("; ");
  const last = (stream) => lines.filter((l) => l.stream === stream && l.line.trim()).at(-1)?.line.trim();
  return last("stderr") ?? last("stdout") ?? null;
}
const lastLine = (lines, stream = "stdout") => lines.filter((l) => l.stream === stream && l.line.trim()).at(-1)?.line.trim() ?? null;

// The stages, for `atf resume` when the tree has none to offer (the CLI checks the name either way).
export const STAGES = ["knowledge", "module-knowledge", "explore", "clarifications", "api-discovery", "testcases", "playwright-repo", "playwright-ui", "playwright-api", "k6", "report"];

// ---- the host an agent session opens on (atf.host) --------------------------------------------------------------------

// claude: Claude Code's CLI (its panel can't pick the agent, so `claude --agent orchestrator-agent` in an editor-area
// terminal); copilot-cli: Copilot CLI the same way; copilot-chat: VS Code Chat with the orchestrator-agent.
export const HOSTS = ["claude", "copilot-chat", "copilot-cli", "codex"];
export const LEGACY_HOSTS = { copilot: "copilot-cli" }; // the setting's value before 2026-10-29: `atf … --host copilot`
// The setting as read: an old value migrated, anything unknown the default.
export const hostOf = (value) => {
  const v = String(value ?? "").trim();
  return LEGACY_HOSTS[v] ?? (HOSTS.includes(v) ? v : "claude");
};
// The CLI's --host for a terminal session (claude is its default).
export const hostCliArgs = (host) => (host === "copilot-cli" ? ["--host", "copilot"] : host === "codex" ? ["--host", "codex"] : []);
// VS Code Chat: the command that opens it with a query, and the custom agent (mode) to start it in.
export const CHAT_OPEN = "workbench.action.chat.open";
export const CHAT_MODE = "orchestrator-agent";
export const CHAT_HINT = "Choose orchestrator-agent in the chat's Agent dropdown, then press Enter.";

// A session's title, its terminal tab's name: "atf run acme", "atf run acme (uat)", "atf resume acme · testcases".
export function sessionTitle(argv) {
  const [cmd, product] = argv;
  const flag = (f) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : undefined);
  const env = flag("--env");
  const what = [flag("--stage"), flag("--module")].filter(Boolean).join(" ");
  return ["atf", cmd, ...(product && !product.startsWith("-") ? [product] : [])].join(" ") + (env ? ` (${env})` : "") + (what ? ` · ${what}` : "");
}

// The CLI's plan for a session (cli.cliPlan) as { pre: the node-script steps it runs first (the doctor), prompt: the
// first prompt it would give the agent } | { error }.
export function sessionPlan(plan) {
  if (plan?.error) return { error: plan.error };
  const steps = plan?.steps;
  if (!Array.isArray(steps) || !steps.length || !steps.at(-1).agent || typeof steps.at(-1).prompt !== "string") return { error: "the CLI's plan has no agent session to open" };
  const pre = steps.slice(0, -1);
  if (pre.some((s) => !s.script)) return { error: `the CLI's plan has a step the extension can't run (${pre.find((s) => !s.script).other ?? "?"})` };
  return { pre, prompt: steps.at(-1).prompt };
}

// The doctor's checks (doctor.mjs --json: {id, group, ok, level, detail, fix}) as rows: fail (blocks the stages that
// need it), warn, ok; problems first.
export function doctorRows(checks) {
  const status = (c) => (!c.ok && c.level !== "warn" ? "fail" : !c.ok || c.level === "warn" ? "warn" : "ok");
  const order = { fail: 0, warn: 1, ok: 2 };
  return (checks ?? []).map((c) => ({ status: status(c), detail: String(c.detail ?? c.id ?? ""), fix: c.fix ? String(c.fix) : null })).sort((a, b) => order[a.status] - order[b.status]);
}
const ICON = { fail: "$(error)", warn: "$(warning)", ok: "$(pass)" };

// A sweep's dry run (ledger.mjs sweep --dry-run): what it would delete and what is left to the human, as quick-pick rows.
const entityLabel = (e) => `${e.type} ${e.label ?? e.ref}`;
export function sweepRows(dry) {
  return {
    del: (dry.wouldDelete ?? []).map((e) => ({ label: `$(trash) ${entityLabel(e)}`, description: `${e.module} · run ${e.runId}`, detail: `${e.method} ${e.url}`, runId: e.runId })),
    manual: (dry.manual ?? []).map((e) => ({ label: `$(tools) ${entityLabel(e)}`, description: `${e.module} · run ${e.runId}`, detail: `clean up by hand: ${e.reason}` })),
  };
}
export const sweepHosts = (dry) => [...new Set((dry.wouldDelete ?? []).map((e) => { try { return new URL(e.url).host; } catch { return null; } }).filter(Boolean))];
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const walk = (nodes, fn) => {
  for (const n of nodes) {
    fn(n);
    if (n.children) walk(n.children, fn);
  }
};

// registerSheets/registerReport: the other owners' register functions (src/sheets/index.js, src/report.js).
// cliOptions: passed on to createCli (tests give it a fake spawn); environmentOptions: to createEnvironment (tests give
// it fake Node.js finders); env: the extension host's environment (the registry token it may carry); now: the clock (the
// pending New product… marker).
export function start(vscode, context, { registerSheets, registerReport, cliOptions = {}, environmentOptions, env = process.env, now = Date.now } = {}) {
  const output = vscode.window.createOutputChannel("atf");
  context.subscriptions.push(output);
  const workspace = createWorkspace(vscode);
  context.subscriptions.push(workspace);
  const cli = createCli({ vscode, workspace, output, ...cliOptions });
  context.subscriptions.push({ dispose: () => cli.dispose?.() });
  const deps = { vscode, workspace, cli, output };
  const guarded = (name, fn) => {
    try {
      return fn();
    } catch (e) {
      output.appendLine(`atf: ${name} failed to load: ${e.stack ?? e.message}`);
      return null;
    }
  };
  output.appendLine(workspace.ok ? `atf: workspace ${workspace.root}, ${workspace.framework} ${workspace.frameworkVersion}` : workspace.message);

  const runs = guarded("the Products view", () => registerRuns(context, deps));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.name = "atf";
  status.command = "atf.refresh";
  context.subscriptions.push(status);
  const showState = () => {
    if (workspace.ok) return status.hide();
    status.text = "$(warning) atf";
    status.tooltip = `${workspace.message}\nClick to check again.`;
    status.show();
  };
  showState();
  context.subscriptions.push(workspace.onDidRefresh(showState));

  // ---- the host setting -------------------------------------------------------------------------------------------------

  const config = () => vscode.workspace.getConfiguration("atf");
  const currentHost = () => hostOf(config().get("host"));
  // The old value `copilot` is read as copilot-cli (hostOf), and rewritten where it is set so the Settings editor
  // stops flagging it. Best effort: a settings file VS Code can't write keeps working through hostOf.
  async function migrateHostSetting() {
    try {
      const cfg = config();
      const seen = cfg.inspect?.("host");
      if (!seen || typeof cfg.update !== "function") return;
      const T = vscode.ConfigurationTarget ?? { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
      for (const [key, target] of [["globalValue", T.Global], ["workspaceValue", T.Workspace], ["workspaceFolderValue", T.WorkspaceFolder]])
        if (LEGACY_HOSTS[seen[key]]) {
          await cfg.update("host", LEGACY_HOSTS[seen[key]], target);
          output.appendLine(`atf: the atf.host setting '${seen[key]}' is now '${LEGACY_HOSTS[seen[key]]}' (the same Copilot CLI session)`);
        }
    } catch (e) {
      output.appendLine(`atf: atf.host could not be migrated (${e.message}); 'copilot' still reads as copilot-cli`);
    }
  }
  void migrateHostSetting();
  const setHost = async (host) => {
    try {
      await config().update?.("host", host, (vscode.ConfigurationTarget ?? { Workspace: 2 }).Workspace);
    } catch (e) {
      output.appendLine(`atf: atf.host could not be set (${e.message})`);
    }
  };

  // ---- picking what a command works on --------------------------------------------------------------------------------

  // { product, environment } from the node a menu passed, else asked. null: nothing to work on (already said why).
  const pickTarget = async (node, { placeHolder, offerNew = false } = {}) => {
    const products = workspace.products();
    if (node?.product) {
      const p = products.find((x) => x.product === node.product);
      const envs = p?.environments.map((e) => e.name) ?? [DEFAULT_ENV];
      if (node.environment) return { product: node.product, environment: node.environment };
      if (envs.length === 1) return { product: node.product, environment: envs[0] };
      const env = await vscode.window.showQuickPick(envs, { placeHolder: `The environment of ${node.product}` });
      return env ? { product: node.product, environment: env } : null;
    }
    const items = products.flatMap((p) => p.environments.map((e) => ({ label: p.product, description: e.name === DEFAULT_ENV ? "" : e.name, target: { product: p.product, environment: e.name } })));
    if (!items.length) {
      void offerNewProduct("atf: no products yet. Create one first: its run-config says what to test and where.");
      return null;
    }
    if (offerNew) items.push({ label: "$(add) New product…", description: "set up its run-config yourself, or let the orchestrator interview you", newProduct: true });
    if (items.length === 1 && items[0].target) return items[0].target;
    const chosen = await vscode.window.showQuickPick(items, { placeHolder: placeHolder ?? "The product" });
    if (chosen?.newProduct) return { newProduct: true };
    return chosen?.target ?? null;
  };

  const offerNewProduct = async (text) => {
    if ((await vscode.window.showInformationMessage(text, "New product…")) === "New product…") return vscode.commands.executeCommand("atf.newProduct");
  };

  const needWorkspace = () => {
    if (workspace.ok) return true;
    vscode.window.showWarningMessage(workspace.message);
    return false;
  };
  const showOutput = async (thenable) => {
    if ((await thenable) === "Show output") output.show(true);
  };
  const failed = (text) => showOutput(vscode.window.showErrorMessage(text, "Show output"));

  // The stages (and their modules) the tree shows for a product's environment.
  const stagesOf = (product, environment) => {
    const found = new Map();
    walk(runs?.nodes() ?? [], (n) => {
      if (n.kind === "stage" && n.active && n.product === product && n.environment === environment) {
        if (!found.has(n.stage)) found.set(n.stage, new Set());
        if (n.module) found.get(n.stage).add(n.module);
      }
    });
    return found;
  };

  // ---- background commands ------------------------------------------------------------------------------------------

  // One command in the background behind a cancellable notification that shows its latest line. ATF_ENV is the
  // command's own (--env, or a plan step's env), never one VS Code happened to inherit. npm: "npm" | "npx" runs that
  // tool (cli.runNpm, D-107) instead of atf. A registry token in env is masked in every line.
  // -> { result: { code, cancelled } | undefined, error: CliError | undefined, lines: [{ line, stream }] }
  async function background(args, { title, cwd, framework, script, env = {}, npm }) {
    const lines = [];
    let result;
    let error;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (progress, token) => {
      const onLine = (line, stream) => {
        lines.push({ line, stream });
        if (line.trim()) progress.report({ message: line.trim().length > 120 ? `${line.trim().slice(0, 117)}…` : line.trim() });
      };
      try {
        const opts = { cwd, env: { ATF_ENV: "", ...env }, onLine, token, redact: env[TOKEN_ENV] ? [env[TOKEN_ENV]] : [] };
        result = npm ? await cli.runNpm(npm, args, opts) : await cli.runStreaming(args, { ...opts, framework, script });
      } catch (e) {
        error = e;
      }
    });
    return { result, error, lines };
  }

  // atf sync in the background: the Sync host files command, and Install the framework after its npm install.
  const syncHostFiles = () => background(["sync"], { title: "atf sync: the host files" });

  // The result of a background command: a CliError, a cancel, success (ok(lines) says it), or a failure with why.
  // more: extra buttons offered with the message, handled by onAction.
  async function report(name, { result, error, lines }, { ok, more = [], onAction } = {}) {
    if (error) return failed(`atf: ${error.message}`);
    if (result.cancelled) return void vscode.window.showWarningMessage(`atf: ${name} was cancelled.`);
    const said = ok?.(lines) ?? `${name}: done.`;
    const a =
      result.code === 0
        ? await vscode.window.showInformationMessage(said.startsWith("atf ") ? said : `atf: ${said}`, ...more, "Show output")
        : await vscode.window.showErrorMessage(`atf: ${name} failed: ${failureReason(lines) ?? `exit ${result.code}`}`, ...more, "Show output");
    if (a === "Show output") output.show(true);
    else if (a) return onAction?.(a);
  }

  // What the installed CLI would run for argv (cli.cliPlan), or null after saying why it can't.
  async function planOf(argv) {
    try {
      const plan = await cli.cliPlan(argv);
      if (plan.error) return void vscode.window.showErrorMessage(`atf: ${plan.error}`);
      return plan;
    } catch (e) {
      return void failed(`atf: ${e.message}`);
    }
  }

  // ---- the doctor -----------------------------------------------------------------------------------------------------

  // `atf doctor <p>` is the CLI's doctor step (its plan: doctor.mjs <config> --fix), run with --json so its checks can
  // be shown one per line with their fixes. Its installs (npm, Playwright's browser, k6) ask nothing.
  async function doctor(t) {
    const label = `atf doctor ${t.product}${t.environment === DEFAULT_ENV ? "" : ` (${t.environment})`}`;
    const plan = await planOf(["doctor", t.product, ...envArgs(t.environment)]);
    if (!plan) return;
    const step = plan.steps?.length === 1 && plan.steps[0].script ? plan.steps[0] : null;
    if (!step) return void vscode.window.showErrorMessage(`atf: ${label}: the CLI's plan is not one doctor step; run it from a terminal instead`);
    const run = await background([...step.args, "--json"], { title: label, script: step.script, cwd: step.cwd, env: { ATF_ENV: step.env?.ATF_ENV ?? "" } });
    if (run.error || run.result.cancelled) return report(label, run);
    const json = lastJson(run.lines);
    if (!Array.isArray(json?.checks)) return report(label, { ...run, result: { ...run.result, code: run.result.code || 1 } });
    const rows = doctorRows(json.checks);
    const fails = rows.filter((r) => r.status === "fail").length;
    const warns = rows.filter((r) => r.status === "warn").length;
    const fixed = json.fixed?.length ? ` It ran: ${json.fixed.join("; ")}.` : "";
    if (!fails && !warns) {
      const a = await vscode.window.showInformationMessage(`atf: ${label}: all set for ${json.scope} (${plural(rows.length, "check")}).${fixed}`, "Show checks");
      if (a !== "Show checks") return;
    }
    return showChecks(`${label}: ${fails ? `${plural(fails, "blocking problem")}` : "no blocking problem"}${warns ? `, ${plural(warns, "warning")}` : ""}`, rows, fixed);
  }
  async function showChecks(title, rows, fixed = "") {
    const items = rows.map((r) => ({ label: `${ICON[r.status]} ${r.detail}`, description: r.status, ...(r.fix && r.status !== "ok" ? { detail: `fix: ${r.fix}` } : {}) }));
    items.push({ label: "$(output) Show output", description: "the doctor's full output, in the atf channel", output: true });
    const chosen = await vscode.window.showQuickPick(items, { title, placeHolder: `Each check, its status and its fix.${fixed}`, matchOnDescription: true, matchOnDetail: true });
    if (chosen?.output) output.show(true);
  }

  // ---- the check before a session (D-110) -----------------------------------------------------------------------------

  // The product's dependency check (the CLI's `atf doctor <p>` step, its plan), with --json: { rows (doctorRows),
  // fixable } | null after saying why it couldn't run. fix: let it run its installs first.
  async function productChecks(t, { fix }) {
    const label = `atf doctor ${t.product}${t.environment === DEFAULT_ENV ? "" : ` (${t.environment})`}`;
    const plan = await planOf(["doctor", t.product, ...envArgs(t.environment), ...(fix ? [] : ["--no-fix"])]);
    if (!plan) return null;
    const step = plan.steps?.length === 1 && plan.steps[0].script ? plan.steps[0] : null;
    if (!step) return void vscode.window.showErrorMessage(`atf: ${label}: the CLI's plan is not one doctor step`);
    const run = await background([...step.args, "--json"], { title: `${label}: ${fix ? "installing what it can" : "checking what the run needs"}`, script: step.script, cwd: step.cwd, env: { ATF_ENV: step.env?.ATF_ENV ?? "" } });
    if (run.error || run.result.cancelled) return void report(label, run);
    const json = lastJson(run.lines);
    if (!Array.isArray(json?.checks)) return void report(label, { ...run, result: { ...run.result, code: run.result.code || 1 } });
    return { rows: doctorRows(json.checks), fixable: json.checks.some((c) => c.fixable && !c.ok) };
  }

  const showEnvironment = () => vscode.commands.executeCommand(`${COCKPIT_VIEW}.focus`);

  // A run or resume session starts only here: on a Node.js the framework accepts (else the guard refuses every tool
  // call of the session, D-109), and with the product's dependency check passing, unless the human chooses Start
  // anyway (the run's own stage gate then stops exactly the stages that need what is missing) or turned the product
  // check off (atf.checkBeforeRun: false; the Node.js check always runs). -> whether to start.
  async function gateSession(argv, t) {
    const title = sessionTitle(argv);
    const { row } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${title}: checking Node.js…` }, () => machine.sessionNode());
    if (!row.ok) {
      const best = row.choices?.[0];
      const use = best ? `Use Node ${best.version}` : null;
      const a = await vscode.window.showErrorMessage(`atf: ${row.detail}. The session would be refused at its first step.`, { modal: true, detail: row.fix ?? undefined }, ...(use ? [use] : []), "Show environment");
      if (use && a === use) {
        await machine.pin(best.path);
        return (await machine.sessionNode({ withChoices: false })).row.ok && gateSession(argv, t);
      }
      if (a === "Show environment") void showEnvironment();
      return false;
    }
    if (config().get("checkBeforeRun") === false) return true;
    for (let fixed = false; ; fixed = true) {
      const checks = await productChecks(t, { fix: fixed });
      if (!checks) return false;
      const fails = checks.rows.filter((r) => r.status === "fail");
      if (!fails.length) return true;
      const fixAgain = !fixed && checks.fixable ? "Fix and check again" : null;
      const a = await vscode.window.showWarningMessage(
        `atf: ${title}: ${plural(fails.length, "problem")} would stop stages of this run.`,
        { modal: true, detail: fails.map((r) => `• ${r.detail}${r.fix ? `\n  fix: ${r.fix}` : ""}`).join("\n") },
        ...(fixAgain ? [fixAgain] : []),
        "Start anyway",
        "Show checks",
      );
      if (a === "Start anyway") return true;
      if (a === "Show checks") void showChecks(`${title}: what the run needs`, checks.rows);
      if (!fixAgain || a !== fixAgain) return false;
    }
  }

  // ---- agent sessions -------------------------------------------------------------------------------------------------

  // argv: what `atf` runs (run, resume, an intent's explore/testcases/automate/k6, or interview, with --env);
  // t: { product, environment } (the check before a session on the run's stages, and the chat's environment check).
  async function openSession(argv, { product, environment } = {}, host = currentHost(), { gated = false } = {}) {
    if (!gated && GATED_COMMANDS.includes(argv[0]) && !(await gateSession(argv, { product, environment: environment ?? DEFAULT_ENV }))) return;
    const title = sessionTitle(argv);
    if (host === "copilot-chat") return chatSession(argv, { title, environment });
    try {
      await cli.runInTerminal([...argv, ...hostCliArgs(host)], { name: title, location: vscode.TerminalLocation?.Editor });
    } catch (e) {
      vscode.window.showErrorMessage(e.message);
    }
  }

  // VS Code Chat: the CLI's pre-check in the background, then the chat opened on the CLI's first prompt, which the
  // human sends (isPartialQuery: never submitted for them). The prompt comes from the installed CLI's plan, as the
  // Copilot host would get it.
  async function chatSession(argv, { title, environment }) {
    const available = await (async () => vscode.commands.getCommands?.(true))().catch(() => null);
    if (!Array.isArray(available) || !available.includes(CHAT_OPEN)) {
      const a = await vscode.window.showWarningMessage(
        `atf: VS Code Chat is not available here (no ${CHAT_OPEN}): install or enable GitHub Copilot Chat, or open the session in an editor terminal instead.`,
        "Use Claude Code",
        "Use Copilot CLI",
      );
      const host = a === "Use Claude Code" ? "claude" : a === "Use Copilot CLI" ? "copilot-cli" : null;
      if (!host) return;
      await setHost(host);
      return openSession(argv, { environment }, host, { gated: true });
    }
    // The CLI gives a session ATF_ENV=<env>; a chat session can't be given it, so its agents would use `default`.
    if (environment && environment !== DEFAULT_ENV) {
      const a = await vscode.window.showWarningMessage(
        `atf: VS Code Chat can't give its session ATF_ENV=${environment}, so the run's agents would work in the default environment. Open the ${environment} session in Copilot CLI instead?`,
        { modal: true },
        "Open in Copilot CLI",
      );
      if (a === "Open in Copilot CLI") return openSession(argv, { environment }, "copilot-cli", { gated: true });
      return;
    }
    const plan = await planOf([...argv, "--host", "copilot"]);
    if (!plan) return;
    const sp = sessionPlan(plan);
    if (sp.error) return void vscode.window.showErrorMessage(`atf: ${title}: ${sp.error}`);
    const notes = [];
    for (const step of sp.pre) {
      const run = await background(step.args, { title: `${title}: checking what it needs`, script: step.script, cwd: step.cwd, env: { ATF_ENV: step.env?.ATF_ENV ?? "" } });
      if (run.error || run.result.cancelled || run.result.code !== 0) return report(`${title} (its check)`, run);
      const blocked = run.lines.find((l) => l.line.startsWith("Blocked until fixed:"));
      if (blocked) notes.push(blocked.line.trim());
    }
    const query = { query: sp.prompt, isPartialQuery: true };
    try {
      await vscode.commands.executeCommand(CHAT_OPEN, { ...query, mode: CHAT_MODE });
    } catch (e) {
      // `mode` is not a documented field: without it the human picks the agent
      output.appendLine(`atf: ${CHAT_OPEN} with mode ${CHAT_MODE} failed (${e.message}); opening the chat without it`);
      try {
        await vscode.commands.executeCommand(CHAT_OPEN, query);
      } catch (e2) {
        return failed(`atf: could not open VS Code Chat: ${e2.message}`);
      }
    }
    if (notes.length) void showOutput(vscode.window.showWarningMessage(`atf: ${title}: ${notes.join(" ")} The run's stage gate stops exactly those stages.`, "Show output"));
    vscode.window.showInformationMessage(CHAT_HINT);
  }

  // ---- the sweep --------------------------------------------------------------------------------------------------------

  // "Sweep leftovers…" (D-075, confirmed in the extension, user 2026-10-29): between runs, the live entities ended runs
  // left in the target, deleted through their recorded cleanup recipes. A dry run first (it sends nothing), shown as a
  // list; only when something would be deleted: a modal warning, then the product slug typed, then the sweep through
  // its one-time confirmation file. The script checks everything again (no active run, a full-run config, the slug).
  async function sweep(t) {
    const label = `atf sweep ${t.product}${t.environment === DEFAULT_ENV ? "" : ` (${t.environment})`}`;
    const env = { ATF_ENV: t.environment === DEFAULT_ENV ? "" : t.environment };
    let dry;
    try {
      dry = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${label}: what would be deleted…` }, () =>
        cli.runJson(["sweep", t.product, "--dry-run"], { script: path.join("scripts", "ledger.mjs"), env, allowExit: [0, 1] }),
      );
    } catch (e) {
      return failed(`atf: ${e.message}`);
    }
    if (dry.errors?.length) return void vscode.window.showWarningMessage(`atf: ${label}: ${dry.errors.join("; ")}`);
    const rows = sweepRows(dry);
    output.appendLine(`atf: ${label} (dry run): ${plural(rows.del.length, "entity", "entities")} to delete, ${rows.manual.length} to clean up by hand`);
    for (const r of [...rows.del, ...rows.manual]) output.appendLine(`  ${r.label.replace(/^\$\([\w-]+\) /, "")} (${r.description}): ${r.detail}`);
    const separator = (label) => ({ label, kind: vscode.QuickPickItemKind?.Separator ?? -1 });
    const listed = [...(rows.del.length ? [separator("Would be deleted"), ...rows.del] : []), ...(rows.manual.length ? [separator("Left for you to clean up by hand"), ...rows.manual] : [])];
    if (!rows.del.length) {
      if (!rows.manual.length) return void vscode.window.showInformationMessage(`atf: ${label}: nothing is left over from ended runs.`);
      const a = await vscode.window.showInformationMessage(`atf: ${label}: nothing to delete. ${plural(rows.manual.length, "entity", "entities")} must be cleaned up by hand.`, "Show the list");
      if (a === "Show the list") await vscode.window.showQuickPick(listed, { title: `${label}: left for you`, matchOnDetail: true });
      return;
    }
    // what to delete: every ended run's leftovers, or one run's
    const byRun = new Map();
    for (const r of rows.del) byRun.set(r.runId, (byRun.get(r.runId) ?? 0) + 1);
    const actions = [
      { label: `$(trash) Delete all ${rows.del.length}…`, description: byRun.size > 1 ? `from ${byRun.size} ended runs` : `from run ${[...byRun.keys()][0]}`, run: null, count: rows.del.length, action: true },
      ...(byRun.size > 1 ? [...byRun].map(([runId, count]) => ({ label: `$(trash) Delete run ${runId}'s ${count}…`, description: "--run", run: runId, count, action: true })) : []),
    ];
    const chosen = await vscode.window.showQuickPick([...actions, ...listed], { title: `${label}: ${rows.del.length} to delete, ${rows.manual.length} by hand`, placeHolder: "Choose what to delete; the list below is what the dry run found", matchOnDetail: true, ignoreFocusOut: true });
    if (!chosen?.action) return;
    const hosts = sweepHosts(dry);
    const warn = await vscode.window.showWarningMessage(
      `atf: this deletes live data in ${hosts.join(", ") || "the target"}.`,
      { modal: true, detail: `${plural(chosen.count, "entity", "entities")} that ended runs of ${t.product} left${chosen.run ? ` (run ${chosen.run})` : ""} will be deleted through their recorded delete endpoints, and recorded as deleted in the ledger. This can't be undone.` },
      "Continue…",
    );
    if (warn !== "Continue…") return;
    const typed = await vscode.window.showInputBox({
      title: label,
      prompt: `Type the product slug ${t.product} to delete these ${plural(chosen.count, "entity", "entities")}`,
      ignoreFocusOut: true,
      validateInput: (v) => (v === t.product ? null : `Type ${t.product} exactly to confirm`),
    });
    if (typed !== t.product) return; // cancelled (or not the slug): nothing written, nothing run
    const lines = [];
    let result;
    let error;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${label}: deleting…`, cancellable: true }, async (progress, token) => {
      try {
        result = await cli.confirmedRun("sweep", { product: t.product, environment: t.environment, run: chosen.run ?? undefined }, { typed, token, onLine: (line, stream) => lines.push({ line, stream }) });
      } catch (e) {
        error = e;
      }
    });
    if (error || result.cancelled) return report(label, { error, result, lines });
    const out = lastJson(lines);
    if (out?.errors?.length || !out) return failed(`atf: ${label}: ${out?.errors?.join("; ") ?? failureReason(lines) ?? `exit ${result.code}`}`);
    const said = [`deleted ${out.deleted.length}`, ...(out.failed.length ? [`${out.failed.length} failed`] : []), ...(out.manual.length ? [`${out.manual.length} to clean up by hand`] : [])].join(", ");
    void runs?.refresh?.();
    return showOutput((out.failed.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(`atf: ${label}: ${said}.`, "Show output"));
  }

  // ---- the project and the registry token (D-107) ----------------------------------------------------------------------

  const registry = createRegistry({ vscode, context, env });
  const project = createProjectFlows({ vscode, context, workspace, output, registry, background, failed, syncHostFiles, now, platform: cliOptions.platform ?? process.platform });

  // ---- the environment and the Cockpit (D-110) ----------------------------------------------------------------

  // this machine's environment (not an atf environment such as uat): its Node.js and the framework's machine check
  const machine = createEnvironment(deps, { platform: cliOptions.platform ?? process.platform, ...(environmentOptions ?? {}) });
  context.subscriptions.push(machine);
  const productNode = (t) => ({ kind: "product", product: t.product, environment: t.environment });
  // `atf login <p>` in the background: the login browser (the default one when Chromium-based, D-118) opens on the
  // target, the human signs in, the session is saved and the window closes by itself
  async function login(product) {
    const label = `atf login ${product}`;
    const run = await background(["login", product], { title: `${label}: sign in in the browser window; it closes by itself` });
    return report(label, run, {
      ok: () => `${product}: your login is saved. Next: start the run.`,
      more: run.result?.code === 0 ? ["Start run"] : [],
      onAction: (a) => a === "Start run" && vscode.commands.executeCommand("atf.run", productNode({ product, environment: DEFAULT_ENV })),
    });
  }
  const cockpit = guarded("the Cockpit", () =>
    registerCockpit(context, deps, {
      environment: machine,
      actions: {
        run: (t) => vscode.commands.executeCommand("atf.run", productNode(t)),
        doctor: (t) => vscode.commands.executeCommand("atf.doctor", productNode(t)),
        openConfig: (t) => vscode.commands.executeCommand("atf.openConfig", productNode(t)),
        interview: () => openSession(["interview"]),
        login,
        command: (id) => vscode.commands.executeCommand(id),
        // the pipeline's actions (D-111): src/cockpit.js has checked each target against the product list and C1
        intent: (i) => openSession(intentArgv(i.intent, i), i),
        resume: (t) => openSession(["resume", t.product, "--stage", t.stage, ...(t.module ? ["--module", t.module] : []), ...envArgs(t.environment)], t),
        openSheet: (t) => vscode.commands.executeCommand(t.sheet === "approval" ? "atf.openApproval" : "atf.openClarifications", { kind: "module", product: t.product, module: t.module }),
        openTab: (t) => vscode.commands.executeCommand(OPEN_COCKPIT, t),
        sweep,
      },
    }),
  );
  // the Cockpit's editor tab: its sessions go through the same gated openSession, its sweep through the same flow
  const cockpitPanel = guarded("the Cockpit's editor tab", () => registerCockpitPanel(context, deps, { actions: { session: (argv, t) => openSession(argv, t), sweep } }));

  // ---- the commands -------------------------------------------------------------------------------------------------

  const commands = {
    "atf.refresh": () => {
      workspace.detect({ fire: true });
    },
    // atf init in the background, in the folder, with the framework installed there (it is not a workspace yet). Its
    // npm install reads the workspace's .npmrc, so the registry token goes into its environment when there is one.
    "atf.init": async () => {
      const folders = workspace.folders();
      if (!folders.length) return void vscode.window.showWarningMessage("atf: open a folder first; atf init creates the workspace in it.");
      let folder = workspace.root ?? workspace.folder ?? (folders.length === 1 ? folders[0] : null);
      if (!folder) folder = await vscode.window.showQuickPick(folders, { placeHolder: "The folder to create the atf workspace in" });
      if (!folder) return;
      const fw = findFramework(folder);
      if (!fw) return project.offerCreate(`atf: ${folder} has no ${FRAMEWORK_PACKAGE} installed. ${CREATE_HINT} installs it from the registry and sets the project up.`, folder);
      const token = await registry.token();
      const run = await background(["init"], { title: `atf init in ${path.basename(folder)}`, cwd: folder, framework: fw.dir, env: token ? registryEnv(token) : {} });
      workspace.detect({ fire: true });
      return report("atf init", run, {
        ok: () => `the atf workspace is ready in ${folder}. Next: create a product (New product…), then start its run.`,
        more: ["New product…"],
        onAction: (a) => a === "New product…" && vscode.commands.executeCommand("atf.newProduct"),
      });
    },
    "atf.sync": async () => {
      if (!needWorkspace()) return;
      return report("atf sync", await syncHostFiles(), { ok: (lines) => lastLine(lines) ?? "the host files are up to date." });
    },
    "atf.check": async () => {
      if (!needWorkspace()) return;
      const run = await background(["check"], { title: "atf check: the host files" });
      return report("atf check", run, {
        ok: (lines) => lastLine(lines) ?? "the host files are in sync with the framework.",
        more: run.result?.code ? ["Sync now"] : [],
        onAction: (a) => a === "Sync now" && vscode.commands.executeCommand("atf.sync"),
      });
    },
    "atf.doctor": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product to check" });
      if (t) return doctor(t);
    },
    "atf.validate": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product whose run-config to validate" });
      if (!t) return;
      const label = `atf validate ${t.product}${t.environment === DEFAULT_ENV ? "" : ` (${t.environment})`}`;
      return report(label, await background(["validate", t.product, ...envArgs(t.environment)], { title: label }), { ok: () => `${label}: the run-config is valid.` });
    },
    "atf.sweep": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product whose leftovers to sweep" });
      if (t) return sweep(t);
    },
    "atf.run": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product to run", offerNew: true });
      if (t?.newProduct) return vscode.commands.executeCommand("atf.newProduct");
      if (t) return openSession(["run", t.product, ...envArgs(t.environment)], t);
    },
    "atf.resume": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product whose run to resume" });
      if (!t) return;
      const known = stagesOf(t.product, t.environment);
      let stage = node?.kind === "stage" ? node.stage : null;
      if (!stage) stage = await vscode.window.showQuickPick(known.size ? [...known.keys()] : STAGES, { placeHolder: "The stage to resume (it and the stages that depend on it run again)" });
      if (!stage) return;
      let module = node?.kind === "stage" || node?.kind === "module" ? node.module : null;
      const modules = [...(known.get(stage) ?? [])];
      if (!module && node?.kind !== "stage" && modules.length) {
        const every = "$(list-flat) Every module";
        const pick = await vscode.window.showQuickPick([every, ...modules], { placeHolder: `The module to resume ${stage} for` });
        if (!pick) return;
        module = pick === every ? null : pick;
      }
      return openSession(["resume", t.product, "--stage", stage, ...(module ? ["--module", module] : []), ...envArgs(t.environment)], t);
    },
    // "New product…" (user, 2026-10-29): a new product starts with its run-config. Every step can be cancelled, and a
    // cancel runs nothing. how: "config" | "interview" skips the first pick (anything else, a tree node, is ignored).
    "atf.newProduct": async (how) => {
      if (!needWorkspace()) return;
      const way = NEW_PRODUCT_WAYS.find((w) => w.how === how) ?? (await vscode.window.showQuickPick(NEW_PRODUCT_WAYS, { title: "New product", placeHolder: "How to create the product's run-config" }));
      if (!way) return;
      // the interview is an agent session, opened as atf.run opens one; the form is the Cockpit's
      if (way.how === "interview") return openSession(["interview"]);
      if (way.how === "form") {
        await showEnvironment();
        return cockpit?.openForm();
      }
      const product = await vscode.window.showInputBox({
        title: "New product (1/3)",
        prompt: "The product's name: a lowercase kebab-case slug. Its run-config is config/<name>.yaml.",
        placeHolder: "acme-crm",
        ignoreFocusOut: true,
        validateInput: (v) => productNameProblem(workspace.root, v),
      });
      if (product === undefined) return;
      const slug = product.trim();
      const url = await vscode.window.showInputBox({ title: "New product (2/3)", prompt: `The URL of the ${slug} target atf tests`, placeHolder: "https://crm.example.com", ignoreFocusOut: true, validateInput: targetUrlProblem });
      if (url === undefined) return;
      const login = await vscode.window.showQuickPick(LOGIN_CHOICES, { title: "New product (3/3)", placeHolder: `Sign in to ${url.trim()} now? The run reuses the saved session.`, ignoreFocusOut: true });
      if (!login) return;
      // the boxes may have stayed open while the file appeared; the CLI refuses it too, this only says it plainly
      const problem = productNameProblem(workspace.root, slug) ?? targetUrlProblem(url);
      if (problem) return void vscode.window.showWarningMessage(`atf: ${problem}`);
      return createConfig(slug, url.trim(), { login: login.login });
    },
    // A product's (or an environment's) run-config in an editor; asked among them when there are several.
    "atf.openConfig": async (node) => {
      if (!needWorkspace()) return;
      const configs = workspace.products().flatMap((p) => p.environments.filter((e) => e.config).map((e) => ({ product: p.product, environment: e.name, config: e.config })));
      const mine = node?.product ? configs.filter((c) => c.product === node.product && (!node.environment || c.environment === node.environment)) : configs;
      if (!mine.length)
        return offerNewProduct(node?.product ? `atf: ${node.product}${node.environment && node.environment !== DEFAULT_ENV ? ` (${node.environment})` : ""} has no run-config in config/.` : "atf: no run-configs yet.");
      const items = mine.map((c) => ({ label: node?.product ? c.environment : c.product, description: node?.product ? c.config : `${c.environment === DEFAULT_ENV ? "" : `${c.environment} · `}${c.config}`, config: c.config }));
      const chosen = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { placeHolder: node?.product ? `The run-config of ${node.product} to open` : "The run-config to open" });
      if (chosen) return openFile(chosen.config);
    },
    // D-107: the project and the registry token (src/project.js). No argument is taken from the command itself: a
    // command link can't point Create new project… at a folder.
    "atf.createProject": () => project.createProject(),
    "atf.openProject": () => project.openProject(),
    "atf.connect": () => registry.connect(),
    "atf.forgetToken": () => registry.forget(),
    "atf.installFramework": () => project.installFramework(),
  };

  // ---- New product…: atf config in the background --------------------------------------------------------------------

  const openFile = (rel) => vscode.window.showTextDocument(workspace.uri(...rel.split("/")), { preview: false });
  const offerConfig = async (show, product, text, ...more) => {
    const a = await show(text, "Open config", "Start run", ...more);
    if (a === "Open config") return openFile(configFileOf(product));
    if (a === "Start run") return vscode.commands.executeCommand("atf.run", { kind: "product", product, environment: DEFAULT_ENV });
    if (a === "Show output") return output.show(true);
  };

  // `atf config` as a child process behind a cancellable notification, which follows its steps from its output: the
  // file is written first, then (with a login) the doctor readies the browser and the login waits for the human.
  // A cancel kills the process tree; whatever was already written stays, as in a terminal.
  async function createConfig(product, url, { login }) {
    const file = configFileOf(product);
    const lines = [];
    let result = null;
    let error = null;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `New product ${product}`, cancellable: true }, async (progress, token) => {
      progress.report({ message: `Creating ${file}…` });
      const onLine = (line, stream) => {
        lines.push({ line, stream });
        if (!login) return;
        const open = /^(.+?) is open on \S+: sign in/.exec(line); // scripts/lib/login.mjs, once the window is up
        if (open) progress.report({ message: `Waiting for you to sign in in ${open[1]}… It closes by itself once you are signed in.` });
        else if (line.startsWith(`Created ${file}`)) progress.report({ message: "Opening the browser for the login…" });
      };
      try {
        result = await cli.runStreaming(configArgs(product, url, { login }), { env: { ATF_ENV: "" }, onLine, token });
      } catch (e) {
        error = e;
      }
    });
    const created = existsSync(path.join(workspace.root, ...file.split("/")));
    if (created) {
      void runs?.refresh(); // the config/*.yaml watcher would too; this does not depend on it
      workspace.detect(); // atf.hasProducts
    }
    const info = (...a) => vscode.window.showInformationMessage(...a);
    const warn = (...a) => vscode.window.showWarningMessage(...a);
    if (error) {
      if ((await vscode.window.showErrorMessage(`atf: ${error.message}`, "Show output")) === "Show output") output.show(true);
      return;
    }
    if (result.cancelled) return created ? offerConfig(warn, product, `atf: ${file} is created; the login was cancelled. Log in later with npx atf login ${product}.`) : undefined;
    if (result.code === 0) return offerConfig(info, product, `atf: ${file} is ready${login ? ", with your login saved" : ""}. Fill in its modules, knowledge.references and testcases.output_format, then start the run.`);
    const why = failureReason(lines) ?? `exit ${result.code}`;
    if (created) return offerConfig((...a) => vscode.window.showErrorMessage(...a), product, `atf: ${file} is created, but the login failed: ${why}`, "Show output");
    const a = await vscode.window.showErrorMessage(`atf: atf config ${product} failed: ${why}`, "Show output");
    if (a === "Show output") output.show(true);
  }
  for (const [id, fn] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // the workspace appears (atf init) or its package does (npm install): check again; a run-config appearing or going
  // away changes atf.hasProducts
  const redetect = () => workspace.detect();
  for (const glob of ["**/atf/atf.json", "**/config/*.{yaml,yml}"]) {
    const w = vscode.workspace.createFileSystemWatcher(glob);
    w.onDidCreate(redetect);
    w.onDidDelete(redetect);
    w.onDidChange(redetect);
    context.subscriptions.push(w);
  }
  context.subscriptions.push(vscode.window.onDidCloseTerminal(redetect), vscode.workspace.onDidChangeWorkspaceFolders(redetect));

  // Without a project the Products view's welcome content says so, with its buttons (Create new project…, Open existing
  // project…): no message on top of it. The other states get one, with the button that fixes them.
  const ACTIONS = { noWorkspace: workspace.folder ? [INIT_BUTTON] : [], noFramework: [INSTALL_BUTTON], badMarker: ["Check again"] };
  if (ACTIONS[workspace.state]?.length) {
    void Promise.resolve(vscode.window.showWarningMessage(workspace.message, ...ACTIONS[workspace.state])).then((a) => {
      if (a === INIT_BUTTON) return vscode.commands.executeCommand("atf.init");
      if (a === INSTALL_BUTTON) return vscode.commands.executeCommand("atf.installFramework");
      if (a === "Check again") return vscode.commands.executeCommand("atf.refresh");
    });
  }
  // a project this extension just created, in the window that reloaded on it: straight to New product…
  void project.resumePending().catch((e) => output.appendLine(`atf: the pending New product… could not start (${e.message})`));

  // the sheets return { refresh }: atf.refresh and a changed detection refresh their views too
  const sheets = registerSheets ? guarded("the clarifications and approval sheets", () => registerSheets(context, deps)) : null;
  if (typeof sheets?.refresh === "function") context.subscriptions.push(workspace.onDidRefresh(() => guarded("the sheets' refresh", () => sheets.refresh())));
  const report_ = registerReport ? guarded("the report", () => registerReport(context, deps)) : null;
  return { ...deps, runs, sheets, report: report_, machine, cockpit, cockpitPanel };
}
