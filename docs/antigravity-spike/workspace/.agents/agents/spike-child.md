---
name: spike-child
description: Antigravity spike agent (level 2). Dev-only test fixture for the hook audit; does nothing else.
tools:
  - view_file
  - write_to_file
  - run_command
  - invoke_subagent
mainAgent: false
subagent: true
model: inherit
commandExecutionPolicy: sandbox
# THE THING BEING TESTED (Phase 0 check 3): a per-agent hook in frontmatter, as the Antigravity changelog v2.17
# describes it. The exact key names are UNVERIFIED. If the audit file never shows "--source agent --agent spike-child",
# try the alternative shape in README.md ("Frontmatter hook shapes") and record which one, if any, fires.
hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: node "__SPIKE_DIR__/audit-hook.mjs" "__SPIKE_DIR__/antigravity-audit.jsonl" --source agent --agent spike-child --event pre
          timeout: 30
  PostToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: node "__SPIKE_DIR__/audit-hook.mjs" "__SPIKE_DIR__/antigravity-audit.jsonl" --source agent --agent spike-child --event post
          timeout: 30
---
You are spike-child, a test subagent. Do exactly what you are asked and nothing more.

When asked to "run the chain":
1. Run the shell command `echo child-level`.
2. Write the file `spike-out/child.txt` containing `child`.
3. Invoke the subagent spike-grandchild with the task "run the chain".
4. Report each tool call you made and whether any was refused, with the refusal text verbatim.
