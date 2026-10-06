---
source_agent: api-testing-agent
date: 2026-10-05
target: rakesh-freshsales-ind-sep21
related_files:
  - api-tests/playwright-api/tests/freshsales/sales-sequences/sales-sequences.spec.ts
  - api-tests/playwright-api/fixtures/mutationGuard.ts
---
# Sales-sequences track findings

1. Prompt-level `mode: full-run` does not reach the shell: the shared mutation guard and the k6 guard hook both read `AUTHORIZATIONS_MODE` from the environment, so mutating specs only run with `AUTHORIZATIONS_MODE=full-run` exported, and the live k6 load run was blocked by the hook (not overridden). The orchestrator should export it when launching full-run tracks (see also 2026-10-05-full-run-hook-env-vs-prompt-mode.md). The hook also pattern-matches the literal text of the k6 run command anywhere in a Bash command (even inside a heredoc being written to a file), so docs must be written via the Write tool.
2. `k6 inspect` on scripts using `lib/guard.js` needs `-e BASE_URL=... -e K6_ALLOWED_HOSTS=...`; a shell env prefix is not seen by `__ENV` in inspect. Document in the k6 README/persona.
3. Product deviations (encoded as `deviation:` tests): no steps -> 500, empty/missing/duplicate/300-char names accepted, partial PUT -> 500, sequence_type unvalidated.
4. The run was resumed after a rate limit; an earlier discovery probe left log entry 402000016552 without a deleted flag. The tenant was verified empty live and the entry annotated.
