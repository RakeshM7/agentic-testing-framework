---
slug: view-phone-and-sms
title: View phone calls, voicemail, SMS and SMS templates
module: conversations
nav_path: Conversations > Phone / SMS
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View phone calls, voicemail, SMS and SMS templates.
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | any | click 'All phone calls' | 2 manual call logs, filters 'Phone number: All', 'Owner: All' | all-phone-calls |
| 2 | any | click 'Voicemail' | No conversations found. | voicemail |
| 3 | any | click 'All SMS' | 'No conversations found.' with 'Set up SMS' | all-sms |
| 4 | any | click 'SMS Templates' | 'No SMS templates found.' | sms-templates |
| 5 | any | click 'Power Dialer List' / 'Chat Inbox' | leaves module (/crm/phone/power-dialer, /crm/messaging/inbox); not followed | - |
## Outcome
See steps.
## Variations and errors
Phone/Chat live in other apps.
## Cleanup
n/a
## Related flows
open-conversations-module
