# Dashboards track: persisted UI prefs and shared-file issues

- Agent: playwright-automation-agent
- Date: 2026-10-05
- Severity: medium

## Findings
1. Freshsales Activities Dashboard activity-type filter and widget order persist server-side. A test that fails mid-way (TC-dashboards-025/026) leaves the tenant changed ("+ 1 activity"), breaking later runs. Mutating-pref tests need try/finally restore. Hiding then restoring a widget (TC-014/015) moves it to the END of the order; original order is not restorable without drag-and-drop (TC-016 skipped), so Quick Links now sits last on the tenant.
2. Curated report "Data Updated:" text and "+ filter" labels were not literal DOM (icon + "filter"); explore text capture should record icon-prefixed labels separately.
3. Shared file: `tsc --noEmit` reports errors in pages/accounts/AccountsPage.ts and utils/createdEntities.ts typing (accounts track, not edited).
