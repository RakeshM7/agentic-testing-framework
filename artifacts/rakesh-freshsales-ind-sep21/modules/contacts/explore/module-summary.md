# Contacts module summary
**Purpose:** list and manage people (leads/contacts) the team sells to, at /crm/sales/contacts.

**Entities and fields:** Contact (Email [required], First name, Last name, Account (lookup, can add multiple), Job title, Mobile, Work phone, Sales owner (default current user), extra email with label; ~50 more fields available as columns/filters: Lifecycle stage, Status, Score, Customer fit, Territory, Source, Tags, Campaign/Medium, Subscription status, etc.). Related: Account, Deals, Tasks, Meetings, Notes, Files, Conversations.

**Lifecycle:** Lifecycle stage (Lead default) plus Status (New, Contacted, Interested / Unqualified, Qualified / Lost, Won / Churned). New contact: Lead / New, score 32, owner Rakesh M. Seeded AgentTest contacts show status Qualified. Deletion is soft (Recycle Bin, 90 days, view /contacts/view/402015942739).

**Rules/validations observed:** Email required ("You need to fill this field"); invalid email "Enter a valid email address"; "Check for duplicates" matches exactly on Email, Work email, Work phone, Mobile, Other phone numbers. Successful save redirects to the detail page. Delete asks "Delete this contact and its related data?".

**Views:** default view id 402015942732 sorted by lead score; 14 more views incl. Recycle Bin; table/status/group-by view types.

**Permissions seen:** admin-like (Admin Settings visible, all actions available).

**Links to other modules:** Account column/field and Accounts tab; Deals tab and Add deal; Sales sequences; Conversations; Tasks/Meetings.

**Open questions:** see open-questions.json.
