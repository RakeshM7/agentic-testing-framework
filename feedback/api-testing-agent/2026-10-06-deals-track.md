---
source_agent: api-testing-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - api-tests/playwright-api/tests/freshsales/deals/deals.spec.ts
  - api-tests/playwright-api/helpers/freshsales/deals-track.ts
  - api-tests/k6/scripts/deals-deals-load-test.js
severity: medium
---

## Finding 1: Live k6 run blocked by guard hook (shell env is readonly)
guard-bash.mjs blocked the live k6 run (AUTHORIZATIONS_MODE != full-run in the Bash tool env); not overridden. The hook is a substring match: it also blocked a compound command and even a heredoc whose text merely mentioned the k6 run command, so run k6 inspect as its own call and write feedback files with the Write tool.

## Finding 2: Deals API quirks
Negative amount (-5) accepted (encoded as test.fail). Invalid expected_close silently nulled (200). Unwrapped payload ({name}) accepted. text/plain POST returns 500. 300-char names accepted. List without segment_id is 403 not 400. Bad-stage error also carries a misleading "Probability" message. No bulk-delete/forget/clone endpoints at probed paths (404); Recycle Bin forget is UI-only, so API-deleted ZZ API deals (soft delete) remain in the Recycle Bin.

## Finding 3: Helper pattern
The created-entities log uses a mkdir lock inside deals-track.ts for parallel workers, and the delete helper refuses ids not in the log. Could be promoted to a shared helper.
