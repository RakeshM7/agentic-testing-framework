// Typed access to the environment. Values come from .env (loaded by playwright.config.ts) or the runner; nothing is
// hard-coded here, and a missing required value fails with a message naming the variable.

export type Mode = 'readonly' | 'full-run';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: add it to the .env file the run-config's credentials_file points to (names in .env.example)`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

export const env = {
  baseUrl: (): string => required('BASE_URL'),
  apiBaseUrl: (): string => optional('API_BASE_URL') ?? required('BASE_URL'),
  storageState: (): string | undefined => optional('STORAGE_STATE'),
  mode: (): Mode => (process.env.ATF_MODE === 'full-run' ? 'full-run' : 'readonly'),
  product: (): string => required('ATF_PRODUCT'),
  runId: (): string => optional('ATF_RUN_ID') ?? 'local',
  repoRoot: (): string | undefined => optional('ATF_REPO_ROOT'),
  loginUsername: (): string => required('LOGIN_USERNAME'),
  loginPassword: (): string => required('LOGIN_PASSWORD'),
{{extraAccessors}}};

export const isFullRun = (): boolean => env.mode() === 'full-run';
