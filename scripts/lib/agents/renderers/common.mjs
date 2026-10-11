// Shared by every renderer: the note that marks a file as generated (a YAML comment, so the model never reads it).
export const generatedNote = (name) => `# GENERATED from agents/${name}.md by scripts/build-agents.mjs -- edit the source, then run npm run build-agents.`;

// Frontmatter lines + body -> file text, in the source's line endings.
export const assemble = (lines, body, eol) => ["---", ...lines, "---"].join(eol) + eol + body;
