# Dashboards module summary
Purpose: analytics landing area. Three default tabs: Sales Essentials Dashboard (353503, curated, 5 pages Summary/Deals/Contacts/Sales activities/Revenue breakdown), Sales Dashboard (81767, curated), Activities Dashboard (?tab=activities, native: tasks/meetings list with Add task/Add meeting, activity type filter, due-date filter, widgets My calendar, Quick Links, Today's summary, Freddy AI insights, Configure widgets). Extra curated reports can be added via "+" (7 popular reports) and removed via tab X.
Entities: Dashboard tab (id, name, curated flag, pages), Widget/report. Data via freshworkscrm-ind.freshreports.com (reportgroups API) and /crm/sales/analytics_dashboard, /crm/sales/activities_dashboard.
Observed data: Revenue won $12.3K, lost $6.2K, win rate 66.67%, contacts by owner 2, tasks open 4, quota widget "No data!". Data Updated stamp 04 Oct 2026 19:14 (cached, not live).
Rules: curated dashboards: Export (Email Now/Download), Edit enters a limited mode (Discard + filters). Tab removal has no confirmation.
Links to other modules: widgets derive from contacts, accounts, deals, tasks. Top bar Request demo triggers a support ticket.
Open questions: see open-questions.json.
