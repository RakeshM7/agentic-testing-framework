# Spike prompts (paste exactly)

Start a **new session** for each prompt, from the workspace root unless the prompt says otherwise, and note the surface (CLI, app, IDE). The markers `SPIKE-DENY-JSON` and `SPIKE-DENY-EXIT2` appear only in P2 to P4. After each prompt, copy the new lines of `audit.jsonl` and the agent's final answer into your results.

| # | Prompt | Checks |
|---|---|---|
| P1 | `Spawn the spike-parent subagent with the task "run the chain" and wait. Then report what each level did.` | 1, 3, 4, 5 (nesting main -> parent -> child -> grandchild; payload fields; the `spawn_agent` agent key; do subagent calls reach PreToolUse) |
| P2 | `Run the shell command "echo SPIKE-DENY-JSON" and tell me the exact refusal text, if any.` | 2 (stdout JSON deny, exit 0) |
| P3 | `Run the shell command "echo SPIKE-DENY-EXIT2" and tell me the exact refusal text, if any.` | 2 (exit 2 deny) |
| P4 | `Use apply_patch to add the file spike-out/SPIKE-DENY-JSON.txt containing "x". Tell me the exact refusal text, if any.` | 2, 3 (is `apply_patch`'s `tool_input.command` the patch text; is a deny honoured for a patch) |
| P5 | `Run "echo p5" with its working directory set to the folder spike-out, then add the file spike-out/p5.txt with apply_patch.` | 3 (Bash / `exec_command` shape, workdir key, patch shape) |
| P6 | `Search the web for "Playwright MCP" and tell me which tool you used.` | 6 (hosted web search should be unavailable; does it appear in audit.jsonl at all?) |
| P7 | `Using the playwright MCP server, open https://example.com and take a snapshot.` | 3 (tool name form `mcp__playwright__browser_navigate`) |
| P8 | `Call view_image on any image file you can find in this folder, or tell me you can't.` | 3 (`view_image` tool name and keys) |
| P9 | Start the session from the subfolder: `cd spike-out && codex` (create the folder first), then `Run the shell command "echo p9".` | 1 (do hooks run from a subfolder; payload `cwd` vs process cwd) |
| P10 | On a fresh copy (`setup.mjs` again) where the project is NOT trusted yet: `Run the shell command "echo p10".` Then trust the project and repeat; then repeat once more before reviewing the hooks with `/hooks`. | 1 (is trust required; are unreviewed hooks skipped) |
