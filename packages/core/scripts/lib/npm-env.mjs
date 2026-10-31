// The environment of every npm (and npx, which is npm exec) the framework spawns: atf init's npm install, the
// doctor's --fix autofix steps, atf setup, the Playwright project's install and compile checks. It is the caller's
// environment, minus an inherited `allow-scripts` setting (D-108, which extends D-089).
//
// Why: npm exec and npx export their effective config to the child as npm_config_* environment variables
// (@npmcli/config set-envs), so `npx @testagentic/atf init`, run by someone whose own ~/.npmrc sets `allow-scripts`,
// hands the atf process npm_config_allow_scripts. A nested npm reads that from its `env` layer, and npm 12 counts the
// `cli` and `env` layers as a command-line policy, which it refuses in a project-scoped install
// (lib/utils/resolve-allow-scripts.js: EALLOWSCRIPTS, "--allow-scripts is not allowed in project-scoped installs").
//
// Why removing it is safe: the value only arrived as an environment variable because npx exported it. The nested npm
// still reads the user's own .npmrc files (project, user, global), so the `allow-scripts` they configured there applies
// exactly as it would had they typed npm install themselves; nothing they set is lost. npm 10 and 11 don't know the
// setting at all. Every other variable is kept as it is, npm's own included: the VS Code extension passes the scope's
// registry and its token as npm_config_@testagentic:registry and npm_config_//npm.pkg.github.com/:_authToken.
//
// npm reads an npm_config_* variable case-insensitively and turns `_` (after the first character) into `-`
// (@npmcli/config loadEnv), so every spelling of the key is removed: npm_config_allow_scripts, NPM_CONFIG_ALLOW_SCRIPTS,
// npm_config_allow-scripts. A longer key (npm_config_allow_scripts_pending, another setting) is not this one.
//
// Dependency-free, pure: tests pass their own environment.
import path from "node:path";

export const ALLOW_SCRIPTS_ENV = /^npm_config_allow[-_]scripts$/i;

// `env` without the inherited allow-scripts setting, as a new object (never process.env itself, which spawn would
// otherwise share).
export function npmEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !ALLOW_SCRIPTS_ENV.test(key)));
}

// Whether `cmd` runs npm: npm or npx, by name or path (either slash), with Windows' .cmd/.ps1/.exe shims.
export const isNpm = (cmd) => typeof cmd === "string" && /^np[mx](?:\.(?:cmd|ps1|exe))?$/i.test(path.win32.basename(cmd.trim()));

// The environment to spawn `cmd` with: npmEnv(env) for npm and npx, `env` unchanged for anything else.
export const spawnEnv = (cmd, env = process.env) => (isNpm(cmd) ? npmEnv(env) : env);
