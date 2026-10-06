---
source_agent: playwright-automation-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - playwright-tests/freshsales/pages/conversations/ConversationsPage.ts
  - playwright-tests/freshsales/tests/functional/conversations/email-templates.spec.ts
  - artifacts/rakesh-freshsales-ind-sep21/modules/conversations/testcases/conversations-testcases.csv
severity: low
---

## Finding 1: Conversations sub-nav groups are collapsed; flows omit the expand step
**Summary:** Opens/Clicks/Bounces, Bulk email *, Phone and SMS links are hidden until their group header (Email Tracking, Bulk Email, Phone, SMS) is clicked. Testcase steps say "Click link 'Opens'" with no expand step.
**Suggested fix:** explore flows / testcases should include "expand group" as a step.

## Finding 2: Drawer Cancel/close can be swallowed
**Summary:** The first click on Cancel (Edit template) or the X (New mail composer) intermittently does nothing while the editor settles. The suite retries via expect().toPass().

## Finding 3: Testcase expectations vs live behaviour
- TC-033/045: the empty-name message is a transient toast, and the drawer stays open (matches testcase). TC-028 Clone opens a prefilled Create drawer named '<name> - Copy' that needs Save (testcase assumed a direct copy). TC-001 'Email Conversation' is not a visible text node on the thread page, so it was not asserted.
- Composer 'Send email' top-bar icon: two `[title="Send email"]` anchors exist, only `a.send-email` is the visible one.
- Email template list does not refresh in place and newly saved rows can lag 1-2s on reload; specs wait on row visibility, not toasts.

## Suggestion
Cleanup in a serial describe must live in test.afterAll (not a final test) so a mid-chain failure still deletes created entities; ConversationsPage.cleanupPending guards every row via the track's created-entities.json prefix match.
