# Analytics module summary
Purpose: report library and builder (Freshsales analytics). Entities: Report (name, description, created/modified by/date, pages, widgets, Curated flag, favorite, private/shared), Widget (Chart/Filter/Text/Image/Gallery template), Schedule (name, frequency Monthly etc, day/time, timezone, recipients, subject, description, format PDF), Data Export, Custom Metric, Custom Attribute (name, description, module, data type, formula).
Seeded curated reports (System): Ecommerce Marketing Journey Report, Sales Essentials Dashboard, Product Dashboard, Sales Dashboard, Team activity report, Sales Trends, Sales Forecast, Contact generation and trends. List shows 10/page.
Lifecycle: New Report builder -> Save -> view mode (Edit / Export / star / Report Details / Clone / Move to trash) -> Trash (soft delete).
Rules observed: Schedule name required ('Schedule name cannot be empty'); Send to defaults to logged-in user; Report format PDF fixed. Report builder named "Untitled Report" by default. Gallery supports 26 data entities. Opening /analytics redirects to last viewed report.
Permissions: org admin; all controls visible.
Links to other modules: reports read contacts, accounts, deals (e.g. 15 deals owned by Rakesh M in the template widget). Unclear: Quota vs achievement shows 'No data!'.
Open questions: see open-questions.csv.
