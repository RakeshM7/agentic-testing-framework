// Typed accessors for the environment. Values come from `.env` (loaded by playwright.config.ts) or from the
// runner's process environment -- never hard-coded. See docs/playwright-conventions.md in the framework repo.
import path from 'path';

export type AtfMode = 'readonly' | 'full-run';

/** Project root of this Playwright repo (relative STORAGE_STATE paths resolve from here). */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function raw(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

/** Returns the value or throws a clear error naming the missing variable. */
export function required(name: string): string {
  const v = raw(name);
  if (v === undefined) {
    throw new Error(
      `Missing required environment variable ${name}. Set it in playwright-tests/<product>/.env ` +
        `(see .env.example) or in the runner's environment.`,
    );
  }
  return v;
}

/** Returns the value, or undefined when unset/empty. */
export function optional(name: string): string | undefined {
  return raw(name);
}

/** UI base URL (required for UI tests). */
export const baseUrl = (): string => required('BASE_URL');

/** API base URL (required for API tests). */
export const apiBaseUrl = (): string => required('API_BASE_URL');

/** Absolute path to a human-produced storage state, or undefined when STORAGE_STATE is not set. */
export function storageStatePath(): string | undefined {
  const v = raw('STORAGE_STATE');
  return v === undefined ? undefined : path.resolve(PROJECT_ROOT, v);
}

/**
 * Run mode. Unset means `readonly` (the safe default). Any value other than `readonly` / `full-run` is an error,
 * so a typo can never silently enable mutation.
 */
export function atfMode(): AtfMode {
  const v = raw('ATF_MODE');
  if (v === undefined || v === 'readonly') return 'readonly';
  if (v === 'full-run') return 'full-run';
  throw new Error(`Invalid ATF_MODE '${v}': expected 'readonly' or 'full-run'.`);
}

export const isFullRun = (): boolean => atfMode() === 'full-run';

export const atfProduct = (): string => required('ATF_PRODUCT');
export const atfRunId = (): string => required('ATF_RUN_ID');
export const atfRepoRoot = (): string => required('ATF_REPO_ROOT');

/** Ledger metadata; overridable by the runner, with neutral defaults. */
export const atfStage = (): string => raw('ATF_STAGE') ?? 'playwright';
export const atfAgent = (): string => raw('ATF_AGENT') ?? 'playwright-test';
