// Shared by every renderer: the note that marks a file as generated (a YAML comment, so the model never reads it). It
// names the source and the builder from the workspace (`fw`: the framework's path from there, D-085).
import { expandFw } from "../../roots.mjs";

export const generatedNote = (name, fw = "") => expandFw(`# GENERATED from {fw}/agents/${name}.md by {fw}/scripts/build-agents.mjs -- edit the source, then run npm run build-agents.`, fw);

// Frontmatter lines + body -> file text, in the source's line endings.
export const assemble = (lines, body, eol) => ["---", ...lines, "---"].join(eol) + eol + body;
