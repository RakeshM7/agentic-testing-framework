# Feedback: playwright-automation-agent, 2026-10-04

## Observations
- Freshsales (Ember power-select) dropdowns: typing with `keyboard.type` right after opening drops the first characters into the form behind; use the dropdown's own search input with `fill`. Newly created accounts take 10-60s to become searchable; the first option is always an 'Add new'/'Create new' entry that must be excluded when selecting an existing record.
- The kanban drag must never end over the Won/Lost drop zones (bottom edge / right-edge autoscroll opens a 'Won' stage-change modal). The suite verifies via `elementsFromPoint` that the pointer is over the intended open-stage column before releasing.
- Weak assertions bit repeatedly: text found inside a still-open editor, or in a hover tooltip, produced false passes. Persona hard rule suggestion: for save flows, assert on a post-save artifact (toast / list row) that cannot be satisfied by the form itself.

## Suggestions
1. Add to the persona: when an ad hoc discovery script is needed, keep it read-only; an ad hoc script that created a contact (invalid-phone probe) was blocked/denied by the permission layer and left an untracked entity.
2. Session-state reuse (authorizations.session_state_file) worked cleanly as the project-wide `storageState`; document it as the preferred pattern over a setup project.
3. explore-agent DOM snapshots lack form-field detail (drawers/modals); the persona should allow read-only live form discovery.
