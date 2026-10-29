---
name: spike-parent
description: Antigravity spike agent (level 1, entry). Dev-only test fixture for the hook audit; does nothing else.
tools:
  - view_file
  - list_dir
  - write_to_file
  - run_command
  - invoke_subagent
mainAgent: true
subagent: false
model: inherit
commandExecutionPolicy: sandbox
# THE THING BEING TESTED (Phase 0 check 3): a per-agent hook in frontmatter, as the Antigravity changelog v2.17
# describes it. The exact key names are UNVERIFIED. If the audit file never shows "--source agent --agent spike-parent",
# try the alternative shape in README.md ("Frontmatter hook shapes") and record which one, if any, fires.
hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: node "__SPIKE_DIR__/audit-hook.mjs" "__SPIKE_DIR__/antigravity-audit.jsonl" --source agent --agent spike-parent --event pre
          timeout: 30
  PostToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: node "__SPIKE_DIR__/audit-hook.mjs" "__SPIKE_DIR__/antigravity-audit.jsonl" --source agent --agent spike-parent --event post
          timeout: 30
---
You are spike-parent, a test agent. Do exactly what the human asks and nothing more.

When asked to "run the chain":
1. Run the shell command `echo parent-level`.
2. Write the file `spike-out/parent.txt` containing `parent`.
3. Invoke the subagent spike-child with the task "run the chain".
4. Report each tool call you made and whether any was refused, with the refusal text verbatim.
