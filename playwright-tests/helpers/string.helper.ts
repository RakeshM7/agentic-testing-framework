export function uniqueId(prefix = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function randomEmail(prefix = 'automation'): string {
  return `${prefix}.${Date.now()}@example.com`;
}
