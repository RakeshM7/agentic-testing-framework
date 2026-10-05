---
slug: switch-dashboard-tab
title: Switch between dashboards
module: dashboards
nav_path: Dashboards
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Switch between dashboards.
## Preconditions
Authenticated session (Rakesh M, owner role appears).
## Steps
Click tab 'Sales Essentials Dashboard' (353503), 'Sales Dashboard' (81767) or 'Activities Dashboard' (URL ?tab=activities).
## Outcome
Sales Essentials: Revenue won $12.3K, Revenue lost $6.2K, Deal win/loss percentage, Open deal value by stage, Contacts by sales owner, Forecasted revenue by deal stage, Revenue won by source, Tasks by owner; 5 pages Summary/Deals/Contacts/Sales activities/Revenue breakdown. Sales Dashboard: Contacts created over time, Contacts by owner, Open pipeline, Deals closed over time, Stage-wise forecast, Quota vs achievement (No data!). Both rendered in an iframe from freshreports.com with 'Curated' badge and 'Data Updated' timestamp.
## Variations and errors
Page 'Request demo' button (top bar) opens a Freshchat conversation and auto-creates a support ticket; avoid. Chat widget can intercept clicks until page reload.
## Cleanup
n/a
## Related flows
open-dashboards, switch-dashboard-tab
