// config/mcp.yaml -> one platform's MCP config file (`mcp_config` in config/platforms.yaml): the same servers under
// the key that platform expects (.mcp.json: mcpServers, .vscode/mcp.json: servers), with every `{fw}` in a command or
// argument expanded to the framework's path from the workspace (D-085).
//
// The render is the whole file. In a client's workspace (the framework installed) the file may already hold what the
// client added by hand: a server of their own, or a key the render never produces (VS Code's `inputs`). A sync would
// silently drop it, so foreignMcpEntries names each one first and the build fails, writing nothing; the client moves
// it to where it survives (a server: the workspace's mcp.yaml overlay or ejected copy, D-088). A source checkout
// renders as it always has: every MCP file there is ours (D-018).
import { ejectedRel, overlayRel } from "./config.mjs";
import { expandFw } from "./roots.mjs";

export function validateMcp(mcp) {
  const errors = [];
  if (!mcp || typeof mcp.servers !== "object") return ["config/mcp.yaml: needs a 'servers' mapping"];
  if (!mcp.servers[mcp.browser_server]) errors.push(`config/mcp.yaml: browser_server '${mcp.browser_server}' is not in servers`);
  return errors;
}

export const renderMcpConfig = (mcp, key, fw = "") =>
  JSON.stringify({ [key]: mcp.servers }, (k, v) => (typeof v === "string" ? expandFw(v, fw) : v), 2) + "\n";

const isMap = (v) => Object.prototype.toString.call(v) === "[object Object]";

// An installed workspace's existing MCP config file -> one error per entry the render would drop (none: [] ).
//   text      the file's current text
//   rel       its workspace-relative path, as the errors name it
//   key       the platform's server key (mcpServers, servers): the only top-level key the render writes
//   servers   the effective mcp.yaml's servers: a server under one of these names is ours, rewritten by the render
//   ejected   whether the workspace has ejected mcp.yaml: a client's server then goes in atf/config/mcp.yaml (the
//             overlay is ignored), else in the overlay atf/mcp.yaml, merged into the framework's server by server
// mcp.yaml renders only `servers`, so a top-level key such as `inputs` has no home in atf/: it must live outside this
// file. A file that isn't a JSON object can't be told apart at all, so it is an error too, never overwritten.
export function foreignMcpEntries(text, { rel, key, servers, ejected = false }) {
  const sync = "then run npx atf sync";
  const edit = ejected ? `${ejectedRel("mcp.yaml")} (your ejected copy)` : `${overlayRel("mcp.yaml")} (an overlay: its servers merge into the framework's, server by server)`;
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return [`${rel}: not valid JSON (${e.message}); atf sync renders this file whole from mcp.yaml, so it can't tell which servers are yours: fix the JSON or remove the file, ${sync}`];
  }
  if (!isMap(doc)) return [`${rel}: must be a JSON object with '${key}' (atf sync renders it from mcp.yaml); fix it or remove the file, ${sync}`];
  const errors = [];
  for (const k of Object.keys(doc)) {
    if (k === key) continue;
    errors.push(`${rel}: '${k}' is not rendered from mcp.yaml (only its servers are), so atf sync would drop it: move it out of ${rel} (atf sync renders the whole file), for example into your own user-level MCP configuration, ${sync}`);
  }
  const own = doc[key];
  if (own === undefined) return errors;
  if (!isMap(own)) return [...errors, `${rel}: '${key}' must be an object of servers; fix it or remove the file, ${sync}`];
  for (const name of Object.keys(own))
    if (!Object.hasOwn(servers ?? {}, name))
      errors.push(`${rel}: MCP server '${name}' is yours: mcp.yaml (the framework's, with your atf/ overrides) doesn't define it, so atf sync would drop it: add it under 'servers:' in ${edit}, ${sync}`);
  return errors;
}
