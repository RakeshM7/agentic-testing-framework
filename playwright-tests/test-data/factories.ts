import { uniqueEmail, uniqueName, uniqueSuffix } from '../utils/test-data';

export function buildCustomer(overrides: Partial<{ name: string; email: string }> = {}) {
  return {
    name: overrides.name ?? uniqueName('Customer'),
    email: overrides.email ?? uniqueEmail('customer'),
  };
}

export function buildInvoice(overrides: Partial<{ number: string }> = {}) {
  return {
    number: overrides.number ?? `INV-${uniqueSuffix()}`,
  };
}
