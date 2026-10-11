# CLAUDE.md

Claude Code reads this file; GitHub Copilot and other tools read `AGENTS.md`. Both tools follow one repo brief, imported here so the two never diverge:

@AGENTS.md

Before changing anything in the framework, read `docs/decisions.md`, as the brief above requires. In a main session, use `AskUserQuestion` to get the user's confirmation when a change conflicts with a recorded decision. As a subagent, report the conflict instead of making the change.
