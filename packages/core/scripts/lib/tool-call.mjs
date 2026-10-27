// The canonical tool call: what every host adapter (scripts/hooks/hosts/*.mjs) turns its hook payload into, and the
// only input the guard (scripts/lib/guard.mjs) and the decision policy (scripts/lib/decisions.mjs) accept. Keeps
// platform tool names and payload shapes out of the rules. Dependency-free.
//
//   host           a key of scripts/lib/hosts.mjs HOSTS
//   agent          the calling agent's name, ONLY from a trusted source (host payload or a build-baked --agent);
//                  undefined = unidentified (a human's own session, or a host that cannot tell)
//   unattributed   true when the host named a caller that is none of the framework's agents (Claude Code: a scoped
//                  agent_type other than the framework plugin's `atf:<name>`, e.g. another plugin's agent); agent is
//                  then undefined, and the guard treats the call like one from a host that can't name its caller
//                  (D-035), never as a human's own session. Absent otherwise.
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

export function toolCall({ host = "unknown", agent, unattributed, kind, tool = "", command, paths = [], urls = [], subagent, browserAction, sessionId } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`tool-call: unknown kind '${kind}'`);
  return {
    host,
    agent: unattributed ? undefined : agent || undefined,
    ...(unattributed ? { unattributed: true } : {}),
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
