# Feedback: config `answers` entries cannot match Pass-1 questions written in advance
- Source agent: orchestrator-agent
- Date: 2026-10-04
- Severity: medium

Config `answers[].match` strings (e.g. "create and qualify a lead", "activity type coverage") were written from a prior run's question wording. Pass 1 now phrases questions differently (e.g. "What does \"qualify a lead\" mean concretely?"), so `run-config.mjs match` returned null for all 8 blocking questions. Suggestions: document stable keyword-style match strings, add a pre-run way to list/preview Pass-1 questions, and let `testcases.output_format` auto-answer the [Output Format] question.
