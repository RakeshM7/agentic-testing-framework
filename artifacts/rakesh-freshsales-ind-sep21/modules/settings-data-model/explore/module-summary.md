# Module summary: settings-data-model
Purpose: admin configuration of the CRM data model: contact/account fields and layouts, custom modules, lifecycle stages/statuses, scoring, lead capture (web forms, code library, LinkedIn) and tags.
## Entities
- Field: label, internal name (cf_ prefix), type (Text field, Text area, Number, Dropdown, Checkbox, Radio, Date picker, Lookup, Multiselect, URL, Formula, Auto-number), tooltip, placeholder, group, flags Required / Quick-add / Read-only / Unique / Track edit history. 52 further system fields can be added to Contacts layout. Dropdown fields have choices (Accounts: Industry type 68, Business type 10, Number of employees 8).
- Groups/sub-groups (Basic information; Telephone numbers sub-group). Module rename, Preview, field dependencies.
- Custom module: singular/plural name, internal name (cm_), icon, description. None exist.
- Lifecycle stage: Lead (New, Contacted, Interested, Unqualified), Sales Qualified Lead (Qualified, Lost), Customer (Won, Churned); stages toggleable/reorderable; each stage needs statuses, one can be flagged Closed Lost. Auto-rules: deal added -> Sales Qualified Lead; deal won -> Customer (both enabled).
- Contact scoring: positive/negative signals (none), automation threshold 70 -> tag "Likely to buy" and/or stage change.
- Web forms: none. LinkedIn lead gen forms: none (needs LinkedIn connection). Code library: Ruby, Java, PHP, Python.
- Tags: 13 record tags, color, creator, created/last used; tabs for Email Template, SMS Template, File tags; private suggestions toggle.
## Observed rules
Email on contact: Required? no flag shown as set beyond Unique/Quick-add/Read-only labels; Account name is Required+Quick-add+Unique on accounts. Add selected stays disabled until a field/type is chosen. Add field form requires Field label, Internal name, Field type.
## Permissions
Admin owner can open all pages. Mutation by the explorer was blocked (see crawl-log).
## Links
Contacts, Accounts, Deals (lifecycle rules), marketer app (embed code), field dependencies page.
## Open questions
See open-questions.csv rows for this module.
