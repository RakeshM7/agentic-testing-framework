# GitHub Copilot flavor — setup and platform notes

This is the Copilot-specific companion to `docs/conventions.md`, which stays platform-agnostic. Read that one first for the pipeline/artifact/feedback contract — this doc only covers what's different about running it under Copilot instead of Claude Code.

## One-time setup

1. **VS Code + GitHub Copilot Chat**, a recent enough build to support custom agents (formerly "custom chat modes") with `agents:`/`tools: ['agent']` subagent invocation. If your build only shows `.chatmode.md`-style single-mode behavior with no subagent support, `orchestrator-agent`'s automated chaining (step 3 below) won't work — fall back to invoking the six spokes by hand in the order `docs/conventions.md`'s pipeline table describes.
2. **Playwright MCP server**, registered in `.vscode/mcp.json` (already committed in this repo) and installed on first use via `npx -y @playwright/mcp@0.0.83`. This is what `explore-agent.agent.md`'s `playwright/*` tools resolve to. Confirm the tool names in that file (`browser_navigate`, `browser_snapshot`, etc.) match your installed server version — these drift between releases; check the server's own tool listing if invocation fails with an unknown-tool error.
3. Confirm `.github/agents` resolves (it's a symlink to `copilot-agents/`) and that the 7 agents there appear in VS Code's agent picker.

## What's structurally different from the Claude flavor

- **Discovery path**: `copilot-agents/*.agent.md`, symlinked into `.github/agents/` — the one path both VS Code's local Copilot Chat and GitHub's cloud coding agent read from.
- **`target:` field**: `explore-agent.agent.md` is `target: vscode` only — it needs a live, interactive Playwright MCP session that the sandboxed cloud coding agent doesn't have. Every other persona is unscoped (both surfaces).
- **No `AskUserQuestion` equivalent**: `requirements-clarification-agent`'s Pass 1 question list, and `orchestrator-agent`'s halt-on-unanswered-blocking-question report, are just plain chat responses — there's no structured question-and-wait tool on this platform. A human replies to the chat, or you pre-answer via `config/*.yaml`'s `answers`/`defaults` the same way you would for Claude Code.
- **Orchestration mechanism**: `copilot-agents/orchestrator-agent.agent.md` uses `tools: ['agent']` + an `agents:` whitelist to invoke the other six directly — real automated hub-and-spoke, not a human-followed checklist. This is a newer VS Code feature than Claude Code's `Agent` tool; the first time you run a full orchestrated pass in a new VS Code version, verify it actually calls the sub-agents (check the chat transcript for their invocations) rather than just describing what it would do.
- **No built-in web-search tool**: Copilot ships `fetch` (fetch a known URL) but no general web-search tool. `playwright-automation-agent.agent.md` (Branch B, greenfield research) and `api-testing-agent.agent.md` note this — if you want real search instead of `fetch`-only research against URLs you already know, add a web-search MCP server to `.vscode/mcp.json` and reference its tools in the relevant agent's `tools:` list as `<server-name>/<tool-name>`.

## Model / provider configuration

See `config/models.yaml`. Edit that file, then run `node scripts/sync-agent-models.mjs` from the repo root — it patches the `model:` frontmatter line in every `claude-agents/*.md` and `copilot-agents/*.agent.md` file. Copilot's `model:` field accepts a prioritized array (e.g. `[claude-sonnet-4.5, gpt-5]`); Copilot tries them in order based on what's actually enabled for your account/organization. Exact valid model ids are set by your Copilot subscription/org policy and drift over time — verify against VS Code's own model picker if a configured id is rejected.

## Everything else is shared

Artifact paths, the feedback-file schema, `authorizations.mode` semantics, and the pipeline stage order are identical to the Claude flavor and documented once in `docs/conventions.md` — not repeated here.
