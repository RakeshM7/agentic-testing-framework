# Contacts API test plan (track: contacts, mode: full-run)

Spec: api-tests/playwright-api/tests/freshsales/contacts/contacts.spec.ts (77 tests). Helper: api-tests/playwright-api/helpers/freshsales/contacts-track.ts.
Entities: TCContacts / zz-tccontacts-*@example.com only; logged in ./created-entities.json at creation, deleted in-run; delete helper refuses unlogged ids.

| Category | Scenarios (live-verified behaviour) |
|---|---|
| Functional | saved views list; All Contacts / segment_id list; sort first_name asc, created_at desc; Recycle Bin view; create (defaults Lead/New); create all fields; clone-equivalent; update/clear/partial; status change; delete -> 404; restore; bulk_destroy; note add/remove; lookup + search; timeline/activities |
| Negative | no identifier, empty obj/body, wrong content-type, invalid emails x4, duplicate (case-insensitive, clone, edit), invalid status/lifecycle ids, unknown id 404, non-numeric id, double delete 404, empty note |
| Boundary | per_page 3/0/1000, page 99999, first_name 100 ok / 300 rejected, 300-char email, 1-char name, unicode, junk mobile (annotated), empty search |
| Auth | unauthenticated 401 JSON vs 302 HTML (3 paths), bogus cookie, POST w/o session, missing/bogus CSRF -> 422 on create/update/delete, bare list -> 403, unknown view -> 403 |
| Schema | contact envelope, list meta, filter, fields metadata, note, bulk response |
| Performance | k6 contacts-contacts-load-test.js: 5 GETs/iter, ramp 0->5 VUs 20s, hold 40s, down 10s; p95<1500ms, failed<1%. Not run live (hook blocked). |

## Deviations from contacts-clarifications.md (asserted as observed, annotated `deviation`)
- B5: Mobile-only and External-ID-only create -> 400 "Need to fill this Email" (clarification says Mobile-only saves).
- B1: Lost stage / Lost reason not reachable: tenant exposes only the Lead lifecycle stage via API; invalid stage id -> 400.
- TC-039: junk mobile "abc-!!" accepted (200) -- no mobile format validation.
- Duplicate message is "<email> already exists." (answers open question 1).
