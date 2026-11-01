// The first import of every framework script an agent runs (`node {fw}/scripts/<x>.mjs …`, typed with the session
// shell's node, which may be Homebrew's node@18 ahead of nvm's 24). On Node.js 20 or later it does nothing. On an older
// one it runs the same command again under the Node.js atf sync pinned (atf/machine.json), else the one findNode
// prefers, and this process ends as that one does (node-version.mjs gateNode). The agents' commands, and so the guard's
// allow-lists, stay as they are. With no newer Node.js installed the script carries on, and run.mjs and run-config.mjs
// refuse it (D-109).
//
// It must be each script's FIRST import: ES modules run their imports in order, so this one's subtree (node-version.mjs
// and roots.mjs, Node built-ins only) runs before the script's own, and its pending top-level await keeps the script's
// body from running at all while the child works. node-gate.test.mjs checks the order in every such script.
import { gateNode } from "./node-version.mjs";
import { workspaceRoot } from "./roots.mjs";

await gateNode({ workspace: workspaceRoot });
