# Pass-1 question wording drifts between runs; substring answers keep missing

Observed: three consecutive runs of requirements-clarification-agent Pass 1 produced differently worded questions, so `answers` substring matches fail (e.g. "Which pipeline(s) and stages" vs match "which pipeline and stages"; "What test-case output format is wanted?" vs match "What output format").
Suggestion: make Pass 1 emit stable question IDs/topic tags (e.g. [Q:output-format]) that `answers` can match on, or have run-config.mjs support a `topic` key / regex matching.
