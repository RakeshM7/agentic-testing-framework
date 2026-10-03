#!/usr/bin/env node
// PreToolUse hook (Bash): code-level enforcement of `authorizations.mode`.
// Unless AUTHORIZATIONS_MODE=full-run is set in the environment Claude Code was launched with,
// block live load tests (`k6 run`/`k6 cloud`) and mutating HTTP verbs issued from the shell.
// Exit code 2 = block, stderr is fed back to the model.
import { readFileSync } from "node:fs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const cmd = String(input?.tool_input?.command ?? "");
if (process.env.AUTHORIZATIONS_MODE === "full-run") process.exit(0);

const rules = [
  [/\bk6\s+(run|cloud)\b/, "live k6 load tests require authorizations.mode: full-run"],
  [/\bcurl\b[^|;&]*(-X|--request)\s*['"]?(POST|PUT|PATCH|DELETE)\b/i, "mutating curl requests require full-run"],
  [/\bcurl\b[^|;&]*(-d|--data(-\w+)?|-F|--form)\b/, "curl with a request body (implicit POST) requires full-run"],
];
for (const [re, why] of rules) {
  if (re.test(cmd)) {
    console.error(
      `Blocked by .claude/hooks/guard-bash.mjs: ${why}. Mode is readonly (AUTHORIZATIONS_MODE != full-run). ` +
        "A human must relaunch with AUTHORIZATIONS_MODE=full-run for a target they are authorized to mutate."
    );
    process.exit(2);
  }
}
