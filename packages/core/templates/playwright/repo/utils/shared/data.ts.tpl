// Test data unique per run: every generated name carries ATF_RUN_ID, a timestamp and a counter, so two runs (or two
// tests) never collide and a run's own data is easy to find. Synthetic only: emails use the reserved .test domain.
import { env } from './env';

let counter = 0;

export function uniqueName(prefix: string): string {
  counter += 1;
  return `${prefix}-${env.runId()}-${Date.now().toString(36)}-${process.pid.toString(36)}${counter}`;
}

export function uniqueEmail(prefix = 'atf'): string {
  return `${uniqueName(prefix).toLowerCase().replace(/[^a-z0-9.-]/g, '-')}@example.test`;
}
