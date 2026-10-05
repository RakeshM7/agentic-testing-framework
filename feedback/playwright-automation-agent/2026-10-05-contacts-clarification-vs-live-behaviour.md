# Feedback: playwright-automation-agent, 2026-10-05 (contacts track)

## Observations
- Clarification/live-behaviour mismatches found while building the contacts track (tests assert OBSERVED behaviour and annotate it):
  1. TC-026: Mobile-only Add contact is documented as valid, but the live form blocks Save with "You need to fill this field" on Email.
  2. TC-031: "Lost needs a Lost reason" - saving Status Lost without a reason showed "Contact updated." (a contact was left in Lost status). Test asserts the spec and fails-closed only on the toast being absent; see test comment. TC-033 skipped (Lost-reason control location not captured).
  3. TC-034: Call log Outcome is not marked mandatory in the live form.
  4. TC-043: "Bulk actions" with nothing selected selects ALL rows (spec said no menu). Never click a bulk action after it.
  5. TC-004/046: no list-scoped search box exists; only the global "Search your CRM".
  6. Bulk toolbar has no "N contacts selected" text; count ticked rows via `.ag-row .rs-checkbox-checked`.
  7. Add tags dialog is pick-from-existing (Save disabled until chosen), so tag creation was not exercised.
  8. TC-039: whether junk Mobile 'abc-!!' is accepted is recorded as an annotation, not asserted.
- Tooling: ag-grid row checkbox inputs are not visible; click the row at position x=18. Row kebab only responds to an absolute mouse click after hover (x=489). Sort menu labels use arrows ("Sort ascending A -> Z"), so match with regex.

## Suggestions
1. Persona/agent bug: an afterAll cleanup that marks entities `deleted: true` even when the delete step was skipped (page not ready within a short wait) silently leaks run-created data. Only mark deleted after a confirmed delete (fixed in pages/contacts/ContactsModulePage.ts `cleanupTrackEntities`).
2. Parallel tracks share `utils/createdEntities.ts` type unions that don't compile together (accounts track has tsc errors); shared files should be owned by the scaffolding track.
3. testcase-generator should not assert a "N contacts selected" label; explore evidence did not capture it.
