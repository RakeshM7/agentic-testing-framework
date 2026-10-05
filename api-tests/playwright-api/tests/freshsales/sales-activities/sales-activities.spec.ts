import { test, expect, skipIfNoSession, skipUnlessMutationReady } from '../../../fixtures/freshsales-api-fixtures';
import { APIRequestContext } from '@playwright/test';
import { recordCreated, markDeleted, isOurs, readLog, hasStateFile, newMutCtx, tomorrowIso, Mut } from '../../../helpers/freshsales/sales-activities-track';

// Sales-activities track. Endpoint contracts live-verified 2026-10-05 against the trial tenant.
// Mutations require a CSRF token (Rails meta tag) in addition to the session cookie; every entity is
// ZZ-prefixed, logged in modules/sales-activities/api/created-entities.json and deleted in the same run.
// No SMS sends, no emails, no AgentTest/pre-existing records are touched.
const B = '/crm/sales';
const OWNER_HINT = 'ZZ-ApiSA';
const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// ---------------------------------------------------------------- unauthenticated boundary (no session needed)
for (const p of ['tasks', 'appointments', 'sales_activities', 'settings/sales_activity_types', 'activities_dashboard/summary']) {
  test.describe(`GET ${B}/${p} (unauthenticated boundary)`, () => {
    test('Auth: no session + Accept json -> 401 {login:"failed"}', async ({ request }) => {
      const r = await request.get(`${B}/${p}`, { headers: { Accept: 'application/json' }, maxRedirects: 0 });
      expect(r.status()).toBe(401);
      expect((await r.json()).login).toBe('failed');
    });
    test('Auth: no session + Accept html -> 302 redirect (content-negotiated)', async ({ request }) => {
      const r = await request.get(`${B}/${p}`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
      expect(r.status()).toBe(302);
    });
    test('Auth: bogus session cookie is rejected like no session', async ({ request }) => {
      const r = await request.get(`${B}/${p}`, { headers: { Accept: 'application/json', Cookie: '_freshsales_session=invalid' }, maxRedirects: 0 });
      expect([401, 302]).toContain(r.status());
    });
  });
}

// ---------------------------------------------------------------- authenticated reads
test.describe('GET /crm/sales/tasks', () => {
  test('Functional/Schema: open tasks list {tasks:[...], meta:{total}}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/tasks?filter=open&per_page=5`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.tasks)).toBe(true);
    expect(typeof b.meta.total).toBe('number');
    for (const t of b.tasks) {
      expect(typeof t.id).toBe('number');
      expect(typeof t.title).toBe('string');
      expect([0, 1]).toContain(t.status);
      expect(typeof t.due_date).toBe('string');
      expect(Array.isArray(t.targetables)).toBe(true);
    }
  });
  test('Boundary: per_page=5 never returns more than 5 rows', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const b = await (await request.get(`${B}/tasks?filter=open&per_page=5&page=1`, { headers: { Cookie: freshsalesSessionCookie! } })).json();
    expect(b.tasks.length).toBeLessThanOrEqual(5);
  });
  test('Boundary: huge page number -> 200 with empty list', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/tasks?filter=open&per_page=5&page=99999`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    expect((await r.json()).tasks).toEqual([]);
  });
  test('Boundary: per_page=0&page=0 should be a 4xx/200, not a server error (KNOWN DEFECT: returns 500)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    test.fail(true, 'Known defect observed 2026-10-05: GET /tasks?page=0&per_page=0 -> 500 {"error_code":500}; passes (expected-fail) while the defect exists.');
    const r = await request.get(`${B}/tasks?page=0&per_page=0`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBeLessThan(500);
  });
  test('Negative: unknown task id -> 404 errors body', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/tasks/999999`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
    const b = await r.json();
    expect(b.errors.code).toBe(404);
    expect(b.errors.message[0]).toMatch(/task you're looking for/);
  });
  test('Negative: non-numeric task id -> 4xx', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/tasks/abc`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe('GET /crm/sales/appointments and /sales_activities', () => {
  test('Functional/Schema: appointments list', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/appointments?per_page=5`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.appointments)).toBe(true);
    expect(typeof b.meta.total).toBe('number');
  });
  test('Negative: unknown appointment id -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/appointments/999999`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
    expect((await r.json()).errors.message[0]).toMatch(/meeting you're looking for/);
  });
  test('Functional/Schema: custom sales_activities list {sales_activities, meta:{total,total_pages}}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/sales_activities?per_page=5&page=1`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.sales_activities)).toBe(true);
    expect(typeof b.meta.total).toBe('number');
    expect(typeof b.meta.total_pages).toBe('number');
  });
  test('Negative: sales_activities/fields is not a route -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/sales_activities/fields`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
  });
});

test.describe('GET /crm/sales/settings/sales_activity_types', () => {
  test('Functional/Schema: default types present with required fields', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/settings/sales_activity_types`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const list = (await r.json()).sales_activity_types;
    expect(list.length).toBeGreaterThan(0);
    for (const t of list) {
      expect(typeof t.id).toBe('number');
      expect(typeof t.name).toBe('string');
      expect(typeof t.internal_name).toBe('string');
      expect(typeof t.is_default).toBe('boolean');
      expect(typeof t.position).toBe('number');
    }
    const defaults = list.filter((t: any) => t.is_default).map((t: any) => t.internal_name);
    expect(defaults).toEqual(expect.arrayContaining(['task', 'appointment']));
  });
  test('Functional: show by id matches list entry', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = { Cookie: freshsalesSessionCookie! };
    const first = (await (await request.get(`${B}/settings/sales_activity_types`, { headers: h })).json()).sales_activity_types[0];
    const r = await request.get(`${B}/settings/sales_activity_types/${first.id}`, { headers: h });
    expect(r.status()).toBe(200);
    const one = (await r.json()).sales_activity_type;
    expect(one.id).toBe(first.id);
    expect(one.name).toBe(first.name);
  });
  test('Negative: unknown type id -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/settings/sales_activity_types/999999`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
    expect((await r.json()).errors.message[0]).toMatch(/sales_activity_type/);
  });
  test('Schema: selector endpoint returns partial types', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/selector/sales_activity_types`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const list = (await r.json()).sales_activity_types;
    expect(list.length).toBeGreaterThan(0);
    for (const t of list) { expect(t.partial).toBe(true); expect(typeof t.id).toBe('number'); expect(typeof t.name).toBe('string'); }
  });
  test('Negative: non-settings path /sales_activity_types is not a route -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    expect((await request.get(`${B}/sales_activity_types`, { headers: { Cookie: freshsalesSessionCookie! } })).status()).toBe(404);
  });
});

test.describe('Activities dashboard + goals', () => {
  test('Schema: GET activities_dashboard/summary -> {summary:[]}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard/summary`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    expect(Array.isArray((await r.json()).summary)).toBe(true);
  });
  test('Schema: GET activities_dashboard/available_user_widgets', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard/available_user_widgets`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const w = (await r.json()).user_widgets;
    expect(w.map((x: any) => x.name)).toEqual(expect.arrayContaining(['calendar_appointment', 'todays_summary', 'quick_links']));
    for (const x of w) { expect(typeof x.position).toBe('number'); expect(typeof x.is_selected).toBe('boolean'); }
  });
  test('Auth/permission: bare GET /activity_goals is 403 not-authorized JSON (goals are only reachable via the view route)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activity_goals`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(403);
    expect((await r.json()).errors.code).toBe(403);
  });
});

// ---------------------------------------------------------------- mutations (full-run only)
async function jsonOf(r: any) { try { return await r.json(); } catch { return null; } }

test.describe('Sales activity lifecycle (mutating, serial, ZZ-prefixed)', () => {
  test.describe.configure({ mode: 'serial' });
  let M: Mut; let contactId = 0; let taskId = 0; let apptId = 0; let callId = 0;

  async function del(ctx: APIRequestContext, resource: string, url: string, id: number) {
    if (!isOurs(resource, id)) throw new Error(`refusing to DELETE ${resource} ${id}: not created by this run`);
    const r = await ctx.delete(url, { headers: M.hdr });
    if (r.status() === 200) markDeleted(resource, id);
    return r;
  }

  test.beforeAll(async ({ playwright }) => {
    if (!hasStateFile() || !require('../../../fixtures/mutationGuard').MUTATIONS_ALLOWED) return;
    M = await newMutCtx(playwright);
    if (!M.csrf) return;
    const r = await M.ctx.post(`${B}/contacts`, {
      headers: M.hdr,
      data: { contact: { first_name: 'ZZ', last_name: `${OWNER_HINT} ${sfx()}`, emails: [{ value: `zz.apisa.${sfx()}@example.com`, is_primary: true }] } },
    });
    if (r.status() === 200 || r.status() === 201) {
      contactId = (await r.json()).contact.id;
      recordCreated('contact', 'POST /crm/sales/contacts', contactId);
    }
  });

  test.afterAll(async () => {
    if (!M) return;
    // Safety net: remove anything still alive that this run logged.
    for (const e of readLog().filter((x) => !x.deleted)) {
      const url = { task: 'tasks', appointment: 'appointments', phone_call: 'phone_calls', contact: 'contacts' }[e.resource as string];
      if (url) await del(M.ctx, e.resource, `${B}/${url}/${e.id}`, e.id).catch(() => {});
    }
    await M.ctx.dispose();
  });

  function ready(hasSession: boolean) {
    skipUnlessMutationReady(hasSession);
    test.skip(!hasStateFile(), 'Blocked: CSRF token requires a storageState hand-off file (FRESHSALES_SESSION_STATE_FILE / playwright-tests/freshsales/.auth/freshsales-handoff.json); a bare cookie string is not enough for mutations.');
    test.skip(!M || !M.csrf || !contactId, 'Blocked: setup could not obtain CSRF token or create the ZZ parent contact.');
  }

  test('Auth/CSRF: POST /tasks without X-CSRF-Token -> 422 {error_code:422}', async ({ freshsalesSessionCookie }) => {
    ready(!!freshsalesSessionCookie);
    const r = await M.ctx.post(`${B}/tasks`, { headers: { 'Content-Type': 'application/json' }, data: { task: { title: 'ZZ no csrf', due_date: tomorrowIso() } } });
    expect(r.status()).toBe(422);
    expect((await r.json()).error_code).toBe(422);
  });

  test('Functional: create task linked to ZZ contact -> 201 with targetables', async ({ freshsalesSessionCookie }) => {
    ready(!!freshsalesSessionCookie);
    const r = await M.ctx.post(`${B}/tasks`, { headers: M.hdr, data: { task: { title: `ZZ SA Task ${sfx()}`, due_date: tomorrowIso(), targetable_type: 'Contact', targetable_id: contactId } } });
    expect(r.status()).toBe(201);
    const t = (await r.json()).task;
    taskId = t.id; recordCreated('task', 'POST /crm/sales/tasks', taskId);
    expect(t.status).toBe(0);
    expect(t.completed_date).toBeNull();
    expect(t.targetables).toEqual([{ id: contactId, type: 'Contact' }]);
    expect(t.title).toMatch(/^ZZ SA Task/);
  });

  test('Functional: GET task by id returns it with the related contact side-load', async ({ request, freshsalesSessionCookie }) => {
    ready(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/tasks/${taskId}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.task.id).toBe(taskId);
    expect(b.contacts.map((c: any) => c.id)).toContain(contactId);
  });

  test('Functional: update title (PUT) then mark complete (status 1 sets completed_date)', async () => {
    skipUnlessMutationReady(true); if (!taskId) test.skip(true, 'no task');
    const u = await M.ctx.put(`${B}/tasks/${taskId}`, { headers: M.hdr, data: { task: { title: 'ZZ SA Task renamed' } } });
    expect(u.status()).toBe(200);
    expect((await u.json()).task.title).toBe('ZZ SA Task renamed');
    const c = await M.ctx.put(`${B}/tasks/${taskId}`, { headers: M.hdr, data: { task: { status: 1 } } });
    expect(c.status()).toBe(200);
    const t = (await c.json()).task;
    expect(t.status).toBe(1);
    expect(typeof t.completed_date).toBe('string');
  });

  test('Negative: blank title -> 400 "Title can\'t be blank"', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/tasks`, { headers: M.hdr, data: { task: { title: '', due_date: tomorrowIso() } } });
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message).toContain("Title can't be blank");
  });
  test('Negative: missing due_date -> 400 "Due date can\'t be blank"', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/tasks`, { headers: M.hdr, data: { task: { title: 'ZZ missing due' } } });
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message).toContain("Due date can't be blank");
  });
  test('Negative: payload without the "task" wrapper -> 400', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/tasks`, { headers: M.hdr, data: { title: 'ZZ flat' } });
    expect(r.status()).toBe(400);
  });
  test('Negative: malformed JSON body -> 400', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/tasks`, { headers: M.hdr, data: '{bad' });
    expect(r.status()).toBe(400);
    // Playwright re-encodes a string body under a JSON content-type, so the server may report either
    // the JSON-parse message or the resulting blank-field errors; only the 400 contract is asserted.
    expect(JSON.stringify(await jsonOf(r))).toMatch(/JSON payload|can't be blank/);
  });
  test('Negative: PUT unknown task id -> 404', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.put(`${B}/tasks/999999`, { headers: M.hdr, data: { task: { title: 'ZZ nope' } } });
    expect(r.status()).toBe(404);
  });
  test('Boundary: very long task title is accepted or cleanly rejected (never 5xx)', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/tasks`, { headers: M.hdr, data: { task: { title: 'ZZ ' + 'x'.repeat(2000), due_date: tomorrowIso() } } });
    expect(r.status()).toBeLessThan(500);
    if (r.status() === 201) { const id = (await r.json()).task.id; recordCreated('task', 'POST /crm/sales/tasks', id); await del(M.ctx, 'task', `${B}/tasks/${id}`, id); }
  });

  test('Functional: create meeting (appointment) 201, update, list contains it', async ({ request, freshsalesSessionCookie }) => {
    ready(!!freshsalesSessionCookie);
    const r = await M.ctx.post(`${B}/appointments`, { headers: M.hdr, data: { appointment: { title: `ZZ SA Meeting ${sfx()}`, from_date: '2026-12-07T10:00:00Z', end_date: '2026-12-07T10:30:00Z', time_zone: 'Chennai', targetable_type: 'Contact', targetable_id: contactId } } });
    expect(r.status()).toBe(201);
    const a = (await r.json()).appointment;
    apptId = a.id; recordCreated('appointment', 'POST /crm/sales/appointments', apptId);
    expect(a.targetables).toEqual([{ id: contactId, type: 'Contact' }]);
    expect(a.time_zone).toBe('Chennai');
    const u = await M.ctx.put(`${B}/appointments/${apptId}`, { headers: M.hdr, data: { appointment: { title: 'ZZ SA Meeting renamed' } } });
    expect(u.status()).toBe(200);
    expect((await u.json()).appointment.title).toBe('ZZ SA Meeting renamed');
    const g = await request.get(`${B}/appointments/${apptId}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(g.status()).toBe(200);
  });
  test('Negative: appointment with blank fields -> 400 lists title/from/end', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/appointments`, { headers: M.hdr, data: { appointment: { title: '' } } });
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message).toEqual(["Title can't be blank", "From date can't be blank", "End date can't be blank"]);
  });
  test('Negative: appointment with IANA-style tz -> 400 "Not a supported time zone"', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/appointments`, { headers: M.hdr, data: { appointment: { title: 'ZZ tz', from_date: '2026-12-07T10:00:00Z', end_date: '2026-12-07T10:30:00Z', time_zone: 'Asia/Kolkata' } } });
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message).toContain('Not a supported time zone');
  });

  test('Functional: log a phone call on the ZZ contact (201), fetch, schema', async ({ request, freshsalesSessionCookie }) => {
    ready(!!freshsalesSessionCookie);
    const r = await M.ctx.post(`${B}/phone_calls`, { headers: M.hdr, data: { phone_call: { call_direction: true, targetable_type: 'Contact', targetable_id: contactId, note: { description: 'ZZ SA call note' } } } });
    expect(r.status()).toBe(201);
    const b = await r.json();
    callId = b.phone_calls[0].id; recordCreated('phone_call', 'POST /crm/sales/phone_calls', callId);
    expect(Array.isArray(b.notes)).toBe(true);
    expect(b.notes[0].description).toBe('ZZ SA call note');
    const g = await request.get(`${B}/phone_calls/${callId}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(g.status()).toBe(200);
    expect((await g.json()).call.call_direction).toBe(true);
  });
  test('Negative: GET /phone_calls collection route does not exist -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/phone_calls`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
  });

  test('Negative: create custom activity type with blank name (KNOWN DEFECT: 500 instead of 4xx)', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    test.fail(true, 'Known defect observed 2026-10-05: POST settings/sales_activity_types with blank name -> 500 {"error_code":500}.');
    const r = await M.ctx.post(`${B}/settings/sales_activity_types`, { headers: M.hdr, data: { sales_activity_type: { name: '' } } });
    expect(r.status()).toBeLessThan(500);
  });
  test('Negative: custom activity type with invalid internal_name -> 400', async () => {
    skipUnlessMutationReady(true); if (!M?.csrf) test.skip(true, 'no csrf');
    const r = await M.ctx.post(`${B}/settings/sales_activity_types`, { headers: M.hdr, data: { sales_activity_type: { name: 'ZZ SA bad', internal_name: 'zz_bad' } } });
    expect(r.status()).toBe(400);
    expect(JSON.stringify(await r.json())).toMatch(/Invalid internal name/);
  });

  // Deletes (only ids in this track's log)
  test('Functional: DELETE phone call -> 200 true', async () => {
    skipUnlessMutationReady(true); if (!callId) test.skip(true, 'no call');
    const r = await del(M.ctx, 'phone_call', `${B}/phone_calls/${callId}`, callId);
    expect(r.status()).toBe(200);
  });
  test('Functional: DELETE meeting -> 200; repeat -> 404', async () => {
    skipUnlessMutationReady(true); if (!apptId) test.skip(true, 'no appt');
    expect((await del(M.ctx, 'appointment', `${B}/appointments/${apptId}`, apptId)).status()).toBe(200);
    const again = await M.ctx.delete(`${B}/appointments/${apptId}`, { headers: M.hdr });
    expect(again.status()).toBe(404);
  });
  test('Functional: DELETE task -> 200 {success:"200"}; repeat/GET -> 404', async ({ request, freshsalesSessionCookie }) => {
    ready(!!freshsalesSessionCookie);
    const r = await del(M.ctx, 'task', `${B}/tasks/${taskId}`, taskId);
    expect(r.status()).toBe(200);
    expect((await r.json()).success).toBe('200');
    expect((await M.ctx.delete(`${B}/tasks/${taskId}`, { headers: M.hdr })).status()).toBe(404);
    expect((await request.get(`${B}/tasks/${taskId}`, { headers: { Cookie: freshsalesSessionCookie! } })).status()).toBe(404);
  });
  test('Auth/safety: refuses to DELETE a pre-existing id not in this run log', async () => {
    skipUnlessMutationReady(true); if (!M) test.skip(true, 'no ctx');
    await expect(del(M.ctx, 'task', `${B}/tasks/402014161456`, 402014161456)).rejects.toThrow(/not created by this run/);
  });
});
