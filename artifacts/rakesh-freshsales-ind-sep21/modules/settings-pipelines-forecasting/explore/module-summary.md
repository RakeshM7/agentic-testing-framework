# Module summary: Admin: Deals, Pipelines and Forecasting
Purpose: tenant-wide admin configuration of the deal data model and sales process. Group tiles under Admin Settings > Deals & Pipelines: Deals, Sales Activities, Pipelines, Activity Goals, Quotas and Forecasting, Product Catalog.
## Entities
- Pipeline: name, default flag, ordered deal stages (name, probability %), fixed closing stages Won (100%) / Lost (0%), summarize-by (Deal value), stale days (form default 365; Default Pipeline set to 30). Existing: Default Pipeline with stages New 20, Qualification 30, Discovery 40, Demo 60, Negotiation 80, Won 100, Lost 0.
- Deal fields (single group Basic information): Related contact, Related account, Deal type, Deal name*, Currency, Deal value*, Pipeline, Deal stage, Lost reason, Closed date, Sales owner. Flags Required, Quick-add, Read-only, tooltip, choices. 23 further standard fields addable (Tags, Probability, Territory, Forecast category, Expected close date, Source, Campaign ...), plus 10 custom types.
- Field dependencies (4 system-defined, enabled): Pipeline->Deal stage, Deal stage->Lost reason, Deal stage->Closed date, Forecast category->Expected close date; max 100.
- Forecast categories: Committed, Best-case (default). Toggles: Quotas and Forecasting on; Freddy AI deal insights off; Freddy AI commit suggestions.
- Sales activity types: Task, Meeting, Phone (editable), Email, Reminder, SMS, Chat; custom creation with icon, flags, outcomes.
- Activity goals: none exist (My goals (0)).
## Rules observed
Deal name and Deal value are required and locked; Won/Lost closing stages locked; Save disabled until Create pipeline form valid; Lost reason/Closed date driven by Deal stage dependency.
## Permissions
Admin session had full view access. Plan: trial.
## Links
Deals module (consumes pipelines/stages/fields), Products-quotes (Product Catalog), sales-activities, Activity Goals page outside settings shell.
## Not verified
All saves, validation messages, deletion behavior, quota setup (see open-questions.csv and crawl-log Coverage gaps).
