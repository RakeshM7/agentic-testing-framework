// config/mcp.yaml -> one platform's MCP config file (`mcp_config` in config/platforms.yaml): the same servers under
// the key that platform expects (.mcp.json: mcpServers, .vscode/mcp.json: servers), with every `{fw}` in a command or
// argument expanded to the framework's path from the workspace (D-085).
//
// The render is the whole file. In a client's workspace (the framework installed) the file may already hold what the
// client added by hand: a server of their own, or a key the render never produces (VS Code's `inputs`). A sync would
// silently drop it, so foreignMcpEntries names each one first and the build fails, writing nothing; the client moves
// it to where it survives (a server: the workspace's mcp.yaml overlay or ejected copy, D-088). A source checkout
// renders as it always has: every MCP file there is ours (D-018).
//
// The pinned Node.js (lib/sync.mjs, atf/machine.json "node"): in a client's workspace whose PATH node is older than
// MIN_NODE, the servers run on the Node.js sync found (pinnedServers): an `npx` command becomes that Node's own npx (a
// `node` command that Node itself), with that Node's folder first in the server's PATH, since npx and the package it
// starts look `node` up there. The rest of that PATH is the OS's system folders, not the session's PATH, so the
// rendered file is the same from every terminal and `atf check` never reports a PATH as drift. This repository's
// committed files never get a pin: the build passes none.
import { existsSync } from "node:fs";
import path from "node:path";
import { ejectedRel, overlayRel } from "./config.mjs";
import { expandFw } from "./roots.mjs";

// A pinned Node.js's absolute path -> what the servers run: { node, npx (that Node's own npx, or "npx" when it has none
// beside it), path (the servers' PATH: its folder, then the OS's system folders) }
export function mcpNodePin(nodePath, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const dir = p.dirname(nodePath);
  const npx = p.join(dir, win ? "npx.cmd" : "npx");
  const root = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  const system = win ? [p.join(root, "System32"), root, p.join(root, "System32", "Wbem"), p.join(root, "System32", "WindowsPowerShell", "v1.0")] : ["/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
  return { node: nodePath, npx: exists(npx) ? npx : "npx", path: [dir, ...system.filter((d) => d !== dir)].join(p.delimiter) };
}

// mcp.yaml's servers -> the same servers on a pinned Node.js (mcpNodePin), or as they are without one. Only an `npx` or
// `node` command changes (its env gains PATH, the server's own env kept); every other server is left alone.
export function pinnedServers(servers, pin) {
  if (!pin) return servers;
  const out = {};
  for (const [name, def] of Object.entries(servers ?? {})) {
    const command = def?.command === "npx" ? pin.npx : def?.command === "node" ? pin.node : null;
    out[name] = command ? { ...def, command, env: { ...def.env, PATH: pin.path } } : def;
  }
  return out;
}

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
