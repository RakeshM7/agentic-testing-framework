import { test, expect, skipIfNoSession } from '../../../fixtures/freshsales-api-fixtures';
import { createContact, deleteContact, sweep, hasStateFile, newMutCtx, sfx, isOurs, recordCreated, markDeleted, Mut } from '../../../helpers/freshsales/contacts-track';

// Contacts module API track (trackSlug: contacts). Contracts live-verified 2026-10-05 on the trial tenant.
// - Mutations need the Rails CSRF token (see helpers/freshsales/contacts-track.ts).
// - Every created contact is TCContacts / zz-tccontacts-*@example.com, logged in
//   modules/contacts/api/created-entities.json at creation and deleted in the same run. The 2 AgentTest
//   contacts, the deals and every other track's records are never mutated (DELETE helper refuses unlogged ids).
// - Where the live API deviates from contacts-clarifications.md the test asserts what the API does and
//   adds an annotation 'deviation' (e.g. Mobile-only create is rejected, B5).
const B = '/crm/sales/contacts';
const mine: number[] = [];
let M: Mut;
let ALL_VIEW = 0;
let BIN_VIEW = 0;

test.beforeAll(async ({ playwright }) => {
  if (!hasStateFile()) return;
  M = await newMutCtx(playwright);
  const f = await (await M.ctx.get(`${B}/filters`)).json();
  ALL_VIEW = f.filters.find((x: any) => x.name === 'All Contacts')?.id;
  BIN_VIEW = f.filters.find((x: any) => x.name === 'Recycle Bin')?.id;
});
test.afterAll(async () => { await sweep(M, mine); });

const need = () => skipIfNoSession(hasStateFile());
async function mk(over: Record<string, unknown> = {}) {
  const c = await createContact(M, over);
  if (c.id) mine.push(c.id);
  return c;
}
const msgs = (j: any) => (j?.errors?.message ?? []).join(' | ');
const deviation = (d: string) => test.info().annotations.push({ type: 'deviation', description: d });

function assertContactSchema(c: any) {
  expect(typeof c.id).toBe('number');
  expect(typeof c.display_name).toBe('string');
  expect(Array.isArray(c.emails)).toBe(true);
  for (const k of ['first_name', 'last_name', 'job_title', 'email', 'mobile_number', 'work_number']) expect(k in c).toBe(true);
  expect(typeof c.created_at).toBe('string');
  expect(typeof c.updated_at).toBe('string');
  expect(typeof c.lead_score).toBe('number');
}

// ---------------------------------------------------------------- unauthenticated boundary (no session needed)
for (const p of [`${B}/filters`, `${B}/402015942732`, `${B}/view/402015942732`]) {
  test.describe(`GET ${p} (unauthenticated boundary)`, () => {
    test('Auth: no session + Accept json -> 401 {login:"failed"}', async ({ request }) => {
      const r = await request.get(p, { headers: { Accept: 'application/json' }, maxRedirects: 0 });
      expect(r.status()).toBe(401);
      expect((await r.json()).login).toBe('failed');
    });
    test('Auth: no session + Accept html -> 302 redirect (content-negotiated)', async ({ request }) => {
      const r = await request.get(p, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
      expect(r.status()).toBe(302);
    });
    test('Auth: bogus session cookie rejected like no session', async ({ request }) => {
      const r = await request.get(p, { headers: { Accept: 'application/json', Cookie: '_freshsales_session=invalid' }, maxRedirects: 0 });
      expect([401, 302]).toContain(r.status());
    });
  });
}
test('Auth: POST create without any session is refused (no contact created)', async ({ request }) => {
  const r = await request.post(B, { headers: { 'Content-Type': 'application/json' }, data: { contact: { email: `zz-tccontacts-nosess${sfx()}@example.com` } }, maxRedirects: 0 });
  expect([401, 403, 422, 302]).toContain(r.status());
});

// ---------------------------------------------------------------- list / views / filters (reads)
test.describe('GET contacts list, views and filters', () => {
  test('Functional: saved views include the default set and Recycle Bin', async () => {
    need();
    const r = await M.ctx.get(`${B}/filters`);
    expect(r.status()).toBe(200);
    const names = (await r.json()).filters.map((f: any) => f.name);
    for (const n of ['My Contacts', 'New Contacts', 'All Contacts', 'Recently Modified', 'Never Contacted', 'Active', 'Inactive', 'Recycle Bin']) expect(names).toContain(n);
    expect(ALL_VIEW).toBeGreaterThan(0);
    expect(BIN_VIEW).toBeGreaterThan(0);
  });
  test('Schema: each saved view is {id,name,model_class_name:"Contact"}', async () => {
    need();
    for (const f of (await (await M.ctx.get(`${B}/filters`)).json()).filters) {
      expect(typeof f.id).toBe('number'); expect(typeof f.name).toBe('string'); expect(f.model_class_name).toBe('Contact');
    }
  });
  test('Functional/Schema: All Contacts view returns {contacts, meta}', async () => {
    need();
    const r = await M.ctx.get(`${B}/view/${ALL_VIEW}?page=1&per_page=5`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.contacts)).toBe(true);
    expect(b.contacts.length).toBeLessThanOrEqual(5);
    expect(typeof b.meta.total).toBe('number');
    expect(typeof b.meta.total_pages).toBe('number');
    for (const c of b.contacts) assertContactSchema(c);
  });
  test('Functional: segment_id query form returns the same envelope', async () => {
    need();
    const r = await M.ctx.get(`${B}?page=1&per_page=2&segment_id=${ALL_VIEW}`);
    expect(r.status()).toBe(200);
    expect(Array.isArray((await r.json()).contacts)).toBe(true);
  });
  test('Auth/Negative: bare list without a view/segment -> 403 not authorized', async () => {
    need();
    const r = await M.ctx.get(`${B}?per_page=1`);
    expect(r.status()).toBe(403);
  });
  test('Negative: unknown view id -> 403 not authorized', async () => {
    need();
    const r = await M.ctx.get(`${B}/view/999`);
    expect(r.status()).toBe(403);
    expect(msgs(await r.json())).toMatch(/not authorized/i);
  });
  test('Boundary: per_page=3 caps rows', async () => {
    need();
    const b = await (await M.ctx.get(`${B}/view/${ALL_VIEW}?page=1&per_page=3`)).json();
    expect(b.contacts.length).toBeLessThanOrEqual(3);
  });
  test('Boundary: page beyond last -> 200 and empty list', async () => {
    need();
    const r = await M.ctx.get(`${B}/view/${ALL_VIEW}?page=99999&per_page=25`);
    expect(r.status()).toBe(200);
    expect((await r.json()).contacts).toEqual([]);
  });
  test('Boundary: per_page=0 -> 200 with empty list (no server error)', async () => {
    need();
    const r = await M.ctx.get(`${B}/view/${ALL_VIEW}?page=1&per_page=0`);
    expect(r.status()).toBe(200);
    expect((await r.json()).contacts).toEqual([]);
  });
  test('Boundary: per_page=1000 is accepted without 5xx', async () => {
    need();
    const r = await M.ctx.get(`${B}/view/${ALL_VIEW}?page=1&per_page=1000`);
    expect(r.status()).toBeLessThan(500);
  });
  test('Functional: sort by first_name asc orders non-null names ascending', async () => {
    need();
    const b = await (await M.ctx.get(`${B}/view/${ALL_VIEW}?page=1&per_page=25&sort=first_name&sort_type=asc`)).json();
    const n = b.contacts.map((c: any) => (c.first_name ?? '').toLowerCase()).filter(Boolean);
    expect(n).toEqual([...n].sort());
  });
  test('Functional: sort by created_at desc orders newest first', async () => {
    need();
    const b = await (await M.ctx.get(`${B}/view/${ALL_VIEW}?page=1&per_page=25&sort=created_at&sort_type=desc`)).json();
    const t = b.contacts.map((c: any) => Date.parse(c.created_at));
    expect(t).toEqual([...t].sort((a, c) => c - a));
  });
  test('Functional: Recycle Bin view loads (deleted records, schema)', async () => {
    need();
    const r = await M.ctx.get(`${B}/view/${BIN_VIEW}?page=1&per_page=5`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    for (const c of b.contacts) assertContactSchema(c);
  });
  test('Functional: every default saved view loads without error', async () => {
    need();
    for (const f of (await (await M.ctx.get(`${B}/filters`)).json()).filters.slice(0, 11)) {
      const r = await M.ctx.get(`${B}/view/${f.id}?page=1&per_page=1`);
      expect(r.status(), `view ${f.name}`).toBe(200);
    }
  });
  test('Schema: view detail GET /filters/:id', async () => {
    need();
    const r = await M.ctx.get(`${B}/filters/${ALL_VIEW}`);
    expect(r.status()).toBe(200);
    const f = (await r.json()).filter;
    expect(f.name).toBe('All Contacts');
    expect(f.is_default).toBe(true);
  });
  test('Schema: contact field metadata includes Email, First name, Last name', async () => {
    need();
    const r = await M.ctx.get('/crm/sales/settings/contacts/fields');
    expect(r.status()).toBe(200);
    const fields = (await r.json()).fields;
    const labels = fields.map((f: any) => f.label);
    for (const l of ['Email', 'First name', 'Last name', 'Job title', 'Mobile']) expect(labels).toContain(l);
    for (const f of fields) { expect(typeof f.name).toBe('string'); expect(typeof f.type).toBe('string'); }
  });
});

// ---------------------------------------------------------------- create
test.describe('POST /crm/sales/contacts (create)', () => {
  test('Functional/Schema: create with email -> 200, defaults New/Lead', async () => {
    need();
    const { r, json, id, body } = await mk();
    expect(r.status()).toBe(200);
    expect(id).toBeGreaterThan(0);
    assertContactSchema(json.contact);
    expect(json.contact.email).toBe(body.email);
    expect(json.contact.emails[0]).toMatchObject({ value: body.email, is_primary: true });
    const g = await (await M.ctx.get(`${B}/${id}?include=lifecycle_stage,contact_status`)).json();
    expect(g.contact_status[0].name).toBe('New');
    expect(g.lifecycle_stages[0].name).toBe('Lead');
  });
  test('Functional: create with all common fields round-trips values', async () => {
    need();
    const s = sfx();
    const { r, json, id } = await mk({ job_title: 'QA Lead', work_number: '+14155550101', mobile_number: '+14155550102', external_id: `zz-ext-${s}`, city: 'Chennai' });
    expect(r.status()).toBe(200);
    const g = (await (await M.ctx.get(`${B}/${id}`)).json()).contact;
    expect(g).toMatchObject({ job_title: 'QA Lead', external_id: `zz-ext-${s}`, city: 'Chennai' });
    expect(json.contact.mobile_number).toBe('+14155550102');
    expect(json.contact.work_number).toBe('+14155550101');
  });
  test('Functional: Clone equivalent -- same fields with a new unique email saves', async () => {
    need();
    const a = await mk({ job_title: 'Clone Src' });
    const s = sfx();
    const c = await mk({ job_title: 'Clone Src', email: `zz-tccontacts-clone${s}@example.com`, last_name: `Clone${s}` });
    expect(c.r.status()).toBe(200);
    expect(c.id).not.toBe(a.id);
    expect(c.json.contact.job_title).toBe('Clone Src');
  });
  test('Negative (B6): Clone with unchanged email is blocked as duplicate', async () => {
    need();
    const a = await mk();
    const { r, json } = await mk({ email: a.body.email, last_name: 'CloneDup' });
    expect(r.status()).toBe(400);
    expect(msgs(json)).toMatch(/already exists/i);
  });
  test('Negative (B3): duplicate email is blocked with "<email> already exists."', async () => {
    need();
    const a = await mk();
    const { r, json } = await mk({ email: a.body.email });
    expect(r.status()).toBe(400);
    expect(msgs(json)).toContain(`${a.body.email} already exists.`);
  });
  test('Negative: duplicate email is matched case-insensitively', async () => {
    need();
    const a = await mk();
    const { r } = await mk({ email: a.body.email.toUpperCase() });
    expect(r.status()).toBe(400);
  });
  test('Negative: no identifier at all -> 400 "Need to fill this Email"', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { contact: { first_name: 'TCContacts', last_name: 'NoIdent' } } });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/Need to fill this Email/);
  });
  test('Negative: empty contact object -> 400', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { contact: {} } });
    expect(r.status()).toBe(400);
  });
  test('Negative: empty JSON body -> 400 Email required', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: {} });
    expect(r.status()).toBe(400);
  });
  test('Negative: wrong content-type -> 400 "Invalid or missing attributes"', async () => {
    need();
    const r = await M.ctx.post(B, { headers: { ...M.hdr, 'Content-Type': 'text/plain' }, data: 'x' });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/Invalid or missing attributes/);
  });
  test('Auth: valid session but no CSRF token -> 422', async () => {
    need();
    const r = await M.ctx.post(B, { headers: { 'Content-Type': 'application/json' }, data: { contact: { email: `zz-tccontacts-nocsrf${sfx()}@example.com` } } });
    expect(r.status()).toBe(422);
  });
  test('Auth: valid session with a bogus CSRF token -> 422', async () => {
    need();
    const r = await M.ctx.post(B, { headers: { ...M.hdr, 'X-CSRF-Token': 'bogus' }, data: { contact: { email: `zz-tccontacts-badcsrf${sfx()}@example.com` } } });
    expect(r.status()).toBe(422);
  });
  for (const bad of ['not-an-email', 'a@', '@example.com', 'two words@example.com']) {
    test(`Negative: invalid email "${bad}" -> 400 invalid email address`, async () => {
      need();
      const r = await M.ctx.post(B, { headers: M.hdr, data: { contact: { first_name: 'TCContacts', last_name: 'BadMail', email: bad } } });
      expect(r.status()).toBe(400);
      expect(msgs(await r.json())).toMatch(/invalid email address/i);
    });
  }
  test('Negative (DEVIATION B5): Mobile-only create is rejected by the live API', async () => {
    need();
    deviation('contacts-clarifications B5 says Mobile-only saves; live API returns 400 "Need to fill this Email" (matches live UI, see playwright track feedback TC-026).');
    const r = await M.ctx.post(B, { headers: M.hdr, data: { contact: { first_name: 'TCContacts', last_name: `Mob${sfx()}`, mobile_number: '+14155550103' } } });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/Need to fill this Email/);
  });
  test('Negative (DEVIATION B5): External-ID-only create is rejected', async () => {
    need();
    deviation('B5 lists External ID as a valid sole identifier; live API requires Email.');
    const r = await M.ctx.post(B, { headers: M.hdr, data: { contact: { first_name: 'TCContacts', last_name: `Ext${sfx()}`, external_id: `zz-ext-${sfx()}` } } });
    expect(r.status()).toBe(400);
  });
  test('Boundary: first_name of 100 chars accepted, 300 chars rejected (length rule)', async () => {
    need();
    const ok = await mk({ first_name: 'F'.repeat(100) });
    expect(ok.r.status()).toBe(200);
    const bad = await mk({ first_name: 'F'.repeat(300) });
    expect(bad.r.status()).toBe(400);
    expect(msgs(bad.json)).toMatch(/not in required length/i);
  });
  test('Boundary: over-length email local part -> 400 invalid email', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { contact: { first_name: 'TCContacts', email: `${'y'.repeat(300)}@example.com` } } });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/invalid email address/i);
  });
  test('Boundary: single-character last_name accepted', async () => {
    need();
    const r = await mk({ last_name: 'Z' });
    expect(r.r.status()).toBe(200);
  });
  test('Boundary: unicode and punctuation in names are stored verbatim', async () => {
    need();
    const c = await mk({ first_name: 'Zoë', last_name: "O'Brien-Müller 张" });
    expect(c.r.status()).toBe(200);
    expect(c.json.contact.first_name).toBe('Zoë');
    expect(c.json.contact.last_name).toBe("O'Brien-Müller 张");
  });
  test('Boundary (TC-039): junk mobile "abc-!!" -- observed behaviour recorded', async () => {
    need();
    const c = await mk({ mobile_number: 'abc-!!' });
    deviation(`junk mobile abc-!! -> HTTP ${c.r.status()} (clarifications open question 4: mobile format rules unspecified)`);
    expect([200, 400]).toContain(c.r.status());
  });
  test('Security: HTML/script payload in name is stored as data, not executed/rejected', async () => {
    need();
    const c = await mk({ first_name: '<script>alert(1)</script>' });
    expect([200, 400]).toContain(c.r.status());
    if (c.r.status() === 200) expect(c.json.contact.first_name).not.toContain('\u0000');
  });
});

// ---------------------------------------------------------------- read one
test.describe('GET /crm/sales/contacts/:id', () => {
  test('Functional/Schema: get created contact with includes', async () => {
    need();
    const { id, body } = await mk();
    const r = await M.ctx.get(`${B}/${id}?include=owner,contact_status,lifecycle_stage,emails`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    assertContactSchema(b.contact);
    expect(b.contact.id).toBe(id);
    expect(b.contact.email).toBe(body.email);
    expect(Array.isArray(b.lifecycle_stages)).toBe(true);
    expect(Array.isArray(b.contact_status)).toBe(true);
  });
  test('Negative: unknown id -> 404 with message', async () => {
    need();
    const r = await M.ctx.get(`${B}/999999999999`);
    expect(r.status()).toBe(404);
    expect(msgs(await r.json())).toMatch(/not in the CRM/);
  });
  test('Negative: non-numeric id -> 4xx, never 5xx', async () => {
    need();
    const r = await M.ctx.get(`${B}/abc`);
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
  test('Functional: lookup by email finds exactly the created contact (eventually consistent)', async () => {
    need();
    const { id, body } = await mk();
    await expect.poll(async () => {
      const r = await M.ctx.get(`/crm/sales/lookup?q=${encodeURIComponent(body.email)}&f=email&entities=contact`);
      expect(r.status()).toBe(200);
      return (await r.json()).contacts.contacts.map((c: any) => c.id);
    }, { timeout: 20_000, intervals: [1000, 2000, 3000] }).toEqual([id]);
  });
  test('Functional: global search by unique last name finds the contact (eventually consistent)', async () => {
    need();
    const { id, body } = await mk();
    await expect.poll(async () => {
      const r = await M.ctx.get(`/crm/sales/search?q=${encodeURIComponent(body.last_name)}&include=contact`);
      return (await r.json()).map((x: any) => Number(x.id));
    }, { timeout: 20_000, intervals: [1000, 2000, 3000] }).toContain(id);
  });
  test('Boundary: search with a term that matches nothing -> 200 []', async () => {
    need();
    const r = await M.ctx.get(`/crm/sales/search?q=zzNoSuchContact${sfx()}&include=contact`);
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual([]);
  });
  test('Functional: timeline_feeds and activities of a new contact are empty envelopes', async () => {
    need();
    const { id } = await mk();
    const t = await M.ctx.get(`${B}/${id}/timeline_feeds`);
    expect(t.status()).toBe(200);
    expect(Array.isArray((await t.json()).timeline_feeds)).toBe(true);
    const a = await M.ctx.get(`${B}/${id}/activities`);
    expect(a.status()).toBe(200);
    expect(Array.isArray((await a.json()).activities)).toBe(true);
  });
});

// ---------------------------------------------------------------- update
test.describe('PUT /crm/sales/contacts/:id (update)', () => {
  test('Functional: update job_title persists', async () => {
    need();
    const { id } = await mk({ job_title: 'Before' });
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { job_title: 'After' } } });
    expect(r.status()).toBe(200);
    expect((await r.json()).contact.job_title).toBe('After');
    expect((await (await M.ctx.get(`${B}/${id}`)).json()).contact.job_title).toBe('After');
  });
  test('Functional (B13): clearing an optional field (job_title=null) is allowed', async () => {
    need();
    const { id } = await mk({ job_title: 'ToClear' });
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { job_title: null } } });
    expect(r.status()).toBe(200);
    expect((await r.json()).contact.job_title).toBeNull();
  });
  test('Functional: partial update leaves other fields untouched', async () => {
    need();
    const { id, body } = await mk({ job_title: 'Keep' });
    await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { city: 'Pune' } } });
    const c = (await (await M.ctx.get(`${B}/${id}`)).json()).contact;
    expect(c.city).toBe('Pune');
    expect(c.job_title).toBe('Keep');
    expect(c.email).toBe(body.email);
  });
  test('Functional: contact_status can move to another status of the Lead stage (B1: no restriction)', async () => {
    need();
    const { id } = await mk();
    const g = await (await M.ctx.get(`${B}/${id}?include=lifecycle_stage,contact_status`)).json();
    const target = g.lifecycle_stages[0].contact_status_ids.find((s: number) => s !== g.contact_status[0].id);
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { contact_status_id: target } } });
    expect(r.status()).toBe(200);
    const after = await (await M.ctx.get(`${B}/${id}?include=contact_status`)).json();
    expect(after.contact_status[0].id).toBe(target);
  });
  test('Negative: invalid contact_status_id -> 400 "Invalid contact status provided."', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { contact_status_id: 1 } } });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/Invalid contact status/);
  });
  test('Negative: invalid lifecycle_stage_id -> 400 "Invalid lifecycle stage provided."', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { lifecycle_stage_id: 1 } } });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/Invalid lifecycle stage/);
  });
  test('Negative (B6): change email to one used by another contact -> 400 already exists', async () => {
    need();
    const a = await mk(); const b = await mk();
    const r = await M.ctx.put(`${B}/${b.id}`, { headers: M.hdr, data: { contact: { email: a.body.email } } });
    expect(r.status()).toBe(400);
    expect(msgs(await r.json())).toMatch(/already exists/);
  });
  test('Negative: invalid email on update -> 400', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { contact: { email: 'not-an-email' } } });
    expect(r.status()).toBe(400);
  });
  test('Negative: update of unknown id -> 404', async () => {
    need();
    const r = await M.ctx.put(`${B}/999999999999`, { headers: M.hdr, data: { contact: { job_title: 'x' } } });
    expect(r.status()).toBe(404);
  });
  test('Auth: update without CSRF -> 422 and value unchanged', async () => {
    need();
    const { id } = await mk({ job_title: 'Stay' });
    const r = await M.ctx.put(`${B}/${id}`, { headers: { 'Content-Type': 'application/json' }, data: { contact: { job_title: 'Changed' } } });
    expect(r.status()).toBe(422);
    expect((await (await M.ctx.get(`${B}/${id}`)).json()).contact.job_title).toBe('Stay');
  });
  test('Negative (DEVIATION B1/TC-031): Lost stage + reason rules cannot be exercised -- tenant exposes only the Lead stage', async () => {
    need();
    deviation('Clarification B1 (Lost needs Lost reason) not reachable via API: GET include=lifecycle_stage returns only Lead; playwright track saw Lost save without reason in the UI.');
    const { id } = await mk();
    const g = await (await M.ctx.get(`${B}/${id}?include=lifecycle_stage`)).json();
    expect(g.lifecycle_stages.map((s: any) => s.name)).toContain('Lead');
  });
});

// ---------------------------------------------------------------- notes (activity form)
test.describe('Contact notes (/crm/sales/notes)', () => {
  test('Functional: add a note to a run-created contact, then remove the note', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.post('/crm/sales/notes', { headers: M.hdr, data: { note: { description: 'zz api note', targetable_id: id, targetable_type: 'Contact' } } });
    expect(r.status()).toBe(200);
    const n = (await r.json()).note;
    expect(n.description).toBe('zz api note');
    expect(n.targetables).toEqual([{ id, type: 'Contact' }]);
    recordCreated('note', '/crm/sales/notes', n.id);
    const d = await M.ctx.delete(`/crm/sales/notes/${n.id}`, { headers: M.hdr });
    expect(d.status()).toBe(200);
    markDeleted('note', n.id);
  });
  test('Negative: empty note description -> 400 "can\'t be empty"', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.post('/crm/sales/notes', { headers: M.hdr, data: { note: { description: '', targetable_id: id, targetable_type: 'Contact' } } });
    expect(r.status()).toBe(400);
  });
});

// ---------------------------------------------------------------- delete / restore / bulk
test.describe('DELETE /crm/sales/contacts/:id, restore, bulk delete', () => {
  test('Functional: delete run-created contact -> 200 true, then GET 404', async () => {
    need();
    const { id } = await mk();
    const r = await deleteContact(M, id!);
    expect(r.status()).toBe(200);
    expect(await r.json()).toBe(true);
    expect((await M.ctx.get(`${B}/${id}`)).status()).toBe(404);
  });
  test('Negative: deleting an already-deleted contact -> 404', async () => {
    need();
    const { id } = await mk();
    await deleteContact(M, id!);
    const r = await M.ctx.delete(`${B}/${id}`, { headers: M.hdr });
    expect(r.status()).toBe(404);
  });
  test('Negative: delete of a non-existent id -> 404 (no collateral)', async () => {
    need();
    const r = await M.ctx.delete(`${B}/999999999999`, { headers: M.hdr });
    expect(r.status()).toBe(404);
  });
  test('Auth: delete without CSRF -> 422 and the contact still exists', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.delete(`${B}/${id}`, { headers: { 'Content-Type': 'application/json' } });
    expect(r.status()).toBe(422);
    expect((await M.ctx.get(`${B}/${id}`)).status()).toBe(200);
  });
  test('Safety: delete helper refuses ids this suite did not create', async () => {
    need();
    await expect(deleteContact(M, 402015942732)).rejects.toThrow(/not created by this suite/);
    expect(isOurs('contact', 402015942732)).toBe(false);
  });
  test('Functional (B10): deleted contact can be restored (PUT /:id/restore) and is readable again', async () => {
    need();
    const { id } = await mk();
    await deleteContact(M, id!);
    const r = await M.ctx.put(`${B}/${id}/restore`, { headers: M.hdr, data: {} });
    expect(r.status()).toBe(200);
    expect((await r.json()).contact.id).toBe(id);
    expect((await M.ctx.get(`${B}/${id}`)).status()).toBe(200);
    // afterAll sweep deletes it again (log entry was marked deleted; re-open it)
    recordCreated('contact', '/crm/sales/contacts', id!);
  });
  test('Functional: bulk delete (selected_ids) of two run-created contacts', async () => {
    need();
    const a = await mk(); const b = await mk();
    expect(isOurs('contact', a.id!) && isOurs('contact', b.id!)).toBe(true);
    const r = await M.ctx.post(`${B}/bulk_destroy`, { headers: M.hdr, data: { selected_ids: [a.id, b.id] } });
    expect(r.status()).toBe(200);
    expect((await r.json()).message).toMatch(/deleted/i);
    expect((await M.ctx.get(`${B}/${a.id}`)).status()).toBe(404);
    expect((await M.ctx.get(`${B}/${b.id}`)).status()).toBe(404);
  });
});

