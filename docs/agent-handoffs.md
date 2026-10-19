# Agent hand-off formats

Every file one agent writes for another. Paths are under `artifacts/<product>/` unless they start with `playwright-tests/` or `k6-tests/`. `<m>` = module slug, `<run>` = run id. Agents read only the sections they need.

## 1. Module exploration (`module-explorer` → everyone)

`modules/<m>/explore/`. The exploration is a state machine recorded by `node scripts/explore.mjs state|frontier|ingest-network|build|check <product> <m>` (`scripts/lib/explore.mjs`, D-052). The script owns every file below except the agent's: `flows/`, `module-summary.md`, `new-questions.json`, `overlay.json` and `captures/`.

**Script-owned** (never hand-edited):

| File | Content |
|---|---|
| `sitemap.json` | `[{id: "PG-<m>-<n>", url, slug, title, template, links[], states[], domSnapshotPath, statesDir}]` (schema `sitemap`): every page recorded. `url` is the first URL seen, without its query; `template` is the path with ids as `{id}`; `links` are the link targets seen on the page, including other modules'. `slug` is kebab-case, unique within the module, and never changes. |
| `pages/<slug>/states/<ST>.md` | The accessibility snapshot of state `ST-<m>-<n>`, copied **verbatim** from the agent's capture (later selectors depend on it). |
| `pages/<slug>/dom-snapshot.md` | The page's first state, verbatim (kept for older readers). |
| `model.json` | Schema `explore-model`: `budgets`, `prefixes` (the module's paths), `pages[]`, `states[{id, fingerprint, page, url, title, snapshot, reach: {from, url, steps[]}, frontier}]`, `transitions[{from, actions[], items[], to}]` and `frontier[{id: "FR-<m>-<n>", state, page, role, name, kind: navigation|control|input, url?, target?, status, reason?, detail?, refs?, by?}]`. `reach` is how to get to the state: open `url`, then the steps. |
| `interactions.json` | Schema `interactions`: one entry per control of every state, `{id, state, page, element, role, name, kind: button|link|input|select|checkbox|radio|textarea|other, required?, options?[], placeholder?, inputType?, maxlength?, pattern?, url?, mutates, tried, status, reason?, observed?}`. The constraints are what the snapshot shows (a label ending in `*`, a select's options, a placeholder), best effort. |
| `network-inventory.json` | Schema `network-inventory`: `[{id: "NI-<m>-<n>", method, pathTemplate, host?, statusCodes[], requestKeys[], queryKeys[], responseKeys[], pages[], states[], graphql?: [{operationType, operationName?, fields[]}]}]`. Endpoint **shapes only**: key names, never values, tokens, cookies, headers or personal data. Ids, emails and tokens in paths become `{id}`; a key that is itself a value becomes `{key}`. `host` when the request went to another host than the target's. `graphql`: the operation type and the **root field names** (`query { contacts {…} }` → `fields: ["contacts"]`); a persisted query without its document is `unknown`. Static assets are dropped. Cite an entry as `observation:explore/network-inventory.json#NI-<m>-<n>`. |
| `coverage.json` | Schema `explore-coverage`: the frontier ledger, the KQ ledger (every active `KQ-<m>-<n>` and `KQ-product-<n>`: observed, asked or dismissed), the untried-input ledger (a question's CSV ids or a reason), `questions[{question, kq[], items[], csv}]`, `liveEntities`, and the `verified` stamp of a passing `check`. |
| `explore-model.md` | Rendered from the two above for humans. |
| `log.jsonl`, `registry/{states,pages,frontier,network}.json` | What `state` and `ingest-network` recorded, per run; the id registries (`scripts/lib/registry.mjs`: ids never renumbered or reused). |

**States and ids.** A state's key is its page template plus the *shape* of its snapshot (the page-template variance rule): the fingerprint lines (roles and names; headings with their level; the selected tab; each table's column headers with any sort state, its distinct row shapes and whether it has rows; each list's distinct item shapes and whether it has items; a filled search or filter box; a select's selected option index; validation-like, alert and status messages) with every record-varying name replaced by a data slot. Two snapshots of a page that differ only in data slots are one state, independent of recording order, and the slot positions that varied are recorded as `dataSlots`. A name is a data slot only when it is record-varying: inside a collection (a list item, a table row, an article or card, a navigation list), a link to a record (its target erases to an id), a level-1 or level-2 heading outside a dialog, a breadcrumb item, or a name that repeats the page title (equal to a part of it, or containing a part of two or more words, such as "Assign to Jane Doe" on "Jane Doe - Acme CRM"). Every other name stays in the shape and tells states apart: buttons and other controls (Activate vs Deactivate, Follow vs Unfollow), alerts and status messages, validation messages, column headers (the chosen columns), filter chips, tabs, h3 and lower headings ("Active contacts" vs "Archived contacts"), mode indicators, and anything inside a dialog. The page title comes from the snapshot's `Page Title:` line, or `--title`. The full `fingerprint` keeps every name and is recorded with each state. Frontier items are keyed by state, role and accessible name; candidates are the control roles plus any element marked `[cursor=pointer]`; the links of a table column and clickable rows count once. Network paths keep exactly `lib/endpoints.mjs`'s id rules plus emails and tokens; page paths also treat a letters-only segment after a people collection (`/users/jdoe`) as data unless it is a common literal.

Known limits of the shape rule: some data still splits states (a record's status shown as a status-role badge, an h3 that names the record without repeating the page title, a record name in a dialog's title, an owner shown as a plain button, an "Assign to <name>" button whose name is not in the page title); and some different screens still merge (h2 section names, a name equal to a part of the page title, record sub-page links such as Edit vs Clone, whose targets both erase to an id).

**Budgets.** `explore.max_states` (150) and `explore.max_pages` (40) per module. Over them a new state or page is not recorded and the item that led there is `deferred: budget`; with the state budget full, every open item is deferred.

**Captures the scripts read** (agent-owned, under `captures/`, saved as the tools returned them):
- **Snapshots:** the browser tool's snapshot output, with or without its page-state header and ```yaml fence: lines `- <role> "<name>" [attr] [ref=eN]: <text>`, children indented two spaces, properties as `- /url: …` and `- /placeholder: …`, YAML-quoted lines accepted. The `Page URL:` header line, or `--url`, gives the URL.
- **Network:** one of
  - the browser tool's network listing, one request per line: `[GET] https://host/path?x=1 => [200] OK` (numbered lines and a missing status are fine);
  - a HAR (`log.entries[]`, with `postData` and `response.content`, base64 included) for request and response key names;
  - a JSON list, or `{requests: [...]}`, of `{method, url, status, requestBody?, responseBody?}`.

  The raw capture can hold values, so `ingest-network` deletes it after reading it (`--keep` to keep it).

**Agent-owned:**

| File | Content |
|---|---|
| `flows/<flow-slug>.md` | One user task per file: `# <Task>`, `Preconditions:`, then numbered steps a person who has never seen the product can follow (exact labels in quotes, where to click, what to type), then `Expected result:`. It names the state ids (`ST-<m>-<n>`) it passes through; `check` fails on none or an unknown one. |
| `module-summary.md` | `## Pages`, `## Key entities`, `## Key actions`, `## Roles observed`, `## Mutations performed` (with ledger refs), `## Not explored` (and why), `## Questions raised` (CSV ids). |
| `new-questions.json` | Input for `clarifications.mjs append`: `[{question, steps, kq?, item?}]`. `kq` and `item` (an id or a list) name the KQ ids and the FR ids of untried inputs it answers; `check` links each question to its CSV id by its text and fails on one that was not appended. |
| `overlay.json` | Schema `explore-overlay`: `items` (`{FR: {reason, detail, citation?}}`, frontier items not explored; the agent's reasons are `destructive-preexisting`, `guard-denied` and `unreachable`, each citing an `observation:explore/captures/<file>` that names the control and is not a snapshot of the state it was found in (its raw capture, or the same shape again), or a different state (`ST-…`) that acting on it reached, and `duplicate-of`, naming an item with the same role and name; every other reason is the script's), `kq` (`{KQ: {status: observed, state?, evidence?: "observation:<path>"}}`, where the state's snapshot or the evidence quotes three or more consecutive words of the open point, or `{status: asked, csv}`, or `{status: dismissed, reason, citation}`, where the citation is a file that quotes three consecutive words of the open point (not its own knowledge file) or an answered `clarification:` row a question linked to the KQ; never a bare state), `inputs` (`{FR: {reason}}`, untried inputs without a question), `scope.prefixes` (extra module paths). |
| `captures/` | The raw snapshots, network captures, screenshots and console output the agent saved. |

Unconfirmed behavior goes to `clarifications.csv` via `node scripts/clarifications.mjs append <product> <m> modules/<m>/explore/new-questions.json` — never by editing the CSV.

## 2. Clarification evidence (`clarification-explorer` → the CSV, the summary script and humans)

`modules/<m>/clarification-evidence/<ID>/observation.md`:

```
# <ID>: <question>
Verdict: confirmed | unconfirmed | blocked
Reason: <reason code>            (unconfirmed/blocked only)
Mode: readonly | full-run
## Key points
1. <an observable fact that settles the question> -- <capture that shows it, or "not observed">
## Steps executed
1. done | deviated | not possible -- <the step as actually performed; for a deviation, what differed>
## Observed behavior
<what the product did, quoting messages verbatim; both runs of the decisive step>
## Scope
<what this does NOT cover>
## Why not confirmed            (unconfirmed/blocked only)
## Entities created              (ledger refs, or "none")
## Follow-up questions           (ids the script added, or "none")
```
Captures sit beside it, pasted from the tool output unedited: `snapshot-<n>.md`, `network-<n>.txt`, `console-<n>.txt`, `step-<n>.png`.

`outcome.json`, recorded with `clarifications.mjs record <p> <m> <ID> --file …` (checks: `docs/artifact-contract.md`):

```json
{
  "verdict": "confirmed",
  "answer": {
    "context": "Signed in as the run's user, on the \"New contact\" form",
    "action": "Clicked \"Save\" with \"Email\" empty (twice)",
    "result": "Not saved; \"Email is required\" appears under \"Email\"; POST /api/contacts returns 422",
    "scope": "Create form only; the edit form and the import were not checked"
  },
  "basis": [
    "network",
    "observed"
  ],
  "quotes": [
    "Email is required"
  ],
  "evidence": [
    "clarification-evidence/contacts-4/observation.md",
    "clarification-evidence/contacts-4/snapshot-3.md",
    "clarification-evidence/contacts-4/network-3.txt"
  ],
  "created": [],
  "followUps": [
    {
      "question": "Is Email required when editing a contact?",
      "steps": "1. Sign in. … 5. Observe whether …"
    }
  ]
}
```
- `verdict`: `confirmed`, `unconfirmed` or `blocked`.
- `answer` (confirmed only): `context`, `action`, `result` (product text in "double quotes", exactly as captured) and `scope`.
- `basis` (confirmed): any of `network`, `observed`, `dom` and `documented:S<n>`.
- `reason`, `summary` and `nextStep` (unconfirmed/blocked only):
  - unconfirmed reasons: `needs-full-run`, `inconsistent`, `evidence-insufficient`, `steps-ambiguous`, `element-not-found`;
  - blocked reasons: `auth`, `no-access`, `environment`, `precondition-missing`, `guard-denied`.
- `evidence`: paths relative to the module, or `knowledge/…` relative to the product. It always includes this row's `observation.md`.
- `created`: `[{type, ref}]`, each in the ledger (full-run only).
- `followUps`: `[{question, steps}]` to module-explorer's standard.

The script writes the Answer as `Basis: … / Context: … / Action: … / Result: … / Scope: …` lines, with `Answer status` set to `agent-proposed`. `confirmed` requires the behavior to be captured or cited, never inferred.

## 3. Test cases (`testcase-writer` → reviewers, a human, automation)

Script-built (D-053): `node scripts/testcases.mjs build|check|review-check|status|paths <product> <module>` (`scripts/lib/testcases.mjs`) owns `modules/<m>/testcases/`, except the writer's `cases.json` and the human's `approval.csv`.

- **Coverage items** (`coverage.json`, schema `testcases-coverage`), each with a stable `CI-<m>-<n>` id keyed by source + technique + target (ISO/IEC/IEEE 29119-4):
  - per input field of `explore/interactions.json`: a valid partition, a missing required value, an invalid partition per known constraint (pattern, not a number, each validation message), min/max and just below/above where a limit is known, every option plus one outside them, checked/unchecked;
  - per transition of `explore/model.json`, per `explore/flows/*.md`;
  - per rule fact of `knowledge/modules/<m>/rule-facts.json`: one item, or a collapsed decision table (all conditions true, then each one flipped alone: N + 1 rows; a rule mixing and/or gets one item per condition);
  - per answered clarification.

  Without G2's model or field constraints (an older exploration) the items are per flow, rule and clarification, and `degraded` says so. Every item is `mapped` (covered by cases), `excluded` (a cited reason; `duplicate-of` only for the same check found twice), `pending`, or `deferred: budget` over `testcases.max_cases` (default 200 per module, lowest priority first).
- **`cases.json`** (the writer's only file, schema `testcases-overlay`): per case a stable `key` (it gets `TC-<m>-<n>` once, never reused), `title` (declarative, unique), `type` `functional|negative|boundary|security|visual|api`, `priority` `p1|p2|p3`, `mutates`/`visual`/`api`, `preconditions`, one `action` (the When), `steps`, one `expected` (the Then; the product's messages quoted verbatim from the evidence; an observable anchor), synthetic `data`, `covers` (1–6 CI ids: one value per field, one invalid value, one decision-table row; a clarification item only with its citation) and `evidence` (`clarification:`, `knowledge:`, `observation:`; real files). Plus `exclude`.
- **The script derives `@assumption`** when a case relies on an unanswered or unapproved clarification (D-048), a rule fact resting on `agent-capture` or `stale` evidence (D-051), an open point, or the writer's own `assumes`.
- **Rendered** `<m>-testcases.<ext>` (format from `testcases.output_format`), never hand-edited:
  - Gherkin: one `Feature:`; per case the tags on the scenario (`@TC-<m>-<n>`, priority, type, `@mutates`, `@visual`, `@api`, `@<clarification-id>` per cited row, `@assumption`), a description (steps, assumptions, covers, evidence), Given/And, one When (with a data table), one Then.
  - CSV / TestRail: columns `ID, Title, Priority, Type, Preconditions, Steps, Expected, Test data, Clarifications, Mutates, Assumption, Tags, Covers, Evidence` (TestRail adds a leading `Section`).
  - Markdown table: the same columns as one table.

  `parseCases` reads all four (every markdown table with an ID column; blank rows skipped) and `countCases` is its length.
- **`testcases-summary.md`:** `Total test cases: N` (exact line, checked by the stage), counts by type, priority and technique, the clarifications used, the assumption-based cases, the exclusions and the deferred items.
- **`check`** fails on a pending item, an overlay problem, a case covering nothing or citing nothing real, or an input changed since the build; a pass stamps `coverage.json` `verified`, which the writer's step and the gate require.
- **Human approval** (human-only; no agent may run it or write the sheet). `build` renders `approval.csv` (`TC ID, Title, Key steps, Expected, Priority, Approved, Comment, Rendered in run, Version`; `Version` is `v<hash>`), keeping a human's entries for unchanged cases. The human fills `Approved` (`yes`, `no`, `changes` or blank) and `Comment` in Excel or an editor (`,` or `;`), then runs `node scripts/testcases.mjs approve <product> <module>` in an interactive terminal, typing the module slug to confirm. `approvals.json` (schema `testcases-approvals`) pins each decision to the case's content hash (content, covers, evidence, the derived `@assumption`), so a later edit makes the case unapproved again. `no` and `changes` become findings for the writer in `approval-findings.md` (§6 format). **Only approved cases are automated.**

## 4. API discovery and plan (`api-discoverer`, `api-test-planner` → `api-code.mjs`, the API and k6 writers)

The catalogue files in `modules/<m>/api/` are written by `node scripts/endpoints.mjs build` and nothing else, except `overlay.json` (D-045). The plan files are written by `node scripts/api-plan.mjs build` and nothing else, except `plan-overlay.json` (D-046).

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

**`plan.json`** (schema `api-plan`), built by `api-plan.mjs build` from the catalogue, `drift.json`, the test cases and `plan-overlay.json`. One entry per scenario:
```
{id: "API-<m>-<n>", key, endpoint: "EP-...", rule,
 type: functional|negative|boundary|auth|authorization|lifecycle|http|graphql|contract|business, title,
 request: {base: valid|changed|none, auth: default|none|malformed:<scheme>|identity:<name>,
           mutation?: {in: body|query|path|header|cookie|graphql, pointer?|name?, op: remove|set|type|length|items|each|duplicate|unknown-id, value?, values?},
           method?, target?: unknown-id, setup?: [{endpoint, pointer, param}], headers?, values?, repeat?, select?, dependency?},
 steps?: [{endpoint, bind?: {param, from, pointer}, request?, expect}],
 expect: {status | statusIn[] | statusClass: 2xx|4xx|non-5xx, source, schema?: response|error:<status>,
          rules: [{assert, pointer?, name?, value?, when?, source}]},
 mutates, requires: [full-run, identity:<name>], cleanup?: {endpoint} | null, leavesData?, documentedOnly?, blocked?,
 testcases: ["TC-..."], priority: p1|p2|p3, priorityReason?, citations?}
```

What the fields mean:
- **Ids.** `key` is `<endpoint key>|<rule>|<target>`, or `overlay|<name>`. `id` is assigned once per key in `plan-registry.json` and is never renumbered or reused.
- **One fault.** A negative or boundary scenario changes the valid request in exactly one place, its `mutation`. A lifecycle scenario is its `steps`, in order.
- **Sources.** Every `expect` and every rule names its `source`:
  - `spec`, `observed`, `rfc9110` or `graphql-over-http`;
  - a citation: `clarification:<id>`, `testcase:<id>` or `knowledge:<path>`;
  - `class-only`, which means no source gives the exact status, so only the class is asserted, never a 5xx.
- **Running.** An empty `requires` runs in readonly. A scenario with `blocked` is written as `test.fixme` with that reason.
- **Code.** `scripts/api-code.mjs` generates one test per scenario, the clients and their types and schemas from these files (§12, D-056).

**`plan-coverage.json`** (schema `api-plan-coverage`) accounts for every coverage item. Each one is in `mapped` (scenario ids), in `excluded` (a reason, a detail and maybe a citation), in `deferred`, or in `pending`.
- **The items:**
  - operations, response schemas, parameter and field constraints;
  - documented statuses, auth schemes, BOLA/BFLA;
  - flows, HTTP checks, pagination and dependencies;
  - drift findings, `@api` test cases, required pattern values and answered questions.
- **The script's exclusion reasons:**
  - `deduped`, `not_applicable`, `unsupported_schema`, `unreachable_status`;
  - `needs_identity`, `auth_unknown`, `public`, `no_link`, `unsafe_probe`, `documentation_finding`.
- **The planner's exclusion reasons:** `not_testable`, `out_of_scope`, `covered_elsewhere`, `needs_data`, `spec_wrong`, `unreachable_status`.
- **Deferred items** (D-050): items whose scenarios were over `api.plan_budget`. They are not planned this run, carry reason `budget` and the detail `over api.plan_budget (N)`, and stay in the ledger. `check` treats them as resolved, not pending, and reports how many there are.
- **Other fields:** `levels` gives the coverage levels TCL1–TCL7 reached, `questions` the clarification rows raised, and `verified` the stamp `check` writes.

**`plan-overlay.json`** (schema `api-plan-overlay`) holds the api-test-planner's judgments, applied by `build`. Every fact in it is cited.
- `statusRules`: exact statuses per fault class.
- `values`: realistic valid values.
- `testcases`: links from test cases to scenarios.
- `scenarios`: business rules.
- `dependencies`: inter-parameter rules.
- `bfla`: functions a role must be refused.
- `priorities`, each with a reason.
- `exclude`, each with a reason and a detail.

`api-test-plan.md` is rendered from these files. It sets out the scenarios, readonly versus full-run, documented-only endpoints, data left behind, blocked scenarios, class-only expectations, questions, drift and what is not covered.

## 5. Load workload and k6 scripts (`workload.mjs` → `k6-workload-designer`; `k6-code.mjs` → `k6-script-writer` → reviewer, runner)

Script-built (D-057). The rules (test types, open model, sizing, caps, thresholds, writes) are in [`k6-conventions.md`](k6-conventions.md).

**The workload**: `node scripts/workload.mjs build|check|paths <product> <m> [--run <run-id>]` (`scripts/lib/workload.mjs`) owns these files in `modules/<m>/k6/`; the designer writes only the overlay.
- **`workload.json`** (schema `workload`): `{module, runId (the results run), mode, types[], notes[], scenarios[]}`. Each scenario:
  - `id` (`K6-<m>-<n>`), `key` (`<endpoint key>|<type>`, `mix:<name>|<type>` or `flow:<name>|<type>`), `name` (`<type>-<n>`; its script is `<m>-<name>.js`), `type`, `kind` (`endpoint`, `mix` or `flow`), `endpoints[]`;
  - `weights` and `citation` (mix); `flow` `{name, steps[{endpoint, method, path, bind?{param, from, pointer}}], citations}` and `cleanup` `{endpoint (the delete step, or null), trackLeftover: true}` (flow);
  - `mutates`, and `queryLike: true` for a query-like POST;
  - `executor`, `load` `{rps (peak), averageRps, capSource, rateLimitCapRps?, durationS}`, `sizing` `{peakRps, expectedIterationS, headroom, preAllocatedVUs, maxVUs}`;
  - `thinkTimeMs`, `thinkTimeCitation?`, `data[]` `{target, need, citation}`;
  - `thresholds[]` `{metric, endpoint?, stat, limit, expr, source, assumed, abortOnFail?}`;
  - `options`: the exact k6 object `{scenarios: {<name>: …}, thresholds: {<metric>: [expr | {threshold, abortOnFail}]}}`, which the script copies verbatim.
- **`workload-coverage.json`** (schema `workload-coverage`): the ledger over every catalogue endpoint: `loaded[{endpoint, key, ids}]`, `excluded[{endpoint, key, reason, detail, citation?}]` (reasons in order: `not-planned`, `overlay-excluded`, `mutating-readonly`, `failed-functional`, `blocked`, `untested-functional`, `rate-limited`, `no-safe-data`), `deferred` (`budget`); plus `skippedTypes`, `notes`, `unmappedResults` (results items with no single `API-<m>-<n>` title id), `inputs` and `verified`.
- **`workload-registry.json`**: the stable ids (`lib/registry.mjs`, prefix `K6`, field `scenarios`).
- **`workload-overlay.json`** (schema `workload-overlay`, k6-workload-designer): `{priorities: {<EP id>: {priority, citation}}, mixes: [{name, endpoints: [{endpoint, weight}], citation}], thinkTime: {<EP id>|mix:<name>|flow:<name>: {ms, citation}}, data: [{target, need, citation}], exclude: [{endpoint, reason, citation}], flows: [{name, steps: [{endpoint, bind?}], citations}]}`. Citations are checked by `lib/citations.mjs`.
- **`check`** compares both files with a fresh build (against a copy of the registry, so it never assigns ids), applies the open-model and safety rules, and stamps `workload-coverage.json` `verified`; the flow's `workload` step refuses a missing or stale stamp. The designer is invoked with `run=<run-id>` and passes `--run`.
- **Reports.** The designer returns the scenarios (id, type, kind, peak rps, VUs, mutates), the skipped types, the exclusions by reason, the deferred count, the assumed thresholds and its overlay entries.

**The scripts**: `node scripts/k6-code.mjs build [--adopt]|check|paths <product> <m>` (`scripts/lib/k6-code.mjs`) needs a verified workload, and writes one managed script per scenario, `k6-tests/<p>/scripts/<m>-<name>.js`, the slot skeleton `k6-tests/<p>/scripts/slots/<m>.js`, and in `modules/<m>/k6/`:
- **`code-plan.json`** (schema `k6-code-plan`): `{module, runId, mode, basePath (the k6 overlay's), files, scripts[{id, name, file, type, kind, endpoints, mutates, queryLike?, weights?, requests[{endpoint, method, path, urlPath? (relative to basePath), pathParams, expect {status | statusIn | statusClass: 2xx, source}, slots, bind?}], trackLeftover? {type, pointer, assumed}, cleanup? {endpoint}, thinkTimeMs}], slots[{key, function, kind, endpoint?, needed, usedBy, filled}], verified?}`.
- **`parked.json`** (schema `k6-code-parked`): `{module, regions: {<slot key>: {lines, run}}}`, bodies of slots no longer generated, restored when the slot returns.
- **`legacy/`**: hand-written `<m>-*.js` that `build --adopt` moved out of `scripts/`.
- **Slot keys**: `data`, `path:<EP>`, `query:<EP>`, `body:<EP>`, `checks:<EP>`.
- **`check`** lists every problem as `<file> [<rule>] <problem>` and stamps `code-plan.json` `verified` over the workload, its coverage, the catalogue, the plan, the k6 overlay, the slots and every script; the flow's `scripts` step verifies it once (`verifyOnce`), and the gate requires it to be current on every round.
- **Reports.** The script-writer returns the scripts (file → K6 id), the slots filled and any needed slot still empty, the missing lib exports (the orchestrator routes them to k6-lib-writer), and the check result.

## 6. Review findings (every reviewer → its domain orchestrator → fixer)

`results/<run>/<m>/<domain>/review-findings.md` (`<domain>` = `testcases`, `playwright-ui`, `playwright-api`, `k6`):

```
# Review -- <domain> / <m> -- round <n>
Verdict: pass | changes-required
| # | Severity | File | Line | Rule | Problem | Required fix |
|---|---|---|---|---|---|---|
```
Severity `blocker | major | minor`. `Verdict: pass` exactly when there is no blocker or major finding. Reviewers never edit what they review.

**Test cases (D-053).** `testcase-reviewer` writes `results/<run>/<m>/testcases/review.json` (schema `testcases-review`): `{module, round, cases: {<TC id>: {verdict: "ok", version} | {verdict: "finding", version, findings: [{severity, rule, problem, fix}]}}, general?}` with a verdict on **every** current case in this round. `version` is the case's current `version` in `coverage.json` (`v<hash>`, the same one approvals pin): a verdict for an earlier version is refused, so an edited case is always reviewed again. `node scripts/testcases.mjs review-check <p> <m> --round <n>` fails until it is complete, and renders `review-findings.md` in this format with the **derived** verdict; `orchestration.mjs` derives it the same way and never trusts a typed `Verdict:` line.

**Gate findings.** At the start of each review round `orchestration.mjs next` runs the gate (`node scripts/gate.mjs <product> <m> <domain>`), which writes `results/<run>/<m>/<domain>/gate-findings.md` in the same format (heading `# Gate -- <domain> / <m>`; the Rule column holds the gate rule id) with the mechanical checks: ids and tags, traceability, `@mutates`, ledger calls, fixed waits, hard-coded URLs, the safety calls, and compile/`--list`/`k6 inspect`. On `changes-required` (exit 1) that file goes to the writer or fixer instead of starting the reviewer; on `pass` the reviewer judges only what a script can't.

## 7. Triage (every runner-triager → its domain orchestrator → fixer)

Script-built (D-058): `node scripts/triage.mjs prepare|build|check|paths <p> <m> --domain ui|api|k6`. Files in `results/<run>/<m>/<framework>/`:

| File | Owner | Content |
|---|---|---|
| `results.json` | `results.mjs` | Items with ids: UI `tcId`; API `scenarioId` and `tcIds`; k6 `k6Id`; all: `attempts`, `passedOnRetry`, `project`, `frames`, `attachments`, `skipReason`, `smoke`. Playwright retries a failed test twice (`retries: 2`, `trace: 'on-first-retry'`); a failed k6 smoke is re-run once, as the summary `<script>.retry`. |
| `triage.json` | `triage.mjs build` (schema `triage`) | One row per non-passed item, plus a row for each item the report never showed (a hidden `@mutates` test in a readonly run, an unapproved case or scenario, a k6 scenario of a readonly run). Row: `key`, `title`, `status`, ids, `attempts`, `error`, `signature`, `evidence`, `class`, `classSource` (`rule` or `agent`), `rule`, `reason`, `cite`, `healable`, `fixHint`, `expectation`, `knownIssue`, `cluster`. Also `summary`, `clusters` (`BUG-<m>-<n>`, signature, ids) and `notFailures`. `check` adds the `verified` stamp. |
| `triage-overlay.json` | the runner-triager (schema `triage-overlay`) | `rows`: `{key, class, reason, cite?, healable?, fixHint?, evidence?, expectation?}` for every open row, and for an override of a rule's class (reason and `cite` required). `bugs`: one draft per product-bug cluster: `{cluster, title, steps, expected: {text, source}, actual: {quote}, evidence, affected, severity}`. |
| `triage.md` | `triage.mjs build` | The rendered table (Test, File, Classification, Healable, Evidence, Suggested action), the classes, the clusters and the bug drafts, for humans and the report. No agent reads it for data. |
| `artifacts/<p>/modules/<m>/triage/triage-registry.json` | `triage.mjs build` | The stable `BUG-<m>-<n>` ids, keyed `<domain>\|<signature>`. |
| `artifacts/<p>/known-issues.json` | a human (schema `known-issues`) | `{issues: [{id, signature, title, reference, module?}]}`. A failure whose signature equals an entry's is `known-issue` by rule. No agent writes it. |

Classes: `product-bug` · `test-bug` (healable) · `locator-drift` (healable) · `flaky` · `environment` · `blocked-by-mode` · `awaiting-approval` · `known-issue`. The script decides, in this order: `awaiting-approval`, `blocked-by-mode` (neither can be overridden), `flaky` (pass on retry; never a product bug), `known-issue`, `environment`, `locator-drift` (a UI smoke locator count of 0, or a timeout on a page-object locator), and the API class-only rule (an actual in the class is no failure, outside it a candidate `product-bug`). The agent classes every other row (skipped and parked items included) and judges a candidate. A `product-bug` row needs evidence that exists (a trace, screenshot or response capture) and an `expectation` source (`scenario:<API or K6 id>`, which for k6 needs a failed `slo:` threshold, `testcase:<TC id>`, `clarification:<id>` or `knowledge:<path>`). Healable only `test-bug` and `locator-drift`. Product bugs are reported, never "fixed" by changing the expectation.

Signature: `errorClass | message (ids, UUIDs, hex and numbers erased, 200 chars) | first frame outside tests/ (no line) | step` (UI locator, API endpoint id, k6 failed metrics). `check` fails on an unclassified row, a product bug without evidence or expectation, a product-bug cluster without a draft (or a draft for none), an override without reason and citation, a triage that differs from a fresh build, or results changed since the build. The heal loop starts only from a verified triage.

## 8. Results (`runner-triagers` → report)

`results/<run>/<m>/<framework>/results.json` — written only by `node scripts/results.mjs` (schema `results`). Never write it by hand.

## 9. Knowledge base (`knowledge-generator` → everyone)

`knowledge/` for the product pass, `knowledge/modules/<m>/` for a module pass. The layout and the checks are in [`artifact-contract.md`](artifact-contract.md) §"Knowledge base" (D-015, D-051).

| File | Owner | Content |
|---|---|---|
| `overview.md`, `glossary.md`; `modules/<m>/{overview,glossary,notes}.md` | knowledge-generator | Cited facts. A rule fact cites with a quote, `[S3 "exact words"]`. Unconfirmed items go under `## Open points`, one bullet each, optionally tagged `(entities)`, `(flows)`, `(rules)`, `(roles)`, `(limits)` or `(dependencies)`. |
| `captures/<file>.txt` | knowledge-generator | The text the agent observed on a page the script can't fetch; input to `knowledge.mjs snapshot --from-file`. |
| `sources.json`, `sources.md`, `modules/<m>/sources.md` | `knowledge.mjs` | The source registry (`S<n>`) and its renderings. |
| `sources/S<n>.txt`, `sources/index.json` | `knowledge.mjs snapshot` | The cached text of a source, which quotes are checked against (schema `knowledge-source-cache`): `status` `fresh`, `stale` or `failed`; `captured_by` `script` or `agent`; the `runId` that cached it; the last `fetchError`. |
| `coverage.json`, `modules/<m>/coverage.json` | `knowledge.mjs` | The pass's input ledger (schema `knowledge-coverage`): each configured input read, failed or excluded with a reason; extra sources mapped or `deferred: budget`; the `verified` stamp. |
| `open-points.json`, `modules/<m>/open-points.json` | `knowledge.mjs render` / `check` | `{module, next, points: {<normalized text>: {id, status, text, category, file}}}` (schema `knowledge-open-points`). Ids are `KQ-<m>-<n>` or `KQ-product-<n>`, stable across rebuilds; a removed point stays as `gone`. |

**`modules/<m>/rule-facts.json`** (owner: `knowledge.mjs check`; schema `knowledge-rule-facts`) is a separate file from the ledger because it describes the notes' facts, not the inputs. It lists every rule fact of `notes.md` (the lines that need a quote) with each verified quote and its `evidence`:
- `script-fetched`: the script fetched or read the text in its run;
- `agent-capture`: the text is the agent's `--from-file` capture;
- `stale`: a later re-fetch failed, and the older text was kept.

A fact's `evidence` is its strongest quote's, in that order. `agent-capture` and `stale` facts are allowed but weaker: `check` lists them under `agentCapturedRuleFacts` and `staleRuleFacts` (file, line, source ids), and the test-case side tags cases built on them `@assumption` (not implemented yet).

**Consumers.** Every later agent reads the markdown. **module-explorer consumes `modules/<m>/open-points.json`:** it accounts for every active `KQ-` id of its module. That side is not implemented yet. Citations into the knowledge base from other artifacts use `knowledge:<path>`.

## 10. Foundations (`pw-repo-owner`, `pw-ui-scaffolder`, `pw-api-scaffolder`, `k6-lib-writer` → every Playwright and k6 writer)

The fixed files of the Playwright repo and the k6 lib are rendered by `node scripts/foundation.mjs render <p> --side repo|ui|api|k6` from the framework's `templates/` (D-054). Each agent writes only its side's overlay, `artifacts/<p>/foundation/<side>-overlay.json` (schema `foundation-<side>-overlay`), and that side's extension files. Every value cites its source: `observation:` (an exploration state or snapshot, with `module`), `spec:`, `knowledge:`, `clarification:` or `testcase:`, checked by `lib/citations.mjs`.

| Overlay | Shape |
|---|---|
| `repo-overlay.json` | `{requests: [{kind: dependency, name, dev?} \| {kind: env, name} \| {kind: gitignore, pattern} \| {kind: config, name: testTimeoutMs\|expectTimeoutMs\|retries\|workers\|fullyParallel, value}]}`; each also `reason`, `requestedBy`, `module?`, `cite`. No versions, values, negated ignores, or grepInvert. |
| `ui-overlay.json` | `{settings: {actionTimeoutMs?, navigationTimeoutMs?: {value, cite}, viewport?: {value: {width, height}, cite}, loadingIndicator?, cookieBanner?: {role, name, module, cite}}, login?: {module, state: ST-…, cite: [observation:explore/<its snapshot>], username, password, submit: {role, name}}, notes: [{topic, text, cite}], requests: [{kind: gap, text, requestedBy, files, exports, cite}]}`. A selector's role and name appear verbatim in a cited snapshot; `login` needs a state of `explore/model.json` on the target's host with no CAPTCHA or MFA. |
| `api-overlay.json` | `{basePaths: [{name, path, module?, cite}], auth?: {scheme: none\|session\|bearer\|basic\|api-key\|oauth2, header?, prefix?, env?, cookie?, module?, cite}, defaultHeaders: [{name, value, cite}], timeoutMs?: {value, cite}, notes, requests}`. Citing `spec:discovered-endpoints.json` requires an endpoint with that `auth` / `basePath`; `env` is a variable name; no auth header among the defaults. |
| `k6-overlay.json` | `{auth?: {scheme, header?, prefix?, cookie?, module?, cite}, basePath?: {path, module?, cite}, defaultHeaders, notes, requests: [{kind: missing-export, text, requestedBy, files: [lib/ext/…], exports, cite}]}`. |

| File | Owner |
|---|---|
| the side's managed files (headed "Generated by scripts/foundation.mjs — do not edit"; JSON ones listed in `playwright-tests/<p>/.foundation-managed.json`) | `foundation.mjs render`; nobody edits them |
| `artifacts/<p>/foundation/<side>-manifest.json` (schema `foundation-manifest`): the rendered files, and the `verified` stamp of a passing `check` | `foundation.mjs` |
| `fixtures/<side>/index.ts`: generated from the module registrations (D-056), managed | `foundation.mjs` `renderIndex`, written by `render` and the code scripts' builds |
| `helpers/<side>/` (not `helpers/api/schema.ts`), `lib/ext/` | the side's agents, as in the conventions |

**Gap and change requests.** A worker's foundation gap (or missing lib export, or shared-file change) goes to the owning agent through its orchestrator. The agent adds a structured entry to its overlay, writes any extension file, re-renders and checks; `check` keeps every export a request lists. pw-repo-owner refuses a change the overlay can't express.

**Check.** `foundation.mjs check <p> --side <side>` fails on an invalid or uncited overlay value, a hand-edited managed file (package.json's dependency versions and `package-lock.json` excepted), a missing guard fixture or one not `auto`, a guard that lets a non-GET through in readonly, a weakened `grepInvert`, a hard-coded URL, credential or token, an `auth.setup.ts` with credential login and no cited login state, a k6 lib without `assertAllowedHost` or `requireFullRun`, an `index.ts` that is not its render, or a compile failure (`npx tsc --noEmit` and `playwright test --list`, or `k6 inspect` of a temporary script). A full pass writes the stamp; a failure clears it.

## 11. UI code (`ui-code.mjs` → `pw-ui-pom-writer`, `pw-ui-tests-writer` → reviewer, runner)

Script-scaffolded (D-055): `node scripts/ui-code.mjs build|check|paths <product> <m>` (`scripts/lib/ui-code.mjs`) owns `modules/<m>/ui-code/` and the generated parts of the module's UI code. The layout and the locator policy are in [`playwright-conventions.md`](playwright-conventions.md) §"UI code is scaffolded".

- **`ui-code/plan.json`** (schema `ui-code-plan`): `tests` (per approved non-`@api` case within `testcases.max_cases`: `id`, `version`, `title`, `tags`, `literal` (the test's title), `steps`, `expected`, `preconditions`, `data` (keys only), `covers`, the `states` and `pages` it touches, its `fixtures`), `objects` (per required page template and dialog: `key` (`PG-<m>-<n>` or `PG-<m>-<n>#dialog:<name>`), `kind`, `class`, `fixture`, `file`, `states` and `snapshots` (its locators' ground), `smoke` (`{state, url, clicks}` or `{skip}`), `cases`), `awaiting` (unapproved cases with their status: `awaiting`, `rejected`, `changes`, `invalidated`), `deferred`, `unmapped` (cases no page template could be derived for), and the `files` and `registration` names.
- **`ui-code/coverage.json`** (schema `ui-code-coverage`): the ledger (`lib/coverage.mjs`). Items: every case of the module (`kind: case`) → `mapped` to `tests/ui/<m>/cases.spec.ts`, `excluded` (`not-approved`, `api-side`, or `parked`: approved but parked with `test.fixme(true, '<reason>');`, so not covered) or `deferred` (`budget`); every page template (`kind: page`) → `mapped` to its page object or `excluded` (`not-touched`); every dialog (`kind: dialog`) → `mapped` to its component. Plus `parked: [{id, reason}]` (refreshed by `build` and `check`), `built.inputs` (digests of the cases, the approvals, the model, the flows, the run-config) and `verified: {pages, tests}`.
- **`ui-code/parked.json`** (schema `ui-code-parked`): `{module, regions: {<key>: {lines, title, run}}}`, the bodies of regions no longer generated, restored when the key returns.
- **`cases.spec.ts` regions.** Keys: `setup`, `TC-<m>-<n> data` (at the top of each test: only `const <name> = <builder>(…);` from the module's data file, visible to every step, rebuilt on each retry), `TC-<m>-<n> step <n>`, `TC-<m>-<n> then`. A step body uses the test's fixtures (`page` and the page objects the plan lists) and the test's data names, under the rules of `check`. A case that can't be automated yet is parked with `test.fixme(true, '<reason>');` as the first statement of its first step; its other steps may stay empty.
- **`build`** reports `tests`, `objects`, `awaiting`, `deferred`, `unmapped`, `written`, `restored`, `parked` and `changedSteps` (steps whose text changed since their body was written: revisit them).
- **`check [--pages]`** lists every problem as `<file>:<line> [<rule>] <problem> -- <fix>`. Rules: `page-object` (missing, or not exporting its class), `locator-grounding`, `locator-policy`, `locator-param` (a data-driven locator outside the runtime-data rule, or a call site passing anything but a grounded literal, a builder's value or a calling method's parameter), `data-file` (the data builders doing more than data), `data-region`, `data-shadow`, `data-unique` (the per-test data region, its names re-declared or reassigned, a fixed value reaching a locator), `po-access` (a page object used other than as `po.member` or `po.method(…)`), `test-info`, `fixture-registration`, `generated` (the smoke or the registration out of date or edited: run `build`), `skeleton` (a missing test, a changed title or tags, generated code edited, broken markers, a listed test that is not the plan's), `extra-test`, `test-reference`, `raw-locator`, `silent-skip`, `extra-file`, `empty-step`, `no-assertion`, `visual`, `ledger`, `parked` (a minor: an approved case parked, with its reason; `check` also returns them as `parked`), plus every gate rule (`no-fixed-wait`, `no-assertions-in-objects`, `traceability`, `approval`, `mutates-tag`, `test-declaration`, `no-hardcoded-url`, `typecheck`, `list`, …). The gate reports the same rules in `gate-findings.md`.
- **When the stamps are read.** The flow verifies the `pages` and `tests` stamps once, when each step is first seen done; from then on every review round starts with the gate, which re-checks every rule. A heal round's fix, though, reaches the next run with no gate and no check in between. That is true for every domain's run loop today, and G10 will address it.
- **Reports.** pw-ui-pom-writer returns the page objects and their public methods, any locator it could not ground, and any foundation gap; pw-ui-tests-writer returns the cases implemented, those parked with `test.fixme` (and why), the page-object methods it is missing (the orchestrator routes them to pw-ui-pom-writer), and any foundation gap.

## 12. API code (`api-code.mjs` → `pw-api-client-writer`, `pw-api-tests-writer` → reviewer, runner)

Generated (D-056): `node scripts/api-code.mjs build|check|paths <product> <m>` (`scripts/lib/api-code.mjs`) owns `modules/<m>/api-code/` and every generated file of the module's API code. The layout, the test body and the slot rules are in [`playwright-conventions.md`](playwright-conventions.md) §"API code is generated".

- **`api-code/plan.json`** (schema `api-code-plan`):
  - `clients`: per resource, its `class`, `fixture`, `file` and `schemaFile`, and its `methods` (per endpoint: `name`, `method`, `path`, `crud`, `mutates`, path and query parameters, `body`, `contentType`, the edge-case `headers`, `notes` and the type names);
  - `tests`: per plan scenario, its `file`, `literal` (the title), `tags`, `kind` (`test`, `blocked`, `parked`) with `reason`, `mutates`, `identities`, the approved `testcases`, the `payloads` it uses, its `glue`, whether it `creates` data and its `cleanup` (per creating endpoint: the ledger type, the id pointer, the delete operation or none);
  - `payloads` (per builder: `name`, `kind` = `body`, `changed`, `query`, `headers`, `variables` or `parts`, `endpoint`, `type`, `scenarios`), `glue`, `parked`, `blocked`, `deferred` (the plan's coverage items over `api.plan_budget`), and the `files` and `registration` names.
- **`api-code/coverage.json`** (schema `api-code-coverage`): the ledger (`lib/coverage.mjs`). Its items:
  - every catalogue endpoint (`kind: endpoint`): `mapped` to `clients/<m>/<resource>.client.ts#<method>`;
  - every plan scenario (`kind: scenario`): `mapped` to its spec, or `excluded` with reason `blocked` (by the plan) or `parked` (by the tests-writer), generated as a `test.fixme` with the reason;
  - every plan coverage item over the budget (`kind: plan-item`, `plan:<item>`): `deferred` (`budget`);
  - every payload and glue slot (`kind: payload`, `glue`): `mapped` once filled, `pending` while empty.

  Plus `parked`, `blocked`, `problems`, `built.inputs` (digests of the catalogue, the plan, its deferred items, the test cases, the approvals, both overlays and the run-config) and `verified: {clients, tests}`.
- **`api-code/parked.json`** (schema `api-code-parked`): `{module, regions: {<file>#<key>: {lines, run}}}`, the bodies of slots no longer generated, restored when the slot returns.
- **`api-code/client-overlay.json`** (schema `api-code-client-overlay`, pw-api-client-writer): `{classes: {<resource>: {name, cite}}, methods: {<EP id>: {name, cite}}, edgeCases: [{endpoint, kind: content-type|header|note, value?, name?, text?, cite}]}`. A `spec:` citation is the endpoint's own spec node (`spec:sources/<file>#<pointer>` as its `sources` give it, or a node inside it); `knowledge:`, `clarification:` and `observation:` are checked by `lib/citations.mjs`. A name must be spelled by whole words, and a value must appear as a whole token, in a cited text. A credential header, a URL or a key-like value is refused.
- **The run-time checks and the facade.** `clients/<m>/sender.ts` (imported only by generated code) opens a session per test (`beginTest`), records every create at once as (entity type, canonical id), refuses a path value without its schema's format and a change whose path value or body, query or variables entity reference is not an owned id of its type (the plan's own values excepted), gives `c.track` only marked creates, and `session.end` deletes only what the ledger says this run owns. `clients/<m>/support.ts` holds the types and pure helpers. `clients/<m>/facade.ts` gives glue and composite helpers the reads and plain creates only. An unknown id on a request that changes data is an entity the test created and deleted (`tests[].gone`).
- **Glue** (`arrange…(c, given)`) runs after the setup, reads `given.path`, and returns `{ path?, body? }` for the request. Its body fields are merged after the plan's values, which they may never replace (`mergeAgent` refuses it).
- **`api-code/tests-overlay.json`** (schema `api-code-tests-overlay`, pw-api-tests-writer): `{park: [{scenario, reason}], glue: [{scenario, reason, cite}]}`. `park` takes a runnable scenario only, with a reason of at least three words. `glue` takes a business scenario (rule `overlay`) only.
- **Slot keys.** `helpers/api/<m>.payloads.ts`: `imports`, `helpers` and `payload <builder>`. `helpers/api/<m>.glue.ts`: `imports` and `glue <arrange function>`. An `imports` slot holds only imports of the scaffolder's `helpers/api/<topic>.ts`.
- **`build --adopt`** first moves files no build made out of the generated folders into `api-code/legacy/` and reports them as `adopted`.
- **`build`** reports `clients`, `methods`, `tests`, `runnable`, `blocked`, `parked`, `deferred`, the `payloads` and `glue` slots (filled, empty), `written`, `removed` (generated files no longer generated), `restored` and `parkedSlots`, `problems` and `warnings` (e.g. a test case no longer approved, an unverified plan).
- **`check [--clients] [--static]`** lists every problem as `<file>:<line> [<rule>] <problem> -- <fix>`, with the rules of playwright-conventions.md, plus every gate rule for a full check. `--clients` covers the generated client files, the overlay, the composite helpers, the registration and `tsc`. A full check covers everything, `tsc` and `playwright --list`, and the list must hold each scenario exactly once. A pass stamps `verified.clients` (and `verified.tests` for a full check); a failure clears it; `--static` stamps nothing. A changed input (the catalogue, the plan, the approvals, an overlay) makes the build stale until it is rebuilt, and an unverified plan fails `check`.
- **The flow.** The `clients` and `tests` steps of `FLOWS["playwright-api"]` verify the two stamps once, when each step is first seen done (`verifyOnce`, as for the UI code); later rounds start with the gate, which runs the same rules.
- **Reports.** pw-api-client-writer returns the clients and methods, the overlay entries with their citations, the composite helpers and any foundation gap. pw-api-tests-writer returns the builders and glue written, the tests generated, blocked and parked (with reasons), the composite helpers it is missing (the orchestrator routes them to pw-api-client-writer) and any foundation gap.
