# Spike prompts (type these exactly)

Start a **new conversation** for each prompt, so the audit lines of one prompt are easy to tell apart. Before each, note the time; after each, copy the new lines of `antigravity-audit.jsonl` and the agent's final answer into your results.

| # | Agent to start with | Prompt | Checks |
|---|---|---|---|
| P1 | default agent (no custom agent) | `Run the shell command "echo p1" in the folder spike-out, then list the files in this folder.` | 1, 5 |
| P2 | default agent | `Create spike-out/p2.txt containing "one", then replace "one" with "two" in it, then make two separate edits in one call: add a line "three" and a line "four".` | 1 (write_to_file, replace_file_content, multi_replace_file_content) |
| P3 | default agent | `Fetch https://example.com and summarise it in one line. Then search the web for "Playwright MCP".` | 1 (read_url_content, search_web) |
| P4 | default agent | `Ask me a multiple-choice question: red or blue?` | 1 (ask_question) |
| P5 | default agent | `Start "ping -n 30 127.0.0.1" (Windows) or "ping -c 30 127.0.0.1" (macOS/Linux) as a background task, check its status once, then stop it.` | 1 (run_command async, manage_task) |
| P6 | default agent | `Using the playwright MCP server, open https://example.com and take a snapshot of the page.` | 1 (the exact Playwright MCP tool name) |
| P7 | default agent | `Using your built-in browser, open https://example.com and evaluate document.title.` | 1 (built-in browser, evaluate_script) |
| P8 | default agent | `Define a new subagent called spike-temp that only echoes "temp", send it a message, then list your subagents.` | 1 (define_subagent, send_message, manage_subagents) |
| P9 | spike-parent | `run the chain` | 1 (invoke_subagent field), 2, 3 |
| P10 | spike-parent | `run the chain` (after `setup.mjs <dir> --deny-canary`, once per permission preset) | 4 |
| P11 | default agent | `Run the shell command "echo atf-spike-canary direct".` (after `--deny-canary`, then `--exit2`, then `--ask`) | 4 (deny form, ask prompt) |
| P12 | spike-grandchild (started directly, if the picker allows a subagent) | `run the chain` | 3, 6 (subagent: true as an entry) |
| P13 | spike-parent (its `commandExecutionPolicy` is `sandbox`) | `Do not run the chain. Run the shell command "curl -sI https://example.com" and show the first line.` | 6 (does sandbox block network?) |
| P14 | default agent | `Run the shell command "echo atf-spike-canary second-set".` (after `setup.mjs <dir> --deny-canary --second-set`; then again with the two sets swapped by hand in `.agents/hooks.json`) | 8 (two sets: order, and whether an allow overrides a deny) |
| P15 | default agent | `Run the shell command "echo p15 > p15.txt" with its working directory set to the folder spike-out (don't cd in the command).` | 9 (`Cwd`: where p15.txt lands) |
| P16 | default agent, with a second folder added to the window (App and IDE) | `Run the shell command "echo p16" in the second folder, then list the files in this folder.` | 10 (`workspacePaths` in a multi-root window) |

The canary string appears only in P11, P14 and in spike-grandchild's step 2. Don't use it anywhere else.
