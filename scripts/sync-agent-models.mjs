#!/usr/bin/env node
// Patches the `model:` frontmatter line in every agent file, per platform, from the single source of truth at
// config/models.yaml. See that file's header comment for the config format.
//
// Usage: node scripts/sync-agent-models.mjs [--check]
//   --check  write nothing; exit 1 if any file's `model:` line differs from config/models.yaml (for CI).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import yaml from "js-yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// One entry per supported agent platform. To add one: list its agent dir + file naming here and add a
// `<platform>:` model value per agent in config/models.yaml.
const PLATFORMS = [{ name: "claude", dir: "claude-agents", file: (role) => `${role}.md` }];

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
const CHECK = process.argv.includes("--check");

function patchModelLine(filePath, newValue) {
  const original = readFileSync(filePath, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n"; // working copies are CRLF on Windows
  const lines = original.split(/\r?\n/);

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

  const next = lines.join(eol);
  if (next === original) {
    return false;
  }
  if (!CHECK) writeFileSync(filePath, next, "utf8");
  return true;
}

function main() {
  const config = yaml.load(readFileSync(modelsConfigPath, "utf8"));
  const agents = config?.agents ?? {};

  let changed = 0;
  let skipped = 0;

  for (const [role, byPlatform] of Object.entries(agents)) {
    const targets = PLATFORMS.map((p) => ({ platform: p.name, file: path.join(repoRoot, p.dir, p.file(role)) }));

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
      const didChange = patchModelLine(file, value);
      if (didChange) {
        console.log(`${CHECK ? "drift" : "updated"}: ${path.relative(repoRoot, file)} -> model: ${renderYamlValue(value)}`);
        changed++;
      }
    }
  }

  console.log(`\n${changed} file(s) ${CHECK ? "out of sync" : "updated"}, ${skipped} skipped (missing).`);
  if (CHECK && changed > 0) process.exit(1);
}

main();
