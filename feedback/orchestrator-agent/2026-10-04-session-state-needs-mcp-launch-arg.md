---
source_agent: orchestrator-agent
date: 2026-10-04
target: rakesh-freshsales-ind-sep21
related_files:
  - .mcp.json
  - claude-agents/explore-agent.md
  - docs/conventions.md
severity: blocking
---

## Finding 1: session_state_file cannot be applied by the Playwright MCP at runtime

explore-agent received sessionStateFile but @playwright/mcp@0.0.83 only accepts storage state via the `--storage-state` launch arg in .mcp.json. The crawl stopped at /login (1 page). Suggested fix: document this prerequisite in conventions.md's `session_state_file` entry and the explore-agent persona, and/or have the orchestrator pre-flight check that .mcp.json args reference the configured session file. Human action: add `"--storage-state","playwright-tests/.auth/freshsales-handoff.json"` to .mcp.json args, restart the MCP server, re-invoke.
