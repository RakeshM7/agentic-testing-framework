---
source_agent: explore-agent
date: 2026-09-21
target: rakesh-freshsales-ind-sep21
related_files:
  - config/run-config-freshsales.example.yaml
  - claude-agents/explore-agent.md
severity: medium
---

## Finding 1: Target feature description assumes a "Leads" module that this tenant/user doesn't have

**Summary:** The invocation prompt's feature-under-test was "Create and qualify a lead, convert it
into a contact/account, create a deal from it, and move that deal across stages on the sales
pipeline Kanban board — including logging an activity against the deal along the way." This
Freshsales tenant (`rakesh-freshsales-ind-sep21`), for the currently-authenticated user (Rakesh M,
Organization Admin), has **no accessible Leads module at all**.

**Evidence:**
- `GET https://rakesh-freshsales-ind-sep21.myfreshworks.com/crm/sales/leads` returns a 403 page:
  "You are not authorised to perform this operation. / You do not have permissions to view this
  page!"
- The global quick-create ("+") menu (`crm/sales/*`, any page) lists only: Add contact, Add account,
  Add deal, Add product, Add Quote, Add task, Add meeting, Add call log, Send SMS, Send email,
  Create template, Create sales sequence — no "Add Lead" anywhere.
- The left sidebar icon nav has no Leads icon (Dashboards, Contacts, Accounts, Deals, Email,
  Reports, Settings only).
- This is either an Org-Admin-role permission gap, or this Freshsales trial account was provisioned
  in "contact-led" mode without the Leads module enabled — either way, downstream agents
  (requirements-clarification-agent, testcase-generator-agent) that read this run's artifacts and
  try to write lead-creation test cases against `/crm/sales/leads` or an "Add Lead" UI element will
  find neither exists.

**Adaptation taken this run:** Contact records in this tenant have a Lifecycle-stage/Status pipeline
(`New(Lead) -> Contacted -> Interested -> Qualified -> Won/Churned`) that functionally substitutes
for lead creation + qualification. This crawl used that mechanism and documented the substitution
explicitly in `crawl-log.md` and the created contact's `dom-snapshot.md`, so it should already be
visible to whoever reads this run's artifacts — but it's easy to miss if a downstream agent skims
only the feature description from the run-config rather than the explore-agent's crawl-log caveats.

**Suggested fix:**
1. `requirements-clarification-agent`'s Pass-1 question generation should explicitly check
   explore-agent's `crawl-log.md` for a "module not available" / "feature mapping note" style
   callout (this run introduced that phrasing; consider standardizing a machine-greppable marker,
   e.g. a `## Feature-mapping caveats` heading) and surface it as a `[Blocking]` clarification
   question ("Target has no Leads module — should test cases target the Contact lifecycle-stage
   flow instead, or is a different tenant/role expected?") rather than silently assuming the
   feature description is accurate.
2. Consider adding a short note to `docs/conventions.md` or the explore-agent persona itself:
   "if the feature description names a module/entity that isn't reachable during the crawl, don't
   silently substitute — substitute *and* flag it loudly enough that clarification/test-case
   generation agents can't miss it." This run did flag it, but there's no enforced convention that
   guarantees the next agent looks for it.

## Resolution (2026-09-21)

**Finding 1 — Fixed (the two framework-level suggestions); the underlying tenant-specific fact itself (no Leads module for this role) is not a bug and needed no code change.**
- **Files changed:** `claude-agents/explore-agent.md`, `copilot-agents/explore-agent.agent.md`, `claude-agents/requirements-clarification-agent.md`, `copilot-agents/requirements-clarification-agent.agent.md`, `docs/conventions.md`.
- **Change (suggestion 2, the marker convention):** explore-agent's crawl-log-emission step now explicitly instructs: *"If the invocation prompt's feature description names a module/entity/action that turns out not to be reachable during the crawl... and you substitute an equivalent real mechanism instead of simply failing, document that substitution under a dedicated `## Feature-mapping caveats` heading in this file... a machine-greppable marker `requirements-clarification-agent` checks for."* Standardized on exactly the heading text this finding proposed.
- **Change (suggestion 1, the consuming side):** requirements-clarification-agent's Pass 1 step 1 now explicitly instructs checking `crawl-log.md` for that heading and, if present, turning it into a `[Blocking]` clarification question rather than silently trusting the substitution -- using this finding's own suggested question wording as the example.
- **Change (documentation):** Added a corresponding bullet to `docs/conventions.md`'s "Standing safety guardrails" section describing the convention end-to-end (explore-agent documents it under the heading; requirements-clarification-agent greps for it and blocks on it), so it's discoverable independent of either persona file.
- **Verification:** Re-read all four edited persona files; confirmed frontmatter untouched/still parses and the new instructions read coherently with the surrounding numbered steps in each. No automated test applies to prose-instruction changes like this.
