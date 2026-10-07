export interface TestUser {
  email: string;
  password: string;
}

export function uniqueSuffix(): string {
  return `${Date.now()}`;
}

export function uniqueEmail(prefix = 'agenttest'): string {
  return `${prefix}+${uniqueSuffix()}@example.com`;
}

export function uniqueName(prefix = 'AgentTest'): string {
  return `${prefix} ${uniqueSuffix()}`;
}
