# API foundation ({{product}})

- `config/api/settings.ts`: base paths, default headers, timeouts, the auth scheme and the identities, rendered from
  `artifacts/{{product}}/foundation/api-overlay.json` and the run-config. `apiPath(path, name?)` joins a base path.
- `fixtures/api/base.ts`: `api` (the run's session), `noAuth`, `malformedAuth(scheme?)` and `identity(name)`, every
  one wrapped by `guarded()`: outside full-run any method but GET, HEAD or OPTIONS throws
  `Mutation blocked: readonly run`. `identity(name)` skips the test when that identity is not configured.
- `fixtures/api/auth.setup.ts`: the session state for the `session` scheme (`STORAGE_STATE` first, else the UI
  login's `.auth/ui.json`), or a check that the scheme's variable is set. CAPTCHA or MFA needs `STORAGE_STATE`.
- `helpers/api/schema.ts`: `validateSchema(schema, body)` with Ajv.
- `fixtures/api/index.ts` (hand-written): one fixture per client, built on `./base`.
- `config/api/schemas/` (hand-written per module) and `helpers/api/` (hand-written): pure functions only.

## Product notes
{{notes}}
## Gap requests
{{requests}}