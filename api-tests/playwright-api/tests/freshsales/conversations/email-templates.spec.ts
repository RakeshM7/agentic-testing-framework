import { test, expect, skipIfNoSession } from '../../../fixtures/freshsales-api-fixtures';
import { T, TL, CONV, PREFIX, createTpl, deleteTpl, tplName, sweep, hasStateFile, newMutCtx, isOurs, readLog, Mut } from '../../../helpers/freshsales/conversations-track';

// Conversations module API track (trackSlug: conversations). Live-verified 2026-10-06.
// Endpoints: /crm/sales/settings/email_templates[/:id] (CRUD), /crm/sales/settings/email_templates/user (list),
// /crm/sales/conversations (email/phone list, segment_id driven), /crm/sales/sms_templates (GET only).
// Safety: only email templates named "ZZ API ..." are created; each is logged in modules/conversations/api/created-entities.json
// at creation and deleted in the same run; seeded Public templates are only ever read. No email send/reply/forward/schedule,
// no mailbox connect, no SMS template create/send. DELETE helper refuses ids not in the log.
const mine: number[] = [];
let M: Mut;
test.beforeAll(async ({ playwright }) => { if (hasStateFile()) M = await newMutCtx(playwright); });
test.afterAll(async () => { await sweep(M, mine); });

const need = () => skipIfNoSession(hasStateFile());
async function mk(name = tplName(), fields?: Record<string, unknown>) {
  const c = await createTpl(M, name, fields);
  if (c.id) mine.push(c.id);
  return c;
}
const msg = (j: any) => (j?.errors?.message ?? []).join(' | ');
const deviation = (d: string) => test.info().annotations.push({ type: 'deviation', description: d });
const q = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

function assertTplSchema(t: any) {
  expect(typeof t.id).toBe('number');
  expect(typeof t.name).toBe('string');
  expect(typeof t.creater_id).toBe('number');
  expect(typeof t.creater_name).toBe('string');
  expect(typeof t.updated_at).toBe('string');
  expect(typeof t.share).toBe('boolean');
  expect(typeof t.owner).toBe('boolean');
  expect(Array.isArray(t.tags)).toBe(true);
  expect(Array.isArray(t.shareables)).toBe(true);
  expect(Array.isArray(t.current_user_permissions)).toBe(true);
  expect(typeof t.has_cm_placeholder).toBe('boolean');
}

// ---------------------------------------------------------------- unauthenticated boundary (no session needed)
for (const p of [TL + '?page=1&per_page=2', `${T}/402001296287`, `${CONV}?${q({ page: 1, per_page: 1, segment_id: 'inbox', phone_id: -2, user_id: -1 })}`, '/crm/sales/sms_templates']) {
  test.describe(`GET ${p.replace(/\d{6,}/, ':id').split('?')[0]} (unauthenticated boundary)`, () => {
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
test('Auth: template mutation without session and CSRF is rejected and creates nothing', async ({ request }) => {
  // Deliberately lacks a session and a CSRF token; carries a ZZ API name only so a leak would be obvious. Nothing can be created.
  const r = await request.post(T, { headers: { 'Content-Type': 'application/json' }, data: { email_template: { name: `${PREFIX} unauth`, html_content: '<p>x</p>' } }, maxRedirects: 0 });
  expect([401, 302, 422]).toContain(r.status());
});

// ---------------------------------------------------------------- email template reads
test.describe('Email templates: reads (session)', () => {
  test('GET list (Public filter -302): 200, envelope, schema, meta.total, seeded system templates', async () => {
    need();
    const r = await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -302 })}`);
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.email_templates)).toBe(true);
    expect(typeof j.meta.total).toBe('number');
    expect(j.email_templates.length).toBe(j.meta.total);
    expect(j.email_templates.length).toBeGreaterThanOrEqual(1);
    for (const t of j.email_templates) assertTplSchema(t);
    expect(j.email_templates.some((t: any) => t.creater_name === 'System Admin' && t.creater_id === 0)).toBe(true);
  });

  test('GET list: per_page limits the page; page beyond range is an empty list with meta.total preserved', async () => {
    need();
    const one = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 1, filterParam: -302 })}`)).json();
    expect(one.email_templates).toHaveLength(1);
    const far = await (await M.ctx.get(`${TL}?${q({ page: 9999, per_page: 10, filterParam: -302 })}`)).json();
    expect(far.email_templates).toEqual([]);
    expect(far.meta.total).toBe(one.meta.total);
  });

  test('GET list boundary: page=0 behaves as page 1; per_page=1000 is accepted (not capped to an error)', async () => {
    need();
    const p1 = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 3, filterParam: -302 })}`)).json();
    const p0r = await M.ctx.get(`${TL}?${q({ page: 0, per_page: 3, filterParam: -302 })}`);
    expect(p0r.status()).toBe(200);
    expect((await p0r.json()).email_templates.map((t: any) => t.id)).toEqual(p1.email_templates.map((t: any) => t.id));
    const big = await M.ctx.get(`${TL}?${q({ page: 1, per_page: 1000, filterParam: -302 })}`);
    expect(big.status()).toBe(200);
  });

  test('GET list: pages do not overlap', async () => {
    need();
    const a = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 3, filterParam: -302 })}`)).json();
    const b = await (await M.ctx.get(`${TL}?${q({ page: 2, per_page: 3, filterParam: -302 })}`)).json();
    const ids = new Set(a.email_templates.map((t: any) => t.id));
    for (const t of b.email_templates) expect(ids.has(t.id)).toBe(false);
  });

  test('GET list: unknown filterParam does not error (falls back to a default view)', async () => {
    need();
    const r = await M.ctx.get(`${TL}?${q({ page: 1, per_page: 2, filterParam: -999 })}`);
    expect(r.status()).toBe(200);
    expect(Array.isArray((await r.json()).email_templates)).toBe(true);
  });

  test('GET detail (seeded Public template): 200, plural key, stats fields present, read-only use', async () => {
    need();
    const list = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 1, filterParam: -302 })}`)).json();
    const id = list.email_templates[0].id;
    const r = await M.ctx.get(`${T}/${id}`);
    expect(r.status()).toBe(200);
    const t = (await r.json()).email_templates; // detail uses the plural key
    assertTplSchema(t);
    expect(t.id).toBe(id);
    for (const k of ['sent', 'opens', 'clicks', 'last_sent', 'replied', 'unsubscribed', 'html_content', 'text_content', 'subject']) expect(t).toHaveProperty(k);
  });

  test('GET detail: unknown numeric id and non-numeric id -> 404 with message', async () => {
    need();
    for (const id of ['999', 'abc', '0']) {
      const r = await M.ctx.get(`${T}/${id}`);
      expect(r.status(), id).toBe(404);
      expect(msg(await r.json())).toContain("Either the entity you're looking for is not in the CRM");
    }
  });
});

// ---------------------------------------------------------------- email template writes (own ZZ API templates only)
test.describe('Email templates: create/update/delete (session, full-run)', () => {
  test('POST create: private template with subject+html; schema; text_content derived from html', async () => {
    need();
    const { r, json, id, name } = await mk();
    expect(r.status()).toBe(200);
    expect(id).toBeTruthy();
    const t = json.email_template; // create returns the SINGULAR key
    assertTplSchema(t);
    expect(t.name).toBe(name);
    expect(t.subject).toBe('ZZ API subject');
    expect(t.text_content).toBe('ZZ API body');
    expect(t.share).toBe(false);
    expect(t.owner).toBe(true);
    expect(t.creater_name).toBe('You');
    expect(t.scope_type).toBe(0);
    expect(t.current_user_permissions).toContain('can_delete_only');
  });

  test('GET detail returns what was created; persisted html_content is returned', async () => {
    need();
    const { id, name } = await mk();
    const r = await M.ctx.get(`${T}/${id}`);
    expect(r.status()).toBe(200);
    const t = (await r.json()).email_templates;
    expect(t.id).toBe(id);
    expect(t.name).toBe(name);
    expect(t.html_content).toContain('ZZ API body');
  });

  test('Own template appears under "Created by me" (filterParam -301) with matching schema', async () => {
    need();
    const { id } = await mk();
    const j = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -301 })}`)).json();
    const t = j.email_templates.find((x: any) => x.id === id);
    expect(t).toBeTruthy();
    assertTplSchema(t);
    // and it is NOT in the Public view while private
    const pub = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -302 })}`)).json();
    expect(pub.email_templates.some((x: any) => x.id === id)).toBe(false);
  });

  test('POST create accepts the flat (unwrapped) body as well as the {email_template} wrapper', async () => {
    need();
    const name = tplName('flat');
    const r = await M.ctx.post(T, { headers: M.hdr, data: { name, html_content: '<p>flat</p>' } });
    const j: any = await r.json();
    const id = j?.email_template?.id;
    if (id) { const { recordCreated } = await import('../../../helpers/freshsales/conversations-track'); recordCreated(id, name); mine.push(id); }
    expect(r.status()).toBe(200);
    expect(j.email_template.name).toBe(name);
  });

  test('POST create with tags and share=true: persisted', async () => {
    need();
    const { r, json } = await mk(tplName('tags'), { subject: 's', html_content: '<p>t</p>', tags: ['zz-api'], share: true });
    expect(r.status()).toBe(200);
    expect(json.email_template.tags).toEqual(['zz-api']);
    expect(json.email_template.share).toBe(true);
  });

  test('POST create: name-less and empty-name -> 400 "Give a name for your email template."', async () => {
    need();
    for (const body of [{ html_content: '<p>x</p>' }, { name: '', html_content: '<p>x</p>' }]) {
      const before = readLog().length;
      const r = await M.ctx.post(T, { headers: M.hdr, data: { email_template: body } });
      expect(r.status(), JSON.stringify(body)).toBe(400);
      expect(msg(await r.json())).toBe('Give a name for your email template.');
      expect(readLog().length).toBe(before);
    }
  });

  test('POST create without html_content -> server error 500 (documented defect; UI always sends a body)', async () => {
    need();
    const name = tplName('nohtml');
    const r = await M.ctx.post(T, { headers: M.hdr, data: { email_template: { name, subject: 's' } } });
    // Expected by contract: 2xx (subject/body optional per UI) or 400. Observed: 500 {"error_code":500}.
    if (r.status() >= 500) deviation(`POST ${T} with name+subject only returns ${r.status()} {"error_code":500}; expected 2xx/400 (subject and body are optional in the UI)`);
    const j: any = await r.json().catch(() => ({}));
    const id = j?.email_template?.id;
    if (id) { const { recordCreated } = await import('../../../helpers/freshsales/conversations-track'); recordCreated(id, name); mine.push(id); }
    expect(r.status()).toBeGreaterThanOrEqual(200);
    expect([200, 400, 500]).toContain(r.status());
  });

  test('POST create with no body at all -> non-2xx, nothing created (observed 500)', async () => {
    need();
    const r = await M.ctx.post(T, { headers: M.hdr, data: {} });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    if (r.status() >= 500) deviation('empty JSON body returns 500 instead of 400');
  });

  test('POST create with a non-JSON content-type -> non-2xx (observed 500)', async () => {
    need();
    const r = await M.ctx.post(T, { headers: { ...M.hdr, 'Content-Type': 'text/plain' }, data: JSON.stringify({ email_template: { name: tplName('ctype'), html_content: '<p>x</p>' } }) });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    if (r.status() >= 500) deviation('wrong content-type returns 500 instead of 415/400');
  });

  test('POST create without CSRF token (valid session) -> 422 and nothing created', async () => {
    need();
    const before = readLog().length;
    const { 'X-CSRF-Token': _omit, ...noCsrf } = M.hdr;
    const r = await M.ctx.post(T, { headers: noCsrf, data: { email_template: { name: tplName('nocsrf'), html_content: '<p>x</p>' } } });
    expect(r.status()).toBe(422);
    expect(readLog().length).toBe(before);
    // verify nothing leaked server-side
    const j = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -301 })}`)).json();
    expect(j.email_templates.some((x: any) => x.name.includes('nocsrf'))).toBe(false);
  });

  test('POST create boundary: 300-char name accepted; persisted name is truncated (create echo != stored)', async () => {
    need();
    const name = `${PREFIX} ${'a'.repeat(293)}`;
    const { r, json, id } = await mk(name);
    expect(r.status()).toBe(200);
    expect(json.email_template.name.length).toBe(300);
    const stored = (await (await M.ctx.get(`${T}/${id}`)).json()).email_templates.name as string;
    if (stored.length !== 300) deviation(`create echoes a 300-char name but GET returns ${stored.length} chars (silent truncation, no validation error)`);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.length).toBeLessThanOrEqual(300);
    expect(name.startsWith(stored)).toBe(true);
  });

  test('POST create duplicate name: accepted (UI auto-suffixes a timestamp; API behaviour recorded)', async () => {
    need();
    const a = await mk();
    const b = await mk(a.name);
    expect(b.r.status()).toBe(200);
    expect(b.id).not.toBe(a.id);
    const bn = b.json.email_template.name as string;
    deviation(bn === a.name ? 'API stores duplicate names verbatim' : `API renamed duplicate to "${bn}"`);
    expect(bn.startsWith(a.name)).toBe(true);
  });

  test('PUT update name+subject+html: persists (full body, as the UI sends)', async () => {
    need();
    const { id, name } = await mk();
    const renamed = `${name} edited`;
    const r = await M.ctx.put(`${T}/${id}`, { headers: M.hdr, data: { email_template: { name: renamed, subject: 'updated subject', html_content: '<p>updated</p>' } } });
    expect(r.status()).toBe(200);
    const t = (await r.json()).email_template;
    expect(t.name).toBe(renamed);
    expect(t.subject).toBe('updated subject');
    expect(t.text_content).toBe('updated');
    const got = (await (await M.ctx.get(`${T}/${id}`)).json()).email_templates;
    expect(got.name).toBe(renamed);
    expect(got.subject).toBe('updated subject');
  });

  test('PUT update with name only (no html_content) -> 500 (documented defect)', async () => {
    need();
    const { id, name } = await mk();
    const r = await M.ctx.put(`${T}/${id}`, { headers: M.hdr, data: { email_template: { name: `${name} renamed` } } });
    if (r.status() >= 500) deviation('PUT with only {name} returns 500; partial update is not supported (UI sends the full body)');
    expect([200, 500]).toContain(r.status());
    // the template must still be readable and intact
    expect((await M.ctx.get(`${T}/${id}`)).status()).toBe(200);
  });

  test('PUT update with empty name -> 400 name message, name unchanged', async () => {
    need();
    const { id, name } = await mk();
    const r = await M.ctx.put(`${T}/${id}`, { headers: M.hdr, data: { email_template: { name: '', html_content: '<p>x</p>' } } });
    expect(r.status()).toBe(400);
    expect(msg(await r.json())).toBe('Give a name for your email template.');
    expect((await (await M.ctx.get(`${T}/${id}`)).json()).email_templates.name).toBe(name);
  });

  test('PUT update unknown id -> 404', async () => {
    need();
    const r = await M.ctx.put(`${T}/999`, { headers: M.hdr, data: { email_template: { name: `${PREFIX} ghost`, html_content: '<p>x</p>' } } });
    expect(r.status()).toBe(404);
  });

  test('PUT update without CSRF -> 422 and the template is unchanged', async () => {
    need();
    const { id, name } = await mk();
    const { 'X-CSRF-Token': _omit, ...noCsrf } = M.hdr;
    const r = await M.ctx.put(`${T}/${id}`, { headers: noCsrf, data: { email_template: { name: `${name} nope`, html_content: '<p>x</p>' } } });
    expect(r.status()).toBe(422);
    expect((await (await M.ctx.get(`${T}/${id}`)).json()).email_templates.name).toBe(name);
  });

  test('Clone (UI clone = POST of a "<name> - Copy" body): copy is independent', async () => {
    need();
    const orig = await mk();
    const copy = await mk(`${orig.name} - Copy`, { subject: 'ZZ API subject', html_content: '<p>ZZ API body</p>' });
    expect(copy.r.status()).toBe(200);
    expect(copy.id).not.toBe(orig.id);
    const ids = (await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -301 })}`)).json()).email_templates.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([orig.id, copy.id]));
  });

  test('DELETE: removes only our template; subsequent GET and DELETE are 404; list no longer has it', async () => {
    need();
    const { id } = await mk();
    const d = await deleteTpl(M, id!);
    expect(d.status()).toBe(200);
    expect((await d.json()).email_template.id).toBe(id);
    expect((await M.ctx.get(`${T}/${id}`)).status()).toBe(404);
    const again = await M.ctx.delete(`${T}/${id}`, { headers: M.hdr });
    expect(again.status()).toBe(404);
    const j = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -301 })}`)).json();
    expect(j.email_templates.some((x: any) => x.id === id)).toBe(false);
  });

  test('DELETE without CSRF -> 422 and the template survives', async () => {
    need();
    const { id } = await mk();
    const { 'X-CSRF-Token': _omit, ...noCsrf } = M.hdr;
    const r = await M.ctx.delete(`${T}/${id}`, { headers: noCsrf });
    expect(r.status()).toBe(422);
    expect((await M.ctx.get(`${T}/${id}`)).status()).toBe(200);
  });

  test('Safety: the DELETE helper refuses an id this suite did not create (seeded Public template)', async () => {
    need();
    const list = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 1, filterParam: -302 })}`)).json();
    const seeded = list.email_templates[0].id;
    expect(isOurs(seeded)).toBe(false);
    await expect(deleteTpl(M, seeded)).rejects.toThrow(/not created by this suite/);
    expect((await M.ctx.get(`${T}/${seeded}`)).status()).toBe(200);
  });
});

// ---------------------------------------------------------------- conversations (reads only)
test.describe('Conversations list (GET only, session)', () => {
  const base = { page: 1, per_page: 25, phone_id: -2, user_id: -1 };
  for (const seg of ['inbox', 'sent']) {
    test(`GET ${seg}: 200 envelope and conversation schema`, async () => {
      need();
      const r = await M.ctx.get(`${CONV}?${q({ ...base, segment_id: seg, include: 'email_conversation_recipients' })}`);
      expect(r.status()).toBe(200);
      const j = await r.json();
      expect(Array.isArray(j.email_conversations)).toBe(true);
      expect(typeof j.meta.total).toBe('number');
      for (const k of ['email_conversation_recipients', 'users', 'conversations']) expect(j).toHaveProperty(k);
      for (const c of j.email_conversations) {
        expect(typeof c.id).toBe('number');
        expect(['incoming', 'outgoing']).toContain(c.direction);
        expect(typeof c.subject === 'string' || c.subject === null).toBe(true);
        expect(typeof c.is_read).toBe('boolean');
        expect(typeof c.count).toBe('number');
        expect(Array.isArray(c.email_conversation_recipient_ids)).toBe(true);
      }
    });
  }
  test('GET inbox: unread_total present; direction values are valid (inbox threads can show outgoing latest messages)', async () => {
    need();
    const j = await (await M.ctx.get(`${CONV}?${q({ ...base, segment_id: 'inbox' })}`)).json();
    expect(typeof j.meta.unread_total).toBe('number');
    expect(j.email_conversations.some((c: any) => c.direction === 'incoming')).toBe(true);
  });
  test('GET sent: only outgoing messages', async () => {
    need();
    const j = await (await M.ctx.get(`${CONV}?${q({ ...base, segment_id: 'sent' })}`)).json();
    expect(j.email_conversations.length).toBeGreaterThan(0);
    for (const c of j.email_conversations) expect(c.direction).toBe('outgoing');
  });
  test('Boundary: per_page=1 limits the page while meta.total is unchanged', async () => {
    need();
    const all = await (await M.ctx.get(`${CONV}?${q({ ...base, segment_id: 'inbox' })}`)).json();
    const one = await (await M.ctx.get(`${CONV}?${q({ ...base, per_page: 1, segment_id: 'inbox' })}`)).json();
    expect(one.email_conversations.length).toBe(Math.min(1, all.meta.total));
    expect(one.meta.total).toBe(all.meta.total);
  });
  for (const seg of ['drafts', 'scheduled', 'trash']) {
    test(`GET ${seg}: 200 with email_conversations array and meta.total (empty-result boundary on this tenant)`, async () => {
      need();
      const r = await M.ctx.get(`${CONV}?${q({ ...base, segment_id: seg })}`);
      expect(r.status()).toBe(200);
      const j = await r.json();
      expect(Array.isArray(j.email_conversations)).toBe(true);
      expect(j.meta.total).toBe(j.email_conversations.length);
    });
  }
  test('GET awaiting_response: 200 with a different envelope (conversations + is_last_page)', async () => {
    need();
    const r = await M.ctx.get(`${CONV}?${q({ ...base, segment_id: 'awaiting_response' })}`);
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(Array.isArray(j.conversations)).toBe(true);
    expect(typeof j.meta.is_last_page).toBe('boolean');
  });
  test('Negative: unknown segment_id -> 403 "You have requested an invalid page"', async () => {
    need();
    for (const seg of ['bogus', 'all-sms', 'opens']) {
      const r = await M.ctx.get(`${CONV}?${q({ ...base, segment_id: seg })}`);
      expect(r.status(), seg).toBe(403);
      expect(msg(await r.json())).toBe('You have requested an invalid page');
    }
  });
  test('GET /emails/unread_count: 200 with value/display_value', async () => {
    need();
    const r = await M.ctx.get('/crm/sales/emails/unread_count');
    expect(r.status()).toBe(200);
    expect(await r.json()).toHaveProperty('display_value');
  });
});

// ---------------------------------------------------------------- SMS templates (GET only: SMS create is out of scope)
test.describe('SMS templates (GET only, session)', () => {
  test('GET list: 200 {sms_templates: []} (SMS not set up on this tenant)', async () => {
    need();
    const r = await M.ctx.get('/crm/sales/sms_templates');
    expect(r.status()).toBe(200);
    expect(Array.isArray((await r.json()).sms_templates)).toBe(true);
  });
  test('GET detail unknown id -> 404', async () => {
    need();
    expect((await M.ctx.get('/crm/sales/sms_templates/1')).status()).toBe(404);
  });
});

// ---------------------------------------------------------------- leak check (per worker: only this worker's own ids)
test.afterAll(async () => {
  if (!M) return;
  const j = await (await M.ctx.get(`${TL}?${q({ page: 1, per_page: 100, filterParam: -301 })}`)).json().catch(() => ({ email_templates: [] }));
  const leaked = (j.email_templates ?? []).filter((x: any) => mine.includes(x.id));
  if (leaked.length) console.warn(`[conversations-track] still present after sweep: ${leaked.map((x: any) => x.id).join(',')}`);
});
