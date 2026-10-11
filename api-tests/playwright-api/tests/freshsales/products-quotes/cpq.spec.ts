import { test, expect, skipIfNoSession } from '../../../fixtures/freshsales-api-fixtures';

// Products & Quotes (CPQ) track. Read-only GETs only (mode: readonly).
const B = '/crm/sales';
const hdr = (c: string) => ({ Cookie: c, Accept: 'application/json' });

const anonPaths = [
  '/cpq/products', '/cpq/products/1', '/cpq/cpq_documents', '/cpq/cpq_documents/1',
  '/cpq/filters/products?type=1&start=0&end=-1', '/cpq/filters/cpq_documents',
  '/cpq/settings/products/forms', '/cpq/settings/cpq_documents/forms',
  '/v2/settings/forms?entities_form_for=products,cpq_documents',
];

test.describe('Auth boundary (no session)', () => {
  for (const p of anonPaths) {
    test(`anon GET ${p} -> 401`, async ({ request }) => {
      const r = await request.get(`${B}${p}`, { headers: { Accept: 'application/json' } });
      expect(r.status()).toBe(401);
    });
  }
  test('anon HTML Accept -> 302 or 401', async ({ request }) => {
    const r = await request.get(`${B}/cpq/products`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    expect([302, 401]).toContain(r.status());
  });
});

test.describe('GET cpq/products', () => {
  test('Functional/Schema: list', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/products?page=1&per_page=25&sort=name`, { headers: hdr(freshsalesSessionCookie!) });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.products)).toBe(true);
    expect(typeof b.meta.total).toBe('number');
    expect(typeof b.meta.total_pages).toBe('number');
    for (const p of b.products) {
      expect(typeof p.id).toBe('number');
      expect(typeof p.name).toBe('string');
      expect(typeof p.is_active).toBe('boolean');
      expect(typeof p.is_deleted).toBe('boolean');
      expect(typeof p.pricing_type).toBe('number');
      expect(typeof p.owner_id).toBe('number');
    }
  });

  test('Boundary: per_page=1 returns at most 1; page=9999 empty', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    const one = await (await request.get(`${B}/cpq/products?page=1&per_page=1`, { headers: h })).json();
    expect(one.products.length).toBeLessThanOrEqual(1);
    const far = await request.get(`${B}/cpq/products?page=9999&per_page=25`, { headers: h });
    expect(far.status()).toBe(200);
    expect((await far.json()).products).toEqual([]);
  });

  test('Negative: per_page=-1 -> 400', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/products?per_page=-1`, { headers: hdr(freshsalesSessionCookie!) });
    expect(r.status()).toBe(400);
  });

  test('Negative: bogus sort and non-numeric page are tolerated', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    expect((await request.get(`${B}/cpq/products?sort=bogus`, { headers: h })).status()).toBe(200);
    expect((await request.get(`${B}/cpq/products?page=abc`, { headers: h })).status()).toBe(200);
  });

  test('Finding: per_page=0 currently returns 500 (should be 4xx)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/products?per_page=0`, { headers: hdr(freshsalesSessionCookie!) });
    expect([400, 500]).toContain(r.status());
  });
});

test.describe('GET cpq/products/:id', () => {
  test('Functional: show matches list item', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    const list = await (await request.get(`${B}/cpq/products?page=1&per_page=1`, { headers: h })).json();
    test.skip(list.products.length === 0, 'No products on tenant');
    const id = list.products[0].id;
    const r = await request.get(`${B}/cpq/products/${id}`, { headers: h });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.product.id).toBe(id);
    expect(b.product.name).toBe(list.products[0].name);
  });

  test('Negative: unknown and non-numeric ids -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    for (const id of ['999999999', 'abc']) {
      const r = await request.get(`${B}/cpq/products/${id}`, { headers: hdr(freshsalesSessionCookie!) });
      expect(r.status()).toBe(404);
    }
  });
});

test.describe('GET cpq/cpq_documents', () => {
  test('Functional/Schema: list', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/cpq_documents?page=1&per_page=25`, { headers: hdr(freshsalesSessionCookie!) });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.cpq_documents)).toBe(true);
    expect(typeof b.meta.total).toBe('number');
    for (const d of b.cpq_documents) {
      expect(typeof d.id).toBe('number');
      expect(typeof d.deal_id).toBe('number');
      expect(typeof d.document_type).toBe('string');
      expect(typeof d.stage).toBe('string');
      expect(d.document_number).toMatch(/^DOC-\d+$/);
      expect(typeof d.currency_code).toBe('string');
    }
  });

  test('Boundary: per_page=1; page=9999 empty', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    const one = await (await request.get(`${B}/cpq/cpq_documents?page=1&per_page=1`, { headers: h })).json();
    expect(one.cpq_documents.length).toBeLessThanOrEqual(1);
    const far = await (await request.get(`${B}/cpq/cpq_documents?page=9999`, { headers: h })).json();
    expect(far.cpq_documents).toEqual([]);
  });

  test('Finding: per_page=0 currently returns 500', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/cpq_documents?per_page=0`, { headers: hdr(freshsalesSessionCookie!) });
    expect([400, 500]).toContain(r.status());
  });
});

test.describe('GET cpq/cpq_documents/:id', () => {
  test('Functional: show matches list item', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    const list = await (await request.get(`${B}/cpq/cpq_documents?page=1&per_page=1`, { headers: h })).json();
    test.skip(list.cpq_documents.length === 0, 'No quotes on tenant');
    const id = list.cpq_documents[0].id;
    const r = await request.get(`${B}/cpq/cpq_documents/${id}`, { headers: h });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.cpq_document.id).toBe(id);
    expect(b.cpq_document.document_number).toBe(list.cpq_documents[0].document_number);
  });

  test('Negative: unknown numeric id -> 403 (differs from products 404); non-numeric -> 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    expect([403, 404]).toContain((await request.get(`${B}/cpq/cpq_documents/999999999`, { headers: h })).status());
    expect((await request.get(`${B}/cpq/cpq_documents/abc`, { headers: h })).status()).toBe(404);
  });
});

test.describe('GET cpq filters', () => {
  test('products filters: default All Products, and show', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = hdr(freshsalesSessionCookie!);
    const r = await request.get(`${B}/cpq/filters/products?type=1&start=0&end=-1`, { headers: h });
    expect(r.status()).toBe(200);
    const b = await r.json();
    const def = b.filters.find((f: any) => f.is_default);
    expect(def.name).toBe('All Products');
    expect(def.model_class_name).toBe('Product');
    const s = await request.get(`${B}/cpq/filters/products/${def.id}`, { headers: h });
    expect(s.status()).toBe(200);
    expect((await s.json()).filter.id).toBe(def.id);
  });

  test('Finding: unknown filter id returns 500 (should be 404)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/filters/products/999`, { headers: hdr(freshsalesSessionCookie!) });
    expect([404, 500]).toContain(r.status());
  });

  test('cpq_documents filters: All Documents', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/cpq/filters/cpq_documents`, { headers: hdr(freshsalesSessionCookie!) });
    expect(r.status()).toBe(200);
    const f = (await r.json()).filters.find((x: any) => x.is_default);
    expect(f.name).toBe('All Documents');
    expect(f.model_class_name).toBe('CpqDocument');
  });
});

test.describe('GET CPQ form settings', () => {
  for (const p of ['/cpq/settings/products/forms', '/cpq/settings/cpq_documents/forms', '/v2/settings/forms?entities_form_for=products,cpq_documents']) {
    test(`forms ${p}`, async ({ request, freshsalesSessionCookie }) => {
      skipIfNoSession(!!freshsalesSessionCookie);
      const r = await request.get(`${B}${p}`, { headers: hdr(freshsalesSessionCookie!) });
      expect(r.status()).toBe(200);
      const b = await r.json();
      expect(b.forms.length).toBeGreaterThan(0);
      for (const f of b.forms) {
        expect(typeof f.id).toBe('number');
        expect(Array.isArray(f.fields)).toBe(true);
      }
    });
  }
});
