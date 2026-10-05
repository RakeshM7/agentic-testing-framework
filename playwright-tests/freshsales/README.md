# Freshsales Playwright suite (lead-to-deal pipeline)

Target: https://rakesh-freshsales-ind-sep21.myfreshworks.com (trial tenant). Mode: `full-run`.

- `tests/functional/lead-to-deal-pipeline.spec.ts` - serial chain TC-001..008, TC-014, then CLEANUP tests that delete only the contact/account/deal this run created (guarded by `created-entities.json`).
- `tests/functional/validation.spec.ts` - TC-009..013 validation negatives.
- `tests/visual/add-contact-drawer.spec.ts` - drawer visual baselines (`--update-snapshots` generates goldens).
- TC-015 / TC-016 are placeholders for unconfirmed behaviour (Q9) and are intentionally not automated.

## Auth
Scripted login is CAPTCHA-gated, so the suite reuses `.auth/freshsales-handoff.json` as `storageState` (see `playwright.config.ts`). Credentials live in `.env.freshsales` (quote any value containing `#`).

## Run
```
npm install && npx playwright install chromium
npx playwright test
```
Created entities are recorded in `artifacts/rakesh-freshsales-ind-sep21/playwright/created-entities.json`.
