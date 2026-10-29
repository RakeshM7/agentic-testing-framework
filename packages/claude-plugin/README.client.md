# atf {{version}}: the agentic testing framework for Claude Code

This plugin gives Claude Code the framework's agents (the main `orchestrator-agent`, the domain orchestrators and their workers) and the browser MCP server they use. It is one half of a release: the other half is the npm package `@testagentic/atf` {{version}}, which runs every script the agents call and the safety guard. The plugin does nothing on its own.

## Before you install
- **A workspace.** Your test repository must have `@testagentic/atf` {{version}} installed: `npx @testagentic/atf init` creates one, and `npx atf doctor` checks it.
- **Access.** Your git client needs read access to the private marketplace repository (SSH, or `gh auth setup-git`).

## Install
In Claude Code, in your workspace:

```
/plugin marketplace add <the marketplace repository you were given>
/plugin install atf@testagentic
```

Start a run with `claude --agent atf:orchestrator-agent`.

## Versions
The plugin and the package must have the same version. Each session records the plugin's version in `artifacts/.atf-plugin.json`. `npx atf doctor` and the start of a run refuse a plugin whose version differs from the installed package. To upgrade, update both:
1. bump `@testagentic/atf` in `package.json` and run `npm install`;
2. run `/plugin marketplace update testagentic` and update `atf` in `/plugin`.

Every release is tagged `atf-v<version>` in the marketplace repository.

## Safety stays in your project
The safety guard is **not** in this plugin. `atf sync` registers it in your project's `.claude/settings.json` (PreToolUse and PostToolUse), and it checks every tool call whether the plugin is enabled, disabled or removed. Don't remove those entries. Note that `disableAllHooks: true` in any Claude Code settings file turns off every hook, the guard included.

## Customizing
The plugin's agents are the framework's defaults for this release. Your workspace's add-on fragments (`atf/agents/<name>.extra.md`) and `atf/` config overlays apply to the agent files `atf sync` writes into `.claude/agents/`, not to the plugin's. The guard always enforces your workspace's effective permissions.
