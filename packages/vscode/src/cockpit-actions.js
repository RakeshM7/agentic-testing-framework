// The Cockpit's intents as `atf` commands (C5), pure and testable apart from VS Code.
//   intentArgv(intent, { product, environment, module, healStage })  the argv after `atf`, plus envArgs(environment)
//   GATED_COMMANDS                                                   the commands gateSession covers
// activate.js wires these in W9: its `intent` action opens openSession with intentArgv(...), and gateSession's covered
// commands become GATED_COMMANDS (the Node.js check plus the product's doctor).
import { envArgs } from "./workspace.js";

export const GATED_COMMANDS = ["run", "resume", "explore", "testcases", "automate", "k6"];

export function intentArgv(intent, { product, environment, module, healStage } = {}) {
  if (!product || !module) throw new Error("an intent needs a product and a module");
  const env = envArgs(environment);
  switch (intent) {
    case "explore":
    case "testcases":
    case "automate":
    case "k6":
      return [intent, product, "--module", module, ...env];
    case "heal":
      if (!healStage) throw new Error("heal needs the stage to heal (the intent's stage in the overview)");
      return ["resume", product, "--stage", healStage, "--module", module, ...env];
    default:
      throw new Error(`unknown intent: ${intent}`);
  }
}
