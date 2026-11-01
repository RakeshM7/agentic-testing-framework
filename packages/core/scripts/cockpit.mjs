#!/usr/bin/env node
// The Cockpit's data: everything the VS Code Cockpit shows about a product, as one JSON object (D-111). Read-only: it
// writes, creates and locks nothing. The environment comes from ATF_ENV, as for every script. The shape is C1 of
// docs/cockpit-plan.md; the work is in scripts/lib/cockpit.mjs.
//
//   cockpit.mjs <product> --json
//
// Exit 0 with the object (a product with no run yet gets an empty one); 2 on a usage error; 1 with {"error": "..."} for
// an unknown product or unreadable state.
import { fileURLToPath } from "node:url";
import { workspaceRoot } from "./lib/contract.mjs";
import { cockpitData } from "./lib/cockpit.mjs";

const args = process.argv.slice(2);
const product = args.find((a) => !a.startsWith("--"));
if (!product || !args.includes("--json") || args.some((a) => a.startsWith("--") && a !== "--json") || args.filter((a) => !a.startsWith("--")).length > 1) {
  console.error("usage: cockpit.mjs <product> --json");
  process.exit(2);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await cockpitData(product, { root: workspaceRoot }), null, 2));
  } catch (e) {
    console.log(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}
