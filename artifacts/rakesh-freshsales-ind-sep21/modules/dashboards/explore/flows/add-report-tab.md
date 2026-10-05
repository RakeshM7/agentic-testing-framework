---
slug: add-report-tab
title: Add a curated report as a dashboard tab, then remove it
module: dashboards
nav_path: Dashboards > +
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Add a curated report as a dashboard tab, then remove it.
## Preconditions
Authenticated session (Rakesh M, owner role appears).
## Steps
Click '+' next to tabs; 'Select a report' dropdown with Search report and Popular reports (Chat Dashboard, Ecommerce Marketing Journey Report, Product Dashboard, Team activity report, Sales Trends, Sales Forecast, Contact generation and trends). Select 'Sales Trends' -> new tab (tab=18846; POST /crm/sales/analytics_dashboard). Widgets: Deals created over time, Open pipeline, Deals closed over time, Pipeline by owner, Lost reasons (No data!), Sales cycle 7.25. Removed via tab X; no confirmation dialog observed.
## Outcome
Created tab 18846; removed same run.
## Variations and errors
Page 'Request demo' button (top bar) opens a Freshchat conversation and auto-creates a support ticket; avoid. Chat widget can intercept clicks until page reload.
## Cleanup
Tab 18846 removed via tab X.
## Related flows
open-dashboards, switch-dashboard-tab
