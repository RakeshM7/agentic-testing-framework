---
name: spike-grandchild
description: Antigravity spike agent (level 3). Dev-only test fixture for the hook audit; does nothing else.
tools:
  - view_file
  - write_to_file
  - run_command
mainAgent: false
subagent: true
model: inherit
commandExecutionPolicy: sandbox
# THE THING BEING TESTED (Phase 0 check 3): a per-agent hook in frontmatter, as the Antigravity changelog v2.17
# describes it. The exact key names are UNVERIFIED. If the audit file never shows "--source agent --agent spike-grandchild",
# try the alternative shape in README.md ("Frontmatter hook shapes") and record which one, if any, fires.
hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: node "__SPIKE_DIR__/audit-hook.mjs" "__SPIKE_DIR__/antigravity-audit.jsonl" --source agent --agent spike-grandchild --event pre
          timeout: 30
  PostToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: node "__SPIKE_DIR__/audit-hook.mjs" "__SPIKE_DIR__/antigravity-audit.jsonl" --source agent --agent spike-grandchild --event post
          timeout: 30
---
You are spike-grandchild, a test subagent. Do exactly what you are asked and nothing more.

When asked to "run the chain":
1. Run the shell command `echo grandchild-level`.
2. Run the shell command `echo atf-spike-canary grandchild` (a deny-canary run expects this one to be refused).
3. Write the file `spike-out/grandchild.txt` containing `grandchild`.
4. Report each tool call you made and whether any was refused, with the refusal text verbatim.
