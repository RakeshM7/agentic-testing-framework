# Choose where agents run

Optional: the default is Claude Code.

- **claude**: Claude Code, in a terminal tab in the editor area.
- **copilot-chat**: VS Code Chat with GitHub Copilot. The chat opens with the run's first prompt, for you to send.
- **copilot-cli**: Copilot CLI, in a terminal tab in the editor area.
- **codex**: OpenAI Codex, in a terminal tab in the editor area. Trust the project and approve its hooks (`/hooks`) first.
- **antigravity**: Google Antigravity's `agy`, in a terminal tab in the editor area. Not yet verified on a real Antigravity.

Change it any time with the **AI host** picker at the top of the Cockpit, or in the `atf.host` setting. In the middle of a run too (when one host runs out of credits, say): close the old session, then **Run** continues the run from its files on the new host.
