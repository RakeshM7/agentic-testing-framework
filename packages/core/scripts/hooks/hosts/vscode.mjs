// VS Code Copilot Chat's local agent (--host vscode: .vscode/hooks/ and each generated agent's own hook). Its payloads
// and tool names are Copilot's, so it reads them with the Copilot adapter; only the output is VS Code's own (D-040).
// VS Code parses a hook's stdout only on exit 0, blocks on exit 2 and treats any other exit as a non-blocking warning.
// On Windows it runs the hook through `powershell.exe -Command`, which turns a native exit 2 into 1, so a block by exit
// code becomes a warning and the tool runs anyway. Every verdict is therefore a decision on stdout with exit 0, which
// VS Code honours on every OS. Never block here by exit code.
export { normalize, rootOf } from "./copilot.mjs";

export function emit({ decision, rule, reason }) {
  if (decision === "allow") return 0;
  const message = decision === "deny" ? `Blocked by the framework guard (${rule}): ${reason}` : reason;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: message } }));
  return 0;
}
