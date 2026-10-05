# Feedback: sales-sequences resume/verify (2026-10-05)

- Gap: when a create/delete test fails mid-way, the leftover entity poisons later "empty state" tests (TC-002 skipped as "tenant has sequences"). Suggest an afterAll sweep of run-prefixed entities in each track's spec.
- Gap: created-entities.json is append-only; entries are never flipped to deleted, so the ledger has many "created" rows alongside separate "deleted" rows. Suggest recordSeq match on id/name and update in place.
- App drift: Freshsales sequence template gallery went from 10 to 11; TC-002 now asserts >= 10. Long (256-char) names are matched by run-stamped prefix, not full-string.
