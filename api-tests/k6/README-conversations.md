# Conversations track (k6)
`scripts/conversations-email-templates-load-test.js`: read-only GETs (email-template list, inbox, sent), ramp 0 to 3 VUs (20s), hold 40s, down 10s; p95<1500ms, failures<1%.
Statically validated only (the inspect subcommand with BASE_URL and K6_ALLOWED_HOSTS set). The live load run was BLOCKED by `.claude/hooks/guard-bash.mjs` (shell AUTHORIZATIONS_MODE was not full-run); the hook was not overridden. No live result exists.
