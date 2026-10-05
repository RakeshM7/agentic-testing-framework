# Accounts module summary
Purpose: companies linked to contacts and deals. Entity Account: Name (required), Website (server-validated format), Phone (no validation seen for "abc"), Sales owner (default current user), Industry type, Business type, Number of employees (dropdown ranges, e.g. 1-10, 51-200), Tags, Annual revenue, Territory, Parent account, Last contacted time/mode, Open deals amount, Related contacts. 50 fields available in table (9 visible).
Views: My accounts, All accounts, Recycle Bin, My territory accounts, Recently imported, Accounts with me in account team; custom views via Add new view / Save view as. Tenant has 15 accounts (5 AgentTest Co, Explore Test Co, 9 sample accounts).
Lifecycle: Create -> (edit/clone) -> Delete = soft delete to Recycle Bin for 90 days; optional checkbox deletes related contacts and deals. Forget action exists (permanent).
Validations: Name empty -> "can't be empty"; invalid website -> toast "Failed to create Account. The value for website is not in required format."
Detail page tabs: Overview, Account details, Conversations, Activities, Contacts, Deals, Files, Freddy AI insights, Apps in marketplace.
Permissions: org admin sees everything incl. Delete, Forget, Merge, Import.
Links to other modules: Contacts (Related contacts, Add contact), Deals (Add deal, Open deals amount), Sequences (bulk Add to sequence), Activities.
Open questions: see open-questions.csv.
