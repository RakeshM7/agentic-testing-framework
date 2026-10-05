---
slug: open-dashboards
title: Open the Dashboards module
module: dashboards
nav_path: Dashboards
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Dashboards module.
## Preconditions
Authenticated session (Rakesh M, owner role appears).
## Steps
Click left-nav Dashboards (link /crm/sales/my_dashboards?tab=353503).
## Outcome
Lands on tab 353503 Sales Essentials Dashboard. Note: direct navigation to /crm/sales/my_dashboards in this session was repeatedly redirected by the app/shared browser to Contacts/Deals/Accounts; the nav click is the reliable route. Page <title> stays 'Activities Dashboard : Freshsales' for every tab.
## Variations and errors
Page 'Request demo' button (top bar) opens a Freshchat conversation and auto-creates a support ticket; avoid. Chat widget can intercept clicks until page reload.
## Cleanup
n/a
## Related flows
open-dashboards, switch-dashboard-tab
