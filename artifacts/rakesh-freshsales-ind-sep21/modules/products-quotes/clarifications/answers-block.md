# Answers block for module products-quotes (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior] [Blocking] What are the rules for sending a quote (Send to customer): required fields ('2 fields to be filled'), stage transitions Draft > Sent > Accepted/Declined, and email behaviour?
  A: The mandatory fields are highlighted in the page, fill them and retry send
- Q: [Behavior] [Blocking] When products are added to a quote (Add or edit products) with 'Add products to deals' on, does it overwrite the linked deal's amount and what does 'Sync quote with deal' change?
  A: Yes it overrides
- Q: [Behavior] [Nice-to-have] Are duplicate product names or product codes blocked on create/clone?
  A: Duplicate product names are blocked on create and clone

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope] [Nice-to-have] Why do Quotes have no left-nav entry, and is the Quotes list (/crm/sales/cpq_documents/view/...) intended to be reachable only via URL/+ menu?
  A: yes
- Q: [Scope] [Blocking] Feature-mapping caveat: quotes require an existing Deal and Primary contact (no standalone quote creation, and no left-nav Quotes entry); for quote create/delete tests, may the run create its own throwaway Deal and Contact as prerequisites (deleted at cleanup), or must a specific pre-existing deal be used (read-only, never modified)?
  A: yes
- Q: [Scope] [Blocking] Should test cases cover the quote flows explore-agent did not reach (Edit quote overlay, Clone quote, Preview, Save PDF, quote stage transitions, Add or edit products Save), given Save would alter the linked deal amount, and if yes should they use only a run-created deal so no pre-existing deal is touched?
  A: yes
- Q: [Scope] [Blocking] Send to customer and Import products would email real addresses or bulk-write data: should these be generated as test cases but excluded from live execution, or executed live with a designated test email/CSV (please name the address/file)?
  A: yes
- Q: [Behavior] [Blocking] Create template: with valid Template name and Quote type, should test cases create a real document template (run-created, then deleted), and what are the expected validation messages for blank Template name and blank Quote type?
  A: yes
- Q: [Behavior] [Blocking] Create product validation: what are the expected rules and messages for required fields (Name, Pricing type, Unit price on clone), negative or non-numeric unit price, maximum Name length, and Product code/SKU uniqueness?
  A: yes
- Q: [Behavior] [Nice-to-have] Subscription pricing: should test cases cover creating a Subscription-type product (billing cycle/term fields) and multi-currency prices, or only One-time pricing?
  A: yes
- Q: [Behavior] [Nice-to-have] CPQ Settings Pricing radios (One-time/Subscription/Both) appeared disabled for this account: is that expected (plan/permission restriction), and should tests only assert the read-only state rather than changing settings?
  A: yes
- Q: [Edge Case] [Nice-to-have] After deleting a product or quote (moved to Recycle Bin for 90 days), should tests verify it appears in the Recycle Bin and can be restored, or is verifying disappearance from the list sufficient?
  A: yes
- Q: [Edge Case] [Nice-to-have] Should tests include a product that is already used on a quote being edited, deactivated (Active off) or deleted, and what behaviour is expected for the quote?
  A: yes
- Q: [Scope] [Nice-to-have] Are Quotes list Filters, Edit columns, sorting, Manage Quote types, Customize fields and Products category filter/bulk actions in scope for test cases despite not being explored?
  A: yes
