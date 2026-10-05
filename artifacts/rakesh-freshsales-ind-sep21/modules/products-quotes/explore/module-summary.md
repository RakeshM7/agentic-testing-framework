# Products and Quotes (CPQ) summary
**Purpose:** product catalog plus quote documents tied to deals. Settings in Admin Settings > CPQ Settings and Document Templates.

**Entities**
- Product: Name*, Category (Software, Maintenance, Hardware, Consumables, Setup...), Active, Pricing type* (One-time/Subscription; locked after create), Currency + Unit price* (multi-currency via 'Add price in another currency'), Product code, SKU number, Owner, Valid till, Parent product, Description, External ID, system fields. Drawer UI; no detail page URL.
- Quote (cpq_document): Deal* (locked after create), Primary contact*, Account, Quote type* (Quote/Proposal/NDA/MSA), Quote name (auto '<deal> - Quote'), Quote template*, Quote value, Quote currency (follows deal), Quote stage (Draft; then Sent to customer, Accepted/Declined), Valid till, addresses. Auto number DOC-n.
- Document template: Name*, Quote type*; samples Sample Template, Sample Signature Template.

**Rules and validations observed**
- Product clone/create: Unit price required ("Can't be empty"); Name required; pricing type not editable on edit; clone does not copy price.
- Quote create: Deal, Primary contact, Quote template required ("Can't be empty"). Selecting a deal prefills name and currency.
- Template create: both fields required.
- Delete product/quote is soft (Recycle Bin, 90 days) after Yes/No confirm.
- CPQ settings: pricing type is Both and locked; 'Add products to deals' on (deal value read-only, recalculated); taxes enabled 0%; quotes enabled with 4 quote types.

**Permissions:** account could do all of the above; no permission failures seen.
**Links to other modules:** Quote requires Deal and Contact (+ optional Account); quote products affect deal value; Customize fields links go to field settings.
**Entry points:** no left-nav item; Products at /crm/sales/products, Quotes list at /crm/sales/cpq_documents/view/<viewId>, + menu has Add product and Add Quote.
**Open questions:** appended to artifacts/rakesh-freshsales-ind-sep21/open-questions.csv (4 rows, module products-quotes).
**Coverage:** partial; see crawl-log.md Coverage gaps.
