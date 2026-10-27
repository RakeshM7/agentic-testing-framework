# The atf Claude Code plugin (maintainers)

The plugin `atf`, in the private marketplace `testagentic` (`docs/packaging.md` §3.12, draft P-11). Nothing here is written by hand except this file, `README.client.md` (the plugin's README for clients) and `package.json`.

- **Build:** `node packages/core/scripts/build-plugin.mjs` (or `npm run build --workspace @testagentic/atf-claude-plugin`) writes `dist/`, which is git-ignored. Add `--marketplace <dir>` to also write `<dir>/.claude-plugin/marketplace.json` and copy the plugin to `<dir>/plugins/atf/`: that folder is the marketplace repository's content.
- **What it holds:** every framework agent (rendered like `atf sync` renders `.claude/agents/`, with `{fw}` = `node_modules/@testagentic/atf`), the browser MCP server, and one SessionStart hook that records the plugin's version in `artifacts/.atf-plugin.json`. Never the safety guard: PreToolUse and PostToolUse stay in the project's `.claude/settings.json` (D-020, D-092).
- **Version:** always `@testagentic/atf`'s. `package.json` here must carry the same version (the build fails otherwise); bump both together.
- **Release:** `.github/workflows/release.yml`, after `npm publish`, rebuilds the plugin and pushes it to the repository named by the variable `PLUGIN_MARKETPLACE_REPO` (token: secret `PLUGIN_MARKETPLACE_TOKEN`), tagged `atf-v<version>`. Without either, or on a dry run, it says so and pushes nothing.
- **Open questions:** `docs/claude-plugin-verification.md`, including the subagent-name switch (`NAMESPACED_SUBAGENTS` in `build-plugin.mjs`).
- **Tests:** `packages/core/scripts/build-plugin.test.mjs` (part of `npm test`); it also runs `claude plugin validate` on the output when the `claude` CLI is installed.
