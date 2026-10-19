# UI foundation ({{product}})

- `config/ui/settings.ts`: timeouts, viewport, the loading indicator, the cookie banner and the login form, each with
  the exploration capture it was observed in. Rendered from `artifacts/{{product}}/foundation/ui-overlay.json`.
- `fixtures/ui/base.ts`: the `mutationGuard` auto-fixture. Outside full-run it aborts every request to the product's
  hosts (`BASE_URL`, `API_BASE_URL`) whose method is not GET, HEAD or OPTIONS. Also `waitForReady(page)`.
- `fixtures/ui/auth.setup.ts`: `STORAGE_STATE` first; a credential login only from a recorded plain login form;
  CAPTCHA or MFA fails with an instruction to provide `STORAGE_STATE`.
- `fixtures/ui/index.ts` (hand-written): one fixture per page object, built on `./base`.
- `helpers/ui/` (hand-written): pure functions, no `page`, no fixtures, no assertions.

## Product notes
{{notes}}
## Gap requests
{{requests}}