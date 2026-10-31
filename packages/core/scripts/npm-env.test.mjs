// The environment of every npm and npx the framework spawns (scripts/lib/npm-env.mjs, D-108): an allow-scripts
// setting npx exported is removed, in every spelling npm reads, and nothing else is.
import test from "node:test";
import assert from "node:assert/strict";
import { ALLOW_SCRIPTS_ENV, isNpm, npmEnv, spawnEnv } from "./lib/npm-env.mjs";

const INHERITED = {
  npm_config_allow_scripts: "esbuild,sharp",
  NPM_CONFIG_ALLOW_SCRIPTS: "esbuild",
  "npm_config_allow-scripts": "esbuild",
  Npm_Config_Allow_Scripts: "esbuild",
};
const KEPT = {
  PATH: "/usr/bin",
  npm_config_allow_scripts_pending: "true",
  npm_config_dangerously_allow_all_scripts: "",
  npm_config_ignore_scripts: "true",
  "npm_config_@testagentic:registry": "https://npm.pkg.github.com",
  "npm_config_//npm.pkg.github.com/:_authToken": "t0ken",
  npm_config_userconfig: "/home/me/.npmrc",
  ALLOW_SCRIPTS: "x",
  my_npm_config_allow_scripts: "x",
};

test("npmEnv removes the allow-scripts setting in every spelling npm reads, and keeps everything else", () => {
  const env = { ...INHERITED, ...KEPT };
  const out = npmEnv(env);
  assert.deepEqual(out, KEPT);
  assert.notEqual(out, env, "a new object");
  assert.deepEqual(env, { ...INHERITED, ...KEPT }, "the caller's is untouched");
  for (const k of Object.keys(INHERITED)) assert.ok(ALLOW_SCRIPTS_ENV.test(k), k);
  for (const k of Object.keys(KEPT)) assert.ok(!ALLOW_SCRIPTS_ENV.test(k), k);
  assert.deepEqual(npmEnv({}), {});
  const real = npmEnv();
  assert.equal(real.PATH ?? real.Path, process.env.PATH, "process.env by default");
});

test("spawnEnv: npm and npx (by name or path, with Windows' shims) get npmEnv; any other command its env unchanged", () => {
  for (const cmd of ["npm", "npx", "NPM", "npm.cmd", "npx.CMD", "npm.ps1", "npm.exe", "/usr/local/bin/npm", "C:\\Program Files\\nodejs\\npx.cmd", " npm "]) assert.ok(isNpm(cmd), cmd);
  for (const cmd of ["node", process.execPath, "k6", "git", "pnpm", "npm-run-all", "npmx", "/opt/npm/bin/node", "", undefined, null]) assert.ok(!isNpm(cmd), String(cmd));
  const env = { ...INHERITED, ...KEPT };
  assert.deepEqual(spawnEnv("npm", env), KEPT);
  assert.deepEqual(spawnEnv("npx", env), KEPT);
  assert.equal(spawnEnv("node", env), env, "the same object");
  assert.equal(spawnEnv("k6"), process.env);
});
