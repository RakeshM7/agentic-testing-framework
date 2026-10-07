#!/usr/bin/env node
// Patches the `model:` frontmatter line in every claude-agents/*.md and
// copilot-agents/*.agent.md file from the single source of truth at
// config/models.yaml. See that file's header comment for the config format.
//
// Usage: node scripts/sync-agent-models.mjs            patch files in place
//        node scripts/sync-agent-models.mjs --check     write nothing; exit 1 if any file has drifted
//                                                       from config/models.yaml (used by CI)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelsConfigPath = path.join(repoRoot, "config", "models.yaml");

function renderYamlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.join(", ")}]`;
  }
  return String(value);
}

// Replaces the first `model: ...` line found inside the YAML frontmatter
// block (between the first two `---` lines) with `model: <newValue>`.
// Leaves every other line -- frontmatter or body -- untouched.
function patchModelLine(filePath, newValue, dryRun = false) {
  const original = readFileSync(filePath, "utf8");
  const lines = original.split("\n");

  if (lines[0].trim() !== "---") {
    throw new Error(`${filePath}: expected a YAML frontmatter block starting with '---'`);
  }
  const frontmatterEnd = lines.indexOf("---", 1);
  if (frontmatterEnd === -1) {
    throw new Error(`${filePath}: unterminated YAML frontmatter block`);
  }

  let patched = false;
  for (let i = 1; i < frontmatterEnd; i++) {
    if (/^model:\s*/.test(lines[i])) {
      lines[i] = `model: ${renderYamlValue(newValue)}`;
      patched = true;
      break;
    }
  }
  if (!patched) {
    throw new Error(`${filePath}: no 'model:' line found in frontmatter`);
  }

  const next = lines.join("\n");
  if (next === original) {
    return false;
  }
  if (!dryRun) writeFileSync(filePath, next, "utf8");
  return true;
}

function main() {
  const check = process.argv.includes("--check");
  const config = yaml.load(readFileSync(modelsConfigPath, "utf8"));
  const agents = config?.agents ?? {};

  let changed = 0;
  let skipped = 0;

  for (const [role, byPlatform] of Object.entries(agents)) {
    const targets = [
      { platform: "claude", file: path.join(repoRoot, "claude-agents", `${role}.md`) },
      { platform: "copilot", file: path.join(repoRoot, "copilot-agents", `${role}.agent.md`) },
    ];

    for (const { platform, file } of targets) {
      const value = byPlatform?.[platform];
      if (value === undefined) {
        console.warn(`skip: ${role} has no '${platform}' entry in config/models.yaml`);
        continue;
      }
      if (!existsSync(file)) {
        console.warn(`skip: ${path.relative(repoRoot, file)} does not exist yet`);
        skipped++;
        continue;
      }
      const didChange = patchModelLine(file, value, check);
      if (didChange) {
        console.log(`${check ? "DRIFT" : "updated"}: ${path.relative(repoRoot, file)} -> model: ${renderYamlValue(value)}`);
        changed++;
      }
    }
  }

  if (check) {
    console.log(`\n${changed} file(s) out of sync with config/models.yaml, ${skipped} skipped (missing).`);
    if (changed > 0) {
      console.error("Run `node scripts/sync-agent-models.mjs` to fix.");
      process.exit(1);
    }
    return;
  }
  console.log(`\n${changed} file(s) updated, ${skipped} skipped (missing).`);
}

main();
