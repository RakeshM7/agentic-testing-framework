---
slug: schedule-report-validation
title: Open New Schedule form and trigger validation
module: analytics
nav_path: Analytics > <report> > Export > Schedule report
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open New Schedule form and trigger validation
## Preconditions
Org admin session.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | report-view-explore-qa | Click Export (button) | menu: Schedule report, Email Now, Download | report-view-explore-qa |
| 2 | report-view-explore-qa | Click Schedule report | panel 'Schedules - Report' with 'Schedule the reports' and New Schedule button | report-view-explore-qa |
| 3 | report-view-explore-qa | Click New Schedule | form: Schedule name* (default New Schedule), Send Report (Monthly), On/First/Last day+time, Time Zone (Etc/UTC), Send to* (logged-in user email), Subject*, Description, Report Format (PDF of graph data, disabled) | report-view-explore-qa |
| 4 | report-view-explore-qa | Clear Schedule name, click Save | inline error 'Schedule name cannot be empty' | report-view-explore-qa |
| 5 | report-view-explore-qa | Click Cancel | returns to report view; nothing saved | report-view-explore-qa |
## Outcome
See steps.
## Variations and errors
Valid schedule NOT submitted (it would send recurring emails). Email Now and Download not executed.
## Cleanup
n/a
## Related flows
see flows/index.json
