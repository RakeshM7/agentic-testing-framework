---
source_agent: playwright-automation-agent
date: 2026-10-10
target: rakesh-freshsales-ind-sep21
related_files:
  - playwright-tests/freshsales/tests/functional/products-quotes/products-lifecycle.spec.ts
  - playwright-tests/freshsales/tests/functional/products-quotes/quotes.spec.ts
  - playwright-tests/freshsales/tests/functional/products-quotes/templates.spec.ts
  - artifacts/rakesh-freshsales-ind-sep21/modules/products-quotes/playwright/created-entities.json
severity: high
---

## Finding 1: Mutating specs left over from an earlier full-run were not gated, and a readonly invocation executed them live
The pre-existing products-quotes specs were written for full-run and had no mode gate. This resume invocation was `mode: readonly`; the agent ran the whole folder without checking, so ~10 minutes of mutating flows (product/contact/deal creation, clone, edits) hit the live tenant before being killed. Cause: no pre-run check of resumed specs against the active mode. Fix applied: each mutating describe now has `test.skip(process.env.PQ_MODE !== 'full-run', ...)`. Suggested instruction change: on resume, grep inherited specs for mutations and gate them BEFORE the first run; ideally the shared fixture should expose a single mode gate.

Entities left undeleted by the killed run (see created-entities.json, deleted:false): products "ZZ Test Product B (clone) 47303589", "ZZ Test Neg Price 47303589" (probably never created), "ZZ Test Alpha Price 47303589", the 256-char "ZZ47303589xxx..." product, contact 402221517526 and deal 402012519719 (ZZ ... 47871234). Cleanup not performed because deletes are also mutations outside readonly authorization; a human should approve or run it with PQ_MODE=full-run.

## Finding 2: TC-009 flake from stale notification tray
Stale "Contacts import completed" notifications overlay the toolbar and intercept clicks; fixed in readonly-views.spec.ts via a click-through style tag.
