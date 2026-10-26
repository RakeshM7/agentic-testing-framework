// The one reader of the framework's config files (D-085): config/permissions.yaml, models.yaml, platforms.yaml,
// mcp.yaml and hooks.yaml under the framework root. Every script and lib reads them through here, so where a file
// comes from is decided in one place: today always the framework's own copy. (A workspace's run-configs,
// config/<product>.yaml, are the workspace's files, not framework config; they are read where they are named.)
//
// Dependency-free to import: the YAML parser is loaded only when a file is parsed, so the guard can read text here.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { frameworkRoot } from "./roots.mjs";

export const CONFIG_FILES = ["permissions.yaml", "models.yaml", "platforms.yaml", "mcp.yaml", "hooks.yaml"];
export const configRel = (name) => `config/${name}`;

// -> the absolute path a framework config file is read from. `framework`: the framework root (tests pass a scratch one).
export function configPath(name, { framework = frameworkRoot } = {}) {
  if (!CONFIG_FILES.includes(name)) throw new Error(`'${name}' is not a framework config file (one of: ${CONFIG_FILES.join(", ")})`);
  return path.join(framework, "config", name);
}

export const configText = (name, opts) => readFileSync(configPath(name, opts), "utf8");

let yaml;
// -> the parsed file. Throws when it is missing or not YAML, like a direct read would.
export function loadConfig(name, opts) {
  yaml ??= createRequire(import.meta.url)("js-yaml");
  return yaml.load(configText(name, opts));
}
