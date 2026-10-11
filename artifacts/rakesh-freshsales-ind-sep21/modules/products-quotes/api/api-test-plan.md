# Products & Quotes (CPQ) API test plan (mode: readonly)

Host `https://rakesh-freshsales-ind-sep21.myfreshworks.com`; auth = session cookie via shared `freshsalesSessionCookie` fixture (handoff storageState). A session was available this run, so authenticated tests run live. GET only; no live load run. 10 endpoints discovered (see discovered-endpoints.json). Mutating endpoints (create/clone/delete product, quote, template) are out of scope in readonly mode; `created-entities.json` = [].

Spec: `api-tests/playwright-api/tests/freshsales/products-quotes/cpq.spec.ts`. k6: `api-tests/k6/scripts/products-quotes-cpq-load-test.js` (inspect only).

| Endpoint | Functional | Negative | Boundary | Auth | Schema |
|---|---|---|---|---|---|
| GET cpq/products | list 200, meta.total | sort=bogus and page=abc tolerated; per_page=-1 -> 400 | per_page=1; page=9999 empty; per_page=0 -> 500 (finding) | anon 401 | product fields/types |
| GET cpq/products/:id | id from list matches | 999999999 and abc -> 404 | - | anon 401 | `{product}` |
| GET cpq/cpq_documents | list 200 | - | per_page=1; page=9999 empty; per_page=0 -> 500 (finding) | anon 401 | document fields |
| GET cpq/cpq_documents/:id | id from list | unknown numeric -> 403 (differs from product 404); abc -> 404 | - | anon 401 | `{cpq_document}` |
| GET cpq/filters/products(/:id) | default "All Products" | unknown id -> 500 (finding) | - | anon 401 | filter shape |
| GET cpq/filters/cpq_documents | "All Documents" | - | - | anon 401 | filter shape |
| GET settings forms (3 routes) | 200 with forms[] | - | - | anon 401 | forms[].fields |

Auth contract: anonymous JSON requests return 401 `{login:'failed'}`; HTML Accept tolerated as 302/401.

Performance candidates: cpq/products and cpq/cpq_documents lists; profile ramp to 5 VUs over 20s, hold 40s, ramp down 10s; p95<1500ms, failure rate<1%. Not run live (readonly).

Findings: per_page=0 yields 500 on both lists; filters/products/<unknown> yields 500; cpq_documents unknown id gives 403 vs 404 for products.
