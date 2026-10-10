---
source_agent: playwright-automation-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - playwright-tests/freshsales/pages/deals/DealsModule.ts
  - playwright-tests/freshsales/tests/functional/deals/deals-bulk.spec.ts
  - artifacts/rakesh-freshsales-ind-sep21/modules/deals/testcases/deals-testcases.csv
severity: medium
---

## Finding 1: Bulk delete needs a typed confirmation code
**Summary:** Deals bulk Delete opens a Confirm dialog "Type NNNN to confirm" (random number, Yes disabled until typed). Testcase 028 did not mention it. Spec reads the code from the dialog.

## Finding 2: Soft-deleted ZZ deals pile up in the Recycle Bin; tracker "deleted" flag can drift
**Summary:** Delete is soft; ~55 ZZ deals from this track remain in the Recycle Bin (only TC-025 forgets one). A restored deal (TC-024) was left live in All deals while the tracker said deleted. Suggest a final "Forget" sweep of ZZ-named Recycle Bin cards, with explicit approval since it is permanent.

## Finding 3: View URL after Recycle Bin
**Summary:** After restore, "All deals" can load under sibling view id 402015942756 rather than 402015942744; URL-based "is All deals" checks are fragile. Related: the persona rule "delete in afterAll" - the deals track uses a final cleanup spec which a mid-chain failure still reaches only in same run.

## Finding 4: Other-track ZZ deals in tenant
**Summary:** "ZZ Test Deal 912xxxxx" deals (not created by this track) exist in All deals; left untouched.
