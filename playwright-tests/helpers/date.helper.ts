export function timestamp(): string {
  return new Date().toISOString();
}

export function uniqueTimestamp(): string {
  return `${Date.now()}`;
}
