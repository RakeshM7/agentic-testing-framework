// Copied by scripts/e2e.mjs into tests/api/e2e/ of the demo product (D-084): the rendered API fixtures against the
// demo app's REST API.
import { test, expect } from '../../../fixtures/api/base';
import { recordCreated } from '../../../utils/shared/ledger';

test('E2E-API-1 reads the contacts', async ({ api }) => {
  const r = await api.get('/api/contacts');
  expect(r.status()).toBe(200);
  expect(await r.json()).toContainEqual({ id: 1, name: 'Pre Existing' });
});

test('E2E-API-2 readonly: a POST never leaves the test', async ({ api }) => {
  test.skip(process.env.ATF_MODE === 'full-run', 'readonly only');
  await expect(api.post('/api/contacts', { data: { name: 'Never Sent' } })).rejects.toThrow(/Mutation blocked: readonly run/);
});

test('E2E-API-3 creates a contact and leaves it, recorded with its cleanup recipe @mutates', async ({ api }) => {
  const r = await api.post('/api/contacts', { data: { name: 'Left For The Sweep' } });
  expect(r.status()).toBe(201);
  const { id } = await r.json();
  recordCreated({ type: 'contact', ref: String(id), module: 'contacts', cleanup: { endpoint: 'EP-contacts-2', param: 'id' } });
});
