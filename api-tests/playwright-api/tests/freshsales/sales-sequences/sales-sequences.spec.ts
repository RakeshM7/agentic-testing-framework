import { test, expect, skipIfNoSession } from '../../../fixtures/freshsales-api-fixtures';
import { B, PREFIX, createSeq, deleteSeq, seqBody, seqName, taskStep, sweep, hasStateFile, newMutCtx, isOurs, readLog, Mut } from '../../../helpers/freshsales/sales-sequences-track';

// Sales Sequences module API track (trackSlug: sales-sequences). Endpoint /crm/sales/sales_sequences, live-verified 2026-10-05.
// Safety: only Inactive (status 2) contact sequences named "ZZ Seq API ..." are created; each is logged in
// modules/sales-sequences/api/created-entities.json at creation and deleted in the same run. Never activated,
// never enrolled, no email/SMS steps. DELETE helper refuses ids not in the log. A sequence created with status 99
// became invisible AND undeletable (404) during discovery -- never send arbitrary status values.
const mine: number[] = [];
let M: Mut;
test.beforeAll(async ({ playwright }) => { if (hasStateFile()) M = await newMutCtx(playwright); });
test.afterAll(async () => { await sweep(M, mine); });

const need = () => skipIfNoSession(hasStateFile());
async function mk(name = seqName(), over: Record<string, unknown> = {}, steps?: unknown[]) {
  const c = await createSeq(M, name, over, steps);
  if (c.id) mine.push(c.id);
  return c;
}
const msg = (j: any) => (j?.errors?.message ?? []).join(' | ');
const deviation = (d: string) => test.info().annotations.push({ type: 'deviation', description: d });

function assertSeqSchema(s: any, detail = true) {
  expect(typeof s.id).toBe('number');
  expect(typeof s.name === 'string' || s.name === null).toBe(true);
  expect(s.category).toBe(2);
  expect(typeof s.status).toBe('number');
  expect(typeof s.created_at).toBe('string');
  expect(typeof s.updated_at).toBe('string');
  expect(s.entry_conditions).toHaveProperty('filter_options');
  expect(s.exit_conditions).toHaveProperty('max_days_in_campaign');
  expect(s.meta).toHaveProperty('email');
  expect(s.meta).toHaveProperty('task');
  if (detail) expect(s.stats).toEqual(expect.objectContaining({ total: expect.any(Number), active: expect.any(Number), pending: expect.any(Number), exit: expect.any(Number) }));
  if (!detail) return; // list items omit stats/shareables/permissions/step ids
  expect(Array.isArray(s.shareables)).toBe(true);
  expect(Array.isArray(s.current_user_permissions)).toBe(true);
  expect(Array.isArray(s.sales_sequence_step_ids)).toBe(true);
}

// ---------------------------------------------------------------- unauthenticated boundary (no session needed)
for (const p of [B, `${B}/402000016532`]) {
  test.describe(`GET ${p.replace(/\d+/, ':id')} (unauthenticated boundary)`, () => {
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
test('Auth: mutation without session and CSRF is rejected and creates nothing', async ({ request }) => {
  // Body is deliberately invalid and carries no session; nothing can be created.
  const r = await request.post(B, { headers: { 'Content-Type': 'application/json' }, data: { sales_sequence: {} }, maxRedirects: 0 });
  expect([401, 302, 422]).toContain(r.status());
});

// ---------------------------------------------------------------- functional
test.describe('Functional (session)', () => {
  test('GET list: 200 with sales_sequences/users/meta envelope', async () => {
    need();
    const r = await M.ctx.get(B);
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.sales_sequences)).toBe(true);
    expect(Array.isArray(j.users)).toBe(true);
    expect(j.meta).toHaveProperty('has_active_email_step');
  });

  test('POST create: Inactive contact sequence with one task step; schema + step shape', async () => {
    need();
    const { r, json, id, name } = await mk();
    expect(r.status()).toBe(200);
    expect(id).toBeTruthy();
    const s = json.sales_sequence;
    assertSeqSchema(s);
    expect(s.name).toBe(name);
    expect(s.status).toBe(2); // Inactive
    expect(s.stats.total).toBe(0);
    expect(s.sales_sequence_step_ids).toHaveLength(1);
    const st = json.sales_sequence_steps[0];
    expect(st.action_type).toBe(2);
    expect(st.position).toBe(1);
    expect(st.entity_params.title).toBe('Follow-up task');
    expect(json.schedules[0]).toEqual(expect.objectContaining({ time_zone: 'UTC', interval_hour: 11, interval_min: 30 }));
    expect(s.exit_conditions.max_days_in_campaign).toBe(21);
  });

  test('GET list includes the created sequence (and has the same schema)', async () => {
    need();
    const { id } = await mk();
    const j = await (await M.ctx.get(B)).json();
    const s = j.sales_sequences.find((x: any) => x.id === id);
    expect(s).toBeTruthy();
    assertSeqSchema(s, false); // list items omit `stats`
  });

  test('GET detail: returns the sequence, its steps and schedule', async () => {
    need();
    const { id, name } = await mk();
    const r = await M.ctx.get(`${B}/${id}`);
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.sales_sequence.id).toBe(id);
    expect(j.sales_sequence.name).toBe(name);
    expect(j.sales_sequence_steps).toHaveLength(1);
    expect(j.schedules).toHaveLength(1);
  });

  test('PUT update (full body, as the UI sends): rename persists', async () => {
    need();
    const { id, name } = await mk();
    const renamed = `${name} edited`;
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { sales_sequence: { ...seqBody(M, renamed), id } } });
    expect(r.status()).toBe(200);
    expect((await r.json()).sales_sequence.name).toBe(renamed);
    expect((await (await M.ctx.get(`${B}/${id}`)).json()).sales_sequence.name).toBe(renamed);
  });

  test('Clone (UI clone = POST of a "<name> - Copy" body): copy is independent and Inactive', async () => {
    need();
    const orig = await mk();
    const copy = await mk(`${orig.name} - Copy`);
    expect(copy.r.status()).toBe(200);
    expect(copy.id).not.toBe(orig.id);
    expect(copy.json.sales_sequence.status).toBe(2);
    const ids = (await (await M.ctx.get(B)).json()).sales_sequences.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([orig.id, copy.id]));
  });

  test('DELETE: removes only our sequence; subsequent GET and DELETE are 404', async () => {
    need();
    const { id } = await mk();
    const r = await deleteSeq(M, id!);
    expect(r.status()).toBe(200);
    expect((await r.json()).sales_sequences).toBeDefined(); // returns refreshed list envelope
    expect((await M.ctx.get(`${B}/${id}`)).status()).toBe(404);
    expect((await M.ctx.delete(`${B}/${id}`, { headers: M.hdr })).status()).toBe(404);
    expect(isOurs(id!)).toBe(true);
  });
});

// ---------------------------------------------------------------- negative
test.describe('Negative (session)', () => {
  test('POST without X-CSRF-Token -> 422 {error_code:422}', async () => {
    need();
    const r = await M.ctx.post(B, { headers: { 'Content-Type': 'application/json' }, data: { sales_sequence: seqBody(M, seqName()) } });
    expect(r.status()).toBe(422);
    expect((await r.json()).error_code).toBe(422);
  });
  test('PUT without X-CSRF-Token -> 422', async () => {
    need();
    const { id, name } = await mk();
    const r = await M.ctx.put(`${B}/${id}`, { headers: { 'Content-Type': 'application/json' }, data: { sales_sequence: seqBody(M, name + 'x') } });
    expect(r.status()).toBe(422);
  });
  test('POST empty object body -> 400 "sales_sequence can\'t be empty"', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: {} });
    expect(r.status()).toBe(400);
    expect(msg(await r.json())).toContain("sales_sequence can't be empty");
  });
  test('POST wrong root key -> 400', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { foo: 'bar' } });
    expect(r.status()).toBe(400);
  });
  test('POST missing category -> 400 "category can\'t be empty"', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: { name: seqName() } } });
    expect(r.status()).toBe(400);
    expect(msg(await r.json())).toContain("category can't be empty");
  });
  test('POST category as string -> 400', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), { category: 'contact' }) } });
    expect(r.status()).toBe(400);
  });
  test('POST unknown category 3 -> 400', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), { category: 3 }) } });
    expect(r.status()).toBe(400);
  });
  test('POST step with unknown action_type -> 400 "Error in sales sequence action."', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), {}, [taskStep(M, { action_type: 999 })]) } });
    expect(r.status()).toBe(400);
    expect(msg(await r.json())).toContain('Error in sales sequence action');
  });
  test('POST task step without title -> 400', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), {}, [taskStep(M, { entity_params: { model: 'Contact', owner: String(M.owner), due_date: { time: '11:30' } } })]) } });
    expect(r.status()).toBe(400);
  });
  test('POST exit_conditions without reply-removal flags -> 400', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), { exit_conditions: { max_days_in_campaign: 0 } }) } });
    expect(r.status()).toBe(400);
  });
  test('GET non-numeric id -> 404', async () => {
    need();
    expect((await M.ctx.get(`${B}/abc`)).status()).toBe(404);
  });
  test('GET unknown id -> 404 with CRM not-found message', async () => {
    need();
    const r = await M.ctx.get(`${B}/1`);
    expect(r.status()).toBe(404);
    expect(msg(await r.json())).toContain('not in the CRM');
  });
  test('PUT unknown id -> 404 (nothing created)', async () => {
    need();
    const r = await M.ctx.put(`${B}/1`, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName()) } });
    expect(r.status()).toBe(404);
  });
  test('DELETE unknown id -> 404 (id 1 does not exist; no pre-existing record is targeted)', async () => {
    need();
    const r = await M.ctx.delete(`${B}/1`, { headers: M.hdr });
    expect(r.status()).toBe(404);
  });
  test('deviation: category 1 (Accounts) on this tenant -> 404 "not authorised"', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), { category: 1 }) } });
    deviation('Accounts-category create returns 404 "You are not authorised to perform this operation" (API-level; the UI offered Accounts). Asserts what the API does.');
    expect(r.status()).toBe(404);
  });
});

// ---------------------------------------------------------------- boundary / validation gaps (assert actual behaviour, flag deviations)
test.describe('Boundary (session)', () => {
  test('deviation: no steps -> 500 (UI enforces "Add at least 1 step"; API should be 400)', async () => {
    need();
    const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: seqBody(M, seqName(), { sales_sequence_steps: [] }) } });
    deviation('POST with zero steps returns HTTP 500 {"error_code":500} instead of a 4xx validation error.');
    expect(r.status()).toBe(500);
  });
  test('deviation: empty name accepted (UI requires a name)', async () => {
    need();
    const c = await createSeqLoose({ name: '' });
    deviation('Empty-string name is accepted (200) server-side; the UI blocks it.');
    expect(c.status).toBe(200);
    expect(c.name).toBe('');
  });
  test('deviation: missing name accepted, name stored as null', async () => {
    need();
    const c = await createSeqLoose({ name: undefined });
    deviation('POST without a name key succeeds with name:null.');
    expect(c.status).toBe(200);
    expect(c.name).toBeNull();
  });
  test('deviation: duplicate name accepted (distinct ids)', async () => {
    need();
    const a = await mk();
    const b = await mk(a.name);
    deviation('Duplicate sequence names are allowed (TC-023).');
    expect(b.r.status()).toBe(200);
    expect(b.id).not.toBe(a.id);
  });
  for (const len of [255, 256, 300]) {
    test(`deviation: name length ${len} accepted (no server max)`, async () => {
      need();
      const name = PREFIX + ' ' + 'A'.repeat(len - PREFIX.length - 1);
      const c = await mk(name);
      deviation('No server-side max length observed (UI caps at 255).');
      expect(c.r.status()).toBe(200);
      expect(c.json.sales_sequence.name).toHaveLength(len);
    });
  }
  test('Special characters: HTML and unicode names stored verbatim (no server-side encoding)', async () => {
    need();
    for (const name of [`${PREFIX} <b>x</b> &amp;`, `${PREFIX} ünïcödé 日本語`]) {
      const c = await mk(name);
      expect(c.json.sales_sequence.name).toBe(name);
    }
  });
  test('deviation: out-of-range sequence_type values are not validated', async () => {
    need();
    const c = await mk(seqName(), { sequence_type: 99 });
    deviation('sequence_type 99 is accepted (200). Valid range undocumented; do not rely on it.');
    expect(c.r.status()).toBe(200);
  });
  test('deviation: PUT with category only (partial body) -> 500; PUT without category -> 400', async () => {
    need();
    const { id } = await mk();
    const noCat = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { sales_sequence: { name: 'x' } } });
    expect(noCat.status()).toBe(400);
    const partial = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { sales_sequence: { name: seqName(), category: 2 } } });
    deviation('Partial PUT bodies (without steps/schedule) return 500; the UI always sends the full body.');
    expect(partial.status()).toBe(500);
  });
  test('deviation: PUT changing category -> 404 not authorised', async () => {
    need();
    const { id } = await mk();
    const r = await M.ctx.put(`${B}/${id}`, { headers: M.hdr, data: { sales_sequence: { category: 1 } } });
    expect(r.status()).toBe(404);
  });
  test('list: unknown/extra query params are tolerated (200)', async () => {
    need();
    for (const q of ['?page=1&per_page=1', '?page=0', '?per_page=0', '?q=ZZ', '?category=2']) {
      const r = await M.ctx.get(`${B}${q}`);
      expect(r.status(), q).toBe(200);
    }
  });
});

async function createSeqLoose(over: { name: string | undefined }) {
  const body: any = seqBody(M, 'x');
  if (over.name === undefined) delete body.name; else body.name = over.name;
  const r = await M.ctx.post(B, { headers: M.hdr, data: { sales_sequence: body } });
  const j: any = await r.json().catch(() => ({}));
  const id = j?.sales_sequence?.id as number | undefined;
  if (id) {
    // Name does not carry the prefix, so log it explicitly with the prefix-tagged note and allow deletion.
    const { recordCreated } = await import('../../../helpers/freshsales/sales-sequences-track');
    recordCreated(id, `${PREFIX} (unnamed-probe ${over.name === undefined ? 'missing' : 'empty'})`);
    mine.push(id);
  }
  return { status: r.status(), name: j?.sales_sequence?.name, id };
}
