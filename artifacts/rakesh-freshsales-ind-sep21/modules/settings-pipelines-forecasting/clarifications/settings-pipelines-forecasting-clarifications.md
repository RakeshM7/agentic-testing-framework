# Clarifications: settings-pipelines-forecasting

## Feature summary
Verify and navigate Freshsales admin deal settings under Admin Settings > Deals & Pipelines: pipelines and stages, deal fields (including preview and Add field), field dependencies, Quotas and Forecasting (forecast categories), Sales Activities, and Activity Goals. Coverage must include every flow in `explore/flows/index.json` (13 flows: open-deals-pipelines-settings, view-pipelines, create-pipeline-form, view-deal-fields, preview-deal-form, add-deal-field-picker, view-field-dependencies, create-field-dependency-form, view-quotas-forecasting, add-forecast-category-form, view-sales-activity-types, create-sales-activity-form, view-activity-goals). No requirement documents were provided.

## In scope / Out of scope
In scope:
- All 13 flows above (read, navigation, and create-form flows).
- Quota and forecast setup via the "Quotas and Forecasting" CTA on the Deals list page (confirmed entry point; see Confirmed behaviors).
- Live creation of ZZ-prefixed entities (pipelines, deal fields, field dependencies, forecast categories, sales activity types, activity goals) and deletion of only those the run created.

Out of scope / not confirmed:
- Modifying or deleting pre-existing data (Default Pipeline, system dependencies, built-in activity types, existing forecast categories) -- see Open questions; the "Yes" answers do not establish this.
- Product Catalog tile ownership: unresolved (see Open questions).
- Custom deal field type/limit exploration: deferred pending explicit approval for manual exploration.

## Confirmed behaviors
- [Q: Where are quotas set] Quotas and forecasting can be set from the "Quotas and Forecasting" CTA on the Deals list page. The Admin Settings > Quotas and Forecasting page itself shows only forecast categories, default category and Freddy toggles, with no quota entry UI.
- [Q: Create pipeline validation] "The suggested validation rule applies": the validations proposed in the question apply to Create pipeline (duplicate name, minimum stages, probability ordering, stale days range). Exact messages and limits were not supplied; test cases must record observed messages from live runs.
- [Q: Pipeline deletion] A pipeline cannot be deleted while any deal is tagged to it.
- [Q: Live creation, Scope/Blocking] Yes: tests may live-create ZZ-prefixed pipelines, deal fields, field dependencies, forecast categories, sales activity types and activity goals, and delete only those they created. Negative/validation-only submissions (e.g. empty name, duplicate name) may be run live.
- [Run-config] authorizations.mode = full-run (set explicitly by the user for their own trial tenant). Deletes only for entities this run created (tracked in created-entities.json).

Mutation rulings, stated separately:
- (a) Submissions that could succeed and mutate data: executed live under full-run, ZZ-prefixed, cleaned up only for run-created entities.
- (b) Submissions expected to be rejected by validation before mutation (empty/duplicate name etc.): permitted to run live (explicitly confirmed, and also non-mutating by nature).

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Delete a pipeline that has deals tagged to it | Blocked; pipeline cannot be deleted while a deal is tagged (confirmed) |
| Create pipeline with duplicate name / too few stages / bad probability order / stale days out of range | Rejected by validation (confirmed in principle; exact rules/messages not specified, capture from live run) |
| Create pipeline / forecast category / sales activity / dependency with empty name | Expected validation block; run live (negative case permitted); message to be observed |
| Delete a stage that contains deals | Unresolved (see Open questions) |
| Edit/delete system dependencies, Default Pipeline, built-in types, Best-case/Committed | Unresolved (see Open questions) |

## Non-functional constraints
- Safety: full-run, ZZ prefix for all created entities, delete only run-created entities.
- Activity Goals page lives outside the settings shell (/crm/sales/activity-goals); tests must handle the navigation context change.
- No performance/accessibility constraints raised.

## Confirmed test-case output format
CSV

## Open questions
Answers given as a bare "Yes" to non-yes/no questions are NOT treated as spec:
1. System-defined field dependencies (Pipeline->Deal stage, Deal stage->Lost reason, Deal stage->Closed date, Forecast category->Expected close date): can they be edited, disabled or deleted, and what validation applies on custom dependency creation (same parent/child, duplicate, choice mapping)? Answer was "Yes" -- unusable. Until resolved, tests must not modify or delete system dependencies (they are not run-created).
2. Forecast category validation (duplicate name, max count, required fields) and whether Best-case (default) or Committed can be edited/deleted: answer "Yes" -- unusable.
3. Default Pipeline and its stages: rename/reorder/delete allowed, and what happens to deals in a deleted stage: answer "Yes" -- unusable. Note possible tension with the confirmed rule that a pipeline with deals cannot be deleted; do not touch the Default Pipeline.
4. Sales activity validation (duplicate name, required icon/outcomes, max custom types) and whether built-in types (Email, Reminder, SMS, Chat) are non-editable: answer "Yes" -- unusable.
5. Activity Goals: Add goal inputs (activity type, target, period, owner/team) and validation: answer "Yes" -- unusable. Inputs must be observed live.
6. Product Catalog tile: in scope here or owned by the products module? Answer "Yes" does not select an option. Default assumption: only verify the tile navigates; flag for confirmation.
7. Custom deal field types and limits (max custom fields, choice limits, formula syntax): answer was "do a manual exploration through explicit approval" -- not a spec; requires explicit approval before exploration. Add field form was never seen (denied during explore).
8. Pipeline create validation: "the suggested validation rule applies" gives no concrete values (minimum stages, stale days range, probability ordering rule).
9. Quota entry flow (Deals list > Quotas and Forecasting CTA) was not explored; no flow exists in index.json for it, so inputs and validation are unknown.
10. Coverage gaps from explore: create-form flows were opened but not saved; no saved-state behavior observed.

## Follow-up Questions
- [Behavior] [Blocking] What is the exact UI flow and inputs for setting quotas from the Deals list "Quotas and Forecasting" CTA (period, owner/team, amount, validation), and should it be added as a flow for test coverage? Navigate: Deals list page toolbar > Quotas and Forecasting button (outside Admin Settings; not in flows/index.json).
- [Behavior] [Blocking] Please re-answer with specifics (not Yes): can system-defined field dependencies be edited, disabled or deleted? Navigate: Admin Settings > Deals & Pipelines > Deals > Manage field dependencies (flow view-field-dependencies).
- [Behavior] [Blocking] Please re-answer with specifics: what inputs and validation does Add goal have on Activity Goals? Navigate: Admin Settings > Deals & Pipelines > Activity Goals (flow view-activity-goals).
- [Scope] [Nice-to-have] Product Catalog tile: owned by this module or the products module (choose one)? Navigate: Admin Settings > Deals & Pipelines > Product Catalog tile (flow open-deals-pipelines-settings).
- [Scope] [Nice-to-have] Do you approve a manual exploration of the Add field configuration form to document custom field types and limits? Navigate: Admin Settings > Deals & Pipelines > Deals > Add field (flow add-deal-field-picker).
- [Edge Case] [Nice-to-have] May tests modify Default Pipeline, built-in activity types, or Best-case/Committed categories (pre-existing data), given full-run only permits deleting run-created entities? Navigate: Admin Settings > Deals & Pipelines > Pipelines > Default Pipeline (flow view-pipelines).
