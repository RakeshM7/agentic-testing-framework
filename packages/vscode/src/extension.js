// The atf VS Code extension (P-12, packaging §3.13): a UI over the atf CLI and the artifact contract, with no safety
// role. It never registers, replaces or bypasses the hooks; it writes artifacts only through the framework's scripts, or
// as a human edit to a file a human may edit; and without the licensed @testagentic/atf installed in the workspace it
// does nothing but say so.
//
// The wiring is in activate.js (tested with a fake `vscode`); this file only hands it the real API and the other
// owners' register functions: the sheets (src/sheets/index.js) and the report (src/report.js).
import * as vscode from "vscode";
import { start } from "./activate.js";
import { registerReport } from "./report.js";
import { registerSheets } from "./sheets/index.js";

export function activate(context) {
  return start(vscode, context, { registerSheets, registerReport });
}

export function deactivate() {}
