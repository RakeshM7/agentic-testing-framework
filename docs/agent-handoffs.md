# Agent hand-off formats

Every file one agent writes for another. Paths are under `artifacts/<product>/` unless they start with `playwright-tests/` or `k6-tests/`. `<m>` = module slug, `<run>` = run id. Agents read only the sections they need.

## 1. Module exploration (`module-explorer` → everyone)

`modules/<m>/explore/`

| File | Content |
|---|---|
| `sitemap.json` | `[{url, slug, title, links[]}]` — every page visited (schema `sitemap`). `slug` is kebab-case and unique within the module. |
| `pages/<slug>/dom-snapshot.md` | The accessibility snapshot of the page as captured, plus a one-line purpose. Visible text is copied **verbatim** (later selectors depend on it). |
| `pages/<slug>/screenshot.png` | When the browser tool can save to this path; otherwise omitted and noted in `module-summary.md`. |
| `pages/<slug>/console.txt` | Console errors/warnings seen on the page (may be empty). |
| `interactions.json` | `[{page, element, role, name, kind: button|link|input|select|checkbox|radio|textarea|other, required?, options?[], validation?[], mutates: bool, tried: bool, observed?}]` |
| `network-inventory.json` | `[{method, pathTemplate, host?, statusCodes[], requestKeys[], responseKeys[], pages[], graphql?: [{operationType, operationName?, fields[]}]}]` — endpoint **shapes only**: JSON key names, never values, tokens, cookies or personal data. Ids in paths become `{id}`. `host` when the request went to a host other than the target's. `graphql` for GraphQL requests: the operation type and the **root field names** of each operation (`query { contacts {…} }` → `fields: ["contacts"]`). |
| `flows/<flow-slug>.md` | One user task per file: `# <Task>`, `Preconditions:`, then numbered steps a person who has never seen the product can follow (exact labels in quotes, where to click, what to type), then `Expected result:`. |
| `module-summary.md` | `## Pages`, `## Key entities`, `## Key actions`, `## Roles observed`, `## Mutations performed` (with ledger refs), `## Not explored` (and why), `## Questions raised` (CSV ids). |
| `new-questions.json` | Scratch input for `clarifications.mjs append`: `[{question, steps}]`. |

Unconfirmed behavior goes to `clarifications.csv` via `node scripts/clarifications.mjs append <product> <m> modules/<m>/explore/new-questions.json` — never by editing the CSV.

## 2. Clarification evidence (`clarification-explorer` → the CSV, the summary script and humans)

`modules/<m>/clarification-evidence/<ID>/observation.md`:

```
# <ID>: <question>
Verdict: confirmed | unconfirmed | blocked
Mode: readonly | full-run
## Steps executed
1. ... (as actually performed; note any deviation from the CSV steps)
## Observed behavior
<what the product did, quoting messages verbatim>
## Why not confirmed            (unconfirmed/blocked only)
<e.g. needs full-run; CAPTCHA; element missing; behavior inconsistent across attempts>
## Entities created              (ledger refs, or "none")
```
Screenshots, if any, sit next to it as `step-<n>.png`. `confirmed` requires the behavior to be observed directly, not inferred.

## 3. Test cases (`testcase-writer` → reviewers, automation)

`modules/<m>/testcases/<m>-testcases.<ext>` (format from `testcases.output_format`) and `testcases-summary.md`.

- Every case has an id `TC-<m>-<n>` (sequential, never reused within the module).
- Gherkin: one `Feature:` per file; each `Scenario:` tagged `@TC-<m>-<n>`, a priority tag `@p1|@p2|@p3`, a type tag `@functional|@negative|@boundary|@security|@visual|@api`, `@mutates` when it creates/changes/deletes data, and `@<clarification-id>` for every clarification row it relies on (e.g. `@contacts-4`). Cases that rely on an **unconfirmed** row also carry `@assumption`.
- CSV / TestRail: columns `ID, Title, Priority, Type, Preconditions, Steps, Expected, Clarifications, Mutates, Assumption`.
- Markdown table: the same columns as a table.
- `testcases-summary.md`: `Total test cases: N` (exact line, checked by the stage), counts by type/priority, the list of clarification ids used, and the assumption-based cases.

## 4. API discovery and plan (`api-discoverer`, `api-test-planner` → API and k6 writers)

`modules/<m>/api/` is written by `node scripts/endpoints.mjs build` and nothing else, except `overlay.json` (D-045).

**`discovered-endpoints.json`** (schema `discovered-endpoints`). One entry per operation:
```
{id: "EP-<m>-<n>", key, kind: rest|graphql, method, path, server, basePath, operationId?, summary?, tags?,
 graphql?: {operationType: query|mutation, field, args[], returnType, getSupported},
 resource, crud: create|list|read|update|delete|action|query|mutation, observed: {ui, probe},
 source: openapi|graphql|network|docs, sources: [{source: openapi|graphql|network|docs|probe, ref}],
 auth: none|session|bearer|basic|api-key|oauth2|unknown, security?: {alternatives: [[{scheme, type, in?, name?, scopes[]}]]},
 params: [{in: path|query|header|cookie, name, required, type?, format?, enum?, source}],
 contentTypes: {request[], response[]}, requestSchema?, responseSchema?, errorSchemas?: {<status>: schema},
 requestKeys[], responseKeys[], statusCodes[], statuses: {documented[], observed[]},
 pagination: {style: page|offset|cursor|link|unknown, params[]} | null, rateLimit: {...} | null,
 links: [{from: "EP-...", pointer, param, source: inferred|overlay}], mutates, safeMethod, queryLike?, deprecated?, notes?}
```

What the fields mean:
- **Ids.** `id` is stable. It is assigned once per `key` in `registry.json` and is never renumbered or reused.
  - The `key` is the method plus the path with parameter names erased, for example `GET /api/v1/contacts/{}`.
  - It is host-prefixed when the host is not the target's.
  - A GraphQL key looks like `GQL query contacts`.
- **Paths.** `path` is the full path from `server` (it includes `basePath`) and uses the spec's parameter names.
- **Scope.** The catalogue holds every documented operation on the module's resources, plus everything the UI called.
  - `observed` says whether the UI called the operation, and whether a GET probe reached it.
  - Unobserved operations are documented-only.
- **Schemas** come only from a spec. Traffic gives key names (`requestKeys`, `responseKeys`), never types.
- **Links** go from producer to consumer: this endpoint's `param` is fed by `pointer` in the response of `from`. Use them for setup and cleanup chains.
- **Mutation flags.**
  - `mutates` is always true for a non-GET REST operation and for a GraphQL mutation.
  - `safeMethod` means readonly runs may send it. For GraphQL that is a query on a server that accepts GET.
  - `queryLike` is an advisory hint that a POST only reads.

**`coverage.json`** (schema `api-coverage`) accounts for every input:
- `status` is one of:
  - `complete`;
  - `partial`;
  - `empty`: nothing found;
  - `blocked`: discovery could not see the API, with `blockedReason`.
- The inputs are spec operations, GraphQL root fields, inventory entries and docs endpoints. Each one is either in `mapped`, as `{input, id}`, or in `excluded`, as `{input, reason, detail?}`. The possible reasons are:
  - `third_party`, `static_asset`, `preflight`, `telemetry`, `health`;
  - `auth_plumbing`, `page_navigation`, `out_of_module`;
  - `duplicate`, `deprecated`, `not_api`.
- `candidateResources` lists resources the UI called that are outside the module's scope.
- `retired` lists ids that are gone.

**`drift.json`** lists documented-vs-observed contract findings for the planner. Each is `[{id, type, endpoint, detail?, evidence?}]`, and `type` is one of:
- `undocumented_endpoint`, `unobserved_documented_endpoint`;
- `undocumented_status`;
- `undocumented_response_key`, `missing_required_key`, `undocumented_request_key`;
- `auth_mismatch`, `server_mismatch`.

**`overlay.json`** (schema `api-overlay`) is the api-discoverer's judgments, applied by `build`:
- scope resources, tags, includes and excludes (each exclude with a reason);
- path literals;
- docs-only `endpoints[]`, each with a `citation`;
- `annotations` per EP id or key, each with a `citation`;
- `links.add` / `links.remove`;
- `defaults.auth`;
- `blocked`.

`registry.json` and `sources/`, which holds fetched specs, introspection results, `index.json` and `probes.json`, are script state. Probes record status codes, content types, key names and rate-limit numbers, never values.

`modules/<m>/api/plan.json` (api-test-planner): `[{id: "API-<m>-<n>", endpoint: "EP-...", type: functional|negative|boundary|auth|schema|contract, title, request, expect: {status, schema?, rules?[]}, mutates: bool, testcases: ["TC-..."], priority}]` and `api-test-plan.md` explaining coverage and gaps.

## 5. Load workload (`k6-workload-designer` → k6 writers)

`modules/<m>/k6/workload.json`: `[{id: "K6-<m>-<n>", name, endpoints: ["EP-..."], executor, profile: {vus?, duration?, stages?[], rate?}, thresholds: {"http_req_duration": ["p(95)<..."], "http_req_failed": ["rate<..."], ...}, mutates: bool, rationale}]`

## 6. Review findings (every reviewer → its domain orchestrator → fixer)

`results/<run>/<m>/<domain>/review-findings.md` (`<domain>` = `testcases`, `playwright-ui`, `playwright-api`, `k6`):

```
# Review -- <domain> / <m> -- round <n>
Verdict: pass | changes-required
| # | Severity | File | Line | Rule | Problem | Required fix |
|---|---|---|---|---|---|---|
```
Severity `blocker | major | minor`. `Verdict: pass` exactly when there is no blocker or major finding. Reviewers never edit what they review.

**Gate findings.** At the start of each review round `orchestration.mjs next` runs the gate (`node scripts/gate.mjs <product> <m> <domain>`), which writes `results/<run>/<m>/<domain>/gate-findings.md` in the same format (heading `# Gate -- <domain> / <m>`; the Rule column holds the gate rule id) with the mechanical checks: ids and tags, traceability, `@mutates`, ledger calls, fixed waits, hard-coded URLs, the safety calls, and compile/`--list`/`k6 inspect`. On `changes-required` (exit 1) that file goes to the writer or fixer instead of starting the reviewer; on `pass` the reviewer judges only what a script can't.

## 7. Triage (every runner-triager → its domain orchestrator → fixer)

`results/<run>/<m>/<framework>/triage.md`:

```
# Triage -- <framework> / <m> -- heal round <n>
Run: <command>   Totals: <passed>/<total> passed, <failed> failed, <flaky> flaky, <skipped> skipped
| Test | File | Classification | Healable | Evidence | Suggested action |
|---|---|---|---|---|---|
```
Classification: `test-bug` (wrong selector/assertion/wait/data in the test) · `flaky` (passes on retry, timing) · `data` (test data conflict) · `product-bug` (the product contradicts a confirmed clarification or test case) · `environment` (network, auth expiry, target down) · `blocked-by-mode` (skipped because the run is readonly). `Healable: yes` only for `test-bug`, `flaky`, `data`. Product bugs are reported, never "fixed" by changing the expectation.

## 8. Results (`runner-triagers` → report)

`results/<run>/<m>/<framework>/results.json` — written only by `node scripts/results.mjs` (schema `results`). Never write it by hand.
