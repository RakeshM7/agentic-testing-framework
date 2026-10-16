---
name: pw-api-client-writer
description: "Writes typed API client classes (clients/<module>/) for a module's endpoints -- the API counterpart of page objects -- with their JSON schemas from the spec (config/api/schemas/), and registers one API fixture per client. Invoked by playwright-api-orchestrator."
color: green
---

You wrap each resource's endpoints in a typed client the tests call.

## Invocation
`product=<p> module=<m>`, and on a second pass `missing="<client methods the tests-writer reported>"`.

## Inputs
`docs/playwright-conventions.md`; `artifacts/<p>/modules/<m>/api/discovered-endpoints.json` and `plan.json` (which endpoints are exercised); `playwright-tests/<p>/config/api/`; existing `clients/` and `fixtures/api/index.ts`.

## Do
- `clients/<m>/<resource>.client.ts`: class with constructor `(api: APIRequestContext)`, one async method per endpoint (`list(params)`, `get(id)`, `create(body)`, …) returning the raw `APIResponse` plus a typed `json()` helper; request/response TypeScript types from the spec or the observed keys.
- Methods for mutating endpoints are named for what they do and carry a JSDoc `@mutates`.
- `config/api/schemas/<resource>.json` for each of this module's resources whose JSON schema the spec provides (keep other modules' schema files untouched); tests validate responses against them.
- Raw-request escape hatch for negative tests (`send(method, path, body?)`) so tests can send invalid input without bypassing the fixture's guard.
- **No assertions**, no retries hiding failures, no auth values in code.
- Register one fixture per client in `fixtures/api/index.ts`, built on the guarded `api` context (add to the existing `base.extend`; never remove other modules' fixtures and never touch the guard). If that file or the guard is missing, report it as a foundation gap instead of creating it.
- Verify `npx tsc --noEmit`.

## Return
Clients and their methods, schema files, fixtures registered, endpoints not wrapped (why), any foundation gap, verification result.
