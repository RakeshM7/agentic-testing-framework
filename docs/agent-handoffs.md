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
| `network-inventory.json` | `[{method, pathTemplate, statusCodes[], requestKeys[], responseKeys[], pages[]}]` — endpoint **shapes only**: JSON key names, never values, tokens, cookies or personal data. Ids in paths become `{id}`. |
| `flows/<flow-slug>.md` | One user task per file: `# <Task>`, `Preconditions:`, then numbered steps a person who has never seen the product can follow (exact labels in quotes, where to click, what to type), then `Expected result:`. |
| `module-summary.md` | `## Pages`, `## Key entities`, `## Key actions`, `## Roles observed`, `## Mutations performed` (with ledger refs), `## Not explored` (and why), `## Questions raised` (CSV ids). |
| `new-questions.json` | Scratch input for `clarifications.mjs append`: `[{question, steps}]`. |

Unconfirmed behavior goes to `clarifications.csv` via `node scripts/clarifications.mjs append <product> <m> modules/<m>/explore/new-questions.json` — never by editing the CSV.

## 2. Clarification evidence (`clarification-explorer` → `clarification-writer`)

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

`modules/<m>/api/discovered-endpoints.json`: `[{id: "EP-<m>-<n>", method, path, source: openapi|network|docs, auth: none|session|bearer|api-key|unknown, requestSchema?, responseSchema?, statusCodes[], mutates: bool, notes?}]`

`modules/<m>/api/plan.json`: `[{id: "API-<m>-<n>", endpoint: "EP-...", type: functional|negative|boundary|auth|schema|contract, title, request, expect: {status, schema?, rules?[]}, mutates: bool, testcases: ["TC-..."], priority}]` and `api-test-plan.md` explaining coverage and gaps.

## 5. Load workload (`k6-workload-designer` → k6 writers)

`modules/<m>/k6/workload.json`: `[{id: "K6-<m>-<n>", name, endpoints: ["EP-..."], executor, profile: {vus?, duration?, stages?[], rate?}, thresholds: {"http_req_duration": ["p(95)<..."], "http_req_failed": ["rate<..."], ...}, mutates: bool, rationale}]`

## 6. Review findings (every reviewer → its domain orchestrator → feedback implementor)

`results/<run>/<m>/<domain>/review-findings.md` (`<domain>` = `testcases`, `playwright-ui`, `playwright-api`, `k6`):

```
# Review -- <domain> / <m> -- round <n>
Verdict: pass | changes-required
| # | Severity | File | Line | Rule | Problem | Required fix |
|---|---|---|---|---|---|---|
```
Severity `blocker | major | minor`. `Verdict: pass` exactly when there is no blocker or major finding. Reviewers never edit what they review.

## 7. Triage (every runner-triager → its domain orchestrator → healer)

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
