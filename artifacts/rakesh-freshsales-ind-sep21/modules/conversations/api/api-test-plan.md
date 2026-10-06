# Conversations API test plan (track `conversations`, mode full-run)

Spec: `api-tests/playwright-api/tests/freshsales/conversations/email-templates.spec.ts`; helper `helpers/freshsales/conversations-track.ts`; load script `api-tests/k6/scripts/conversations-email-templates-load-test.js`.
Safety: only email templates named `ZZ API ...` are created (logged in `created-entities.json` on creation, deleted in the same run, DELETE refuses unlogged ids). Never send/reply/forward/schedule email, no mailbox connect, no SMS create/send. Seeded Public templates are read only.

| Endpoint | Functional | Negative | Boundary | Auth | Schema |
|---|---|---|---|---|---|
| GET email_templates/user | Public -302 list; own -301 list contains created | unknown filterParam | per_page 1/1000, page 0, page 9999, no overlap | no session 401/302/bogus cookie | envelope, meta.total, template fields |
| GET email_templates/:id | seeded + created detail | 999/abc/0 -> 404 | - | no session | plural key, stats fields |
| POST email_templates | create, flat body, tags+share, clone, duplicate name | no/empty name 400; no html 500 (defect); empty body; text/plain; no CSRF 422 | 300-char name (truncated on read) | no session/CSRF | singular key, text_content derived |
| PUT email_templates/:id | full update persists | name-only 500 (defect); empty name 400; unknown id 404; no CSRF 422 | - | - | - |
| DELETE email_templates/:id | delete own, GET/DELETE after -> 404 | no CSRF 422; helper refuses seeded id | - | - | - |
| GET conversations | inbox, sent, drafts, scheduled, trash, awaiting_response | bogus/all-sms/opens segment -> 403 | per_page=1, empty segments | no session | email_conversations schema, meta |
| GET emails/unread_count, sms_templates[/:id] | 200 | 404 unknown | - | no session (sms_templates) | envelopes |

Not covered by design: email send/reply/forward/schedule, SMS template create, bulk email, phone/call endpoints (/crm/phone), team inbox.
Performance: read-only GETs (template list, inbox, sent), ramp 0 to 3 VUs 20s, hold 40s, down 10s; p95<1500ms, failures<1%.
