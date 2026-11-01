// The AI host an agent session opens on (the atf.host setting; D-106, D-115, D-124), shared by the session path
// (activate.js) and the Cockpit's AI host picker (cockpit.js, cockpit-sidebar-page.js). Pure; no vscode import.
//
// claude: Claude Code's CLI (its panel can't pick the agent, so `claude --agent orchestrator-agent` in an editor-area
// terminal); copilot-chat: VS Code Chat with the orchestrator-agent; copilot-cli, codex and antigravity: their CLIs the
// same way as claude (`atf run --host copilot|codex|antigravity`).
export const HOSTS = ["claude", "copilot-chat", "copilot-cli", "codex", "antigravity"];
export const LEGACY_HOSTS = { copilot: "copilot-cli" }; // the setting's value before 2026-10-29: `atf … --host copilot`
// The setting as read: an old value migrated, anything unknown the default.
export const hostOf = (value) => {
  const v = String(value ?? "").trim();
  return LEGACY_HOSTS[v] ?? (HOSTS.includes(v) ? v : "claude");
};
// The CLI's --host for a terminal session (claude is its default; scripts/lib/cli.mjs HOSTS names the rest).
const CLI_HOST = { "copilot-cli": "copilot", codex: "codex", antigravity: "antigravity" };
export const hostCliArgs = (host) => (CLI_HOST[host] ? ["--host", CLI_HOST[host]] : []);

// What the Cockpit's picker shows: each host's name, and the one line that matters before switching to it (from
// packages/core/docs/platforms.md: who the guard can name, D-035; what a human must do first; what is unverified).
export const HOST_INFO = {
  claude: { label: "Claude Code", note: "The guard knows each agent, so a full-run keeps every agent's own limits." },
  "copilot-chat": { label: "GitHub Copilot (VS Code Chat)", note: "You send the first prompt to orchestrator-agent yourself; it runs in the default environment only." },
  "copilot-cli": { label: "Copilot CLI", note: "It can't name the calling agent, so a full-run gives every call the run's combined limits. Explore and clarifications need its Playwright MCP server registered." },
  codex: { label: "OpenAI Codex", note: "Trust the project and approve its hooks (/hooks) first, or the guard check stops the run. A full-run gets the run's combined limits. Not yet verified on a real Codex." },
  antigravity: { label: "Google Antigravity", note: "Runs agy. Trust the workspace first, or the guard check stops the run. Its built-in browser is refused during a run, and a full-run gets the run's combined limits. Not yet verified on a real Antigravity." },
};

// The small warning the picker shows before it switches: what happens to the next session and, with a run in progress,
// to that run (it lives in its files: D-071 makes a stage cut off mid-way an interrupted attempt, kept to its two).
// Embedded in the page by source (cockpit-sidebar-page.js), so it reads only its arguments. info: HOST_INFO; active:
// the labels of the products with a run in progress. -> { title, lines }
export function hostSwitchNotice(info, from, to, active) {
  const a = info[from] || { label: from };
  const b = info[to] || { label: to, note: "" };
  const lines = [];
  if (active && active.length) {
    lines.push(`${active.join(", ")} ${active.length === 1 ? "has a run" : "have runs"} in progress. Close the ${a.label} session first, so two sessions don't drive one run.`);
    lines.push(`▷ Run then continues on ${b.label} from the run's files: done stages stay done; a stage cut off mid-way uses one of its 2 attempts and runs again.`);
    lines.push("What you said in the old chat carries over only where it was saved (answers, approvals).");
  } else lines.push(`The next session (Run, Resume, an intent or the interview) opens on ${b.label}. A session already open stays where it is.`);
  if (b.note) lines.push(b.note);
  return { title: `Switch the AI host to ${b.label}?`, lines };
}
