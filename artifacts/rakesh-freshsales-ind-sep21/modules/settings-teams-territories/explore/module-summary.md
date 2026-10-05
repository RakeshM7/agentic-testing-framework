# Module summary: Admin Users, Roles, Territories, Teams, Auto-assignment
Purpose: administer who can use the CRM, what they can do, and how records route.
Entities:
- User: email*, full name*, job title, work/mobile number, reporting to, teams, default pipeline, role*. Tenant has 1 active user (Rakesh M, Account Admin); 100 licenses, 99 remaining. List columns: User, Email, Reporting manager, Role, Last login, Territories, Teams, Default pipeline. Tabs: All, Active (1), Deactivated.
- Role: 5 roles (Account Admin [CPQ licensed, 1 used/0 left], Administrator, Sales Manager, Sales User, Restricted User). Permission matrix across 18 sections with data scope (All records / Territory or Group only / Owned only). Role create requires name and a role to clone.
- Territory: none exist. Name*, description, parent/child (requires hierarchy setting), users/teams. Advanced settings: territory hierarchy, auto-assign territory to records.
- Team: none exist. Name*, members* (at least one). Lives at /crm/sales/team-settings/teams.
- Auto-assignment rule: ordered list (US/EU/Web lead routing + more), module Contacts, conditions groups, round-robin user list (users/teams/territories), Save as draft / Enable.
Permissions: Account Admin only tested; user edit disables own role and reporting-to.
Links: Workflows (/crm/sales/workflow-automations) from same settings group; Manage plan/Buy licenses go to billing (not followed).
Open questions: see open-questions.csv rows for this module.
