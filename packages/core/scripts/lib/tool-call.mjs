// The canonical tool call: what every host adapter (scripts/hooks/hosts/*.mjs) turns its hook payload into, and the
// only input the guard (scripts/lib/guard.mjs) and the decision policy (scripts/lib/decisions.mjs) accept. Keeps
// platform tool names and payload shapes out of the rules. Dependency-free.
//
//   host           a key of scripts/lib/hosts.mjs HOSTS
//   agent          the calling agent's name, ONLY from a trusted source (host payload or a build-baked --agent);
//                  undefined = unidentified (a human's own session, or a host that cannot tell)
//   kind           read | write | shell | spawn | web_fetch | web_search | browser | ask | other | unknown
//                  (`unknown` = the adapter does not know this tool; the guard fails closed on it for managed agents)
//   tool           the host's own tool name, for messages
//   command        shell: the command line
//   paths          write: every file the call writes (absolute or repo-relative)
//   urls           web_fetch: every URL fetched
//   subagent       spawn: the agent being started
//   browserAction  browser: the short Playwright tool name (scripts/lib/browser-tools.mjs)
//   sessionId      the host's session id, if any (decision confirmations are remembered per session)

export const KINDS = ["read", "write", "shell", "spawn", "web_fetch", "web_search", "browser", "ask", "other", "unknown"];

export function toolCall({ host = "unknown", agent, kind, tool = "", command, paths = [], urls = [], subagent, browserAction, sessionId } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`tool-call: unknown kind '${kind}'`);
  return {
    host,
    agent: agent || undefined,
    kind,
    tool: String(tool),
    command: command === undefined ? undefined : String(command),
    paths: paths.filter(Boolean).map(String),
    urls: urls.filter(Boolean).map(String),
    subagent: subagent || undefined,
    browserAction: browserAction || undefined,
    sessionId: sessionId || undefined,
  };
}
