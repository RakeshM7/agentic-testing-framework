# Crawl log: conversations module
Mode: full-run. Authenticated crawl via sessionStateFile (Organization Admin, Rakesh M). Pages captured: 24 (incl. 2 drawers, 1 composer). Max depth ~3.

## Created entities
2 email templates ('ZZ Explore Conv Template' and its auto-suffixed duplicate); both deleted (single row Delete and bulk Delete). The first Save with a fill()-typed name gave no toast but did persist. No SMS template created (creation failed).

## Skipped
- Provider tiles (Gmail/Outlook/Zoho/Others), Connect Gmail, Connect a different email: third-party OAuth.
- Send / Reply Send / Forward: no real emails.
- Template 'Share': blocked by permission classifier (grants access to others).
- 'Add Team Inbox', 'Set up SMS': change account config.
- Request demo, Explore plans: forbidden / billing.
- Power Dialer List, Chat Inbox: leave module (other apps).

## Feature-mapping caveats
- Discovery said mail lists are empty because no mailbox is connected. Actually Inbox, Sent, Opens, Clicks contain sample (seeded) emails; Scheduled, Drafts, Trash, Bulk, Bounces are empty. Module also includes Awaiting Response, Bulk Email, Email Tracking, Phone, SMS and Chat groups not in discovery subPages.
- Email template rows in the list carry the discovery label 'Email Templates'; templates are system-seeded (9 Public).

## Coverage gaps
- network-requests.json and console-log.txt are placeholders (not captured per page); baseline console: 3 errors, ~9 warnings on every page (resource 4xx, expired Appcues).
- dom-snapshot.md full snapshots only for team-inbox, inbox, email-thread, email-templates, email-template-create; others are text observations.
- Not exercised: template Clone, Edit-save, Share, search box, Forward, Use template, Insert fields, Attach, row checkboxes on mail lists, mail list bulk actions, Awaiting Response contents (could not populate), Sales Sequences tab (other module), valid SMS template, 'Email linked to contacts, deals' menu, Power Dialer/Chat.
- Mail row 'kebab' menus on Inbox not opened.
