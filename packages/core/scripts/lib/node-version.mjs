// The Node.js the framework needs (D-109). Playwright, the browser server and every script and hook of a session run
// on the session's Node, and an older one fails only when a browser starts. So it is checked before anything else: the
// guard hook refuses every tool call of a session on an older Node, run.mjs and run-config.mjs refuse every command,
// and the doctor reports it. The package declares it as engines.node, and atf init writes the workspace's .nvmrc.
// Loaded by the guard hook, so it is safety code: human-only, and plain enough to load on any Node.
export const MIN_NODE = 20;

// -> null when version (default: this process's) is MIN_NODE or later, else {detail, fix}
export function nodeProblem(version = process.versions.node) {
  const v = String(version).replace(/^v/, "");
  if (Number(v.split(".")[0]) >= MIN_NODE) return null;
  return {
    detail: `Node.js ${v} is older than ${MIN_NODE}, which Playwright, the browser server and the framework's scripts need`,
    fix: `switch to Node.js ${MIN_NODE} or later (with nvm: nvm use, which reads the workspace's .nvmrc; or put a newer node ahead of the old one in your PATH; https://nodejs.org), check it with node -v, then start a new agent session from that terminal`,
  };
}
