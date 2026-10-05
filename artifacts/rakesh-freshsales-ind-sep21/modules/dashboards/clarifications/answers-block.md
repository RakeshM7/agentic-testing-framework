# Answers block for module dashboards (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior] [Nice-to-have] Why does direct navigation to /crm/sales/my_dashboards often land on Contacts/Deals/Accounts (browser appeared shared with other explorers, or app restores last module)?
  A: This appears to be a false observation. Navigating directly via URL appears to open the right My dashboards module
- Q: [Behavior] [Nice-to-have] Can custom (non-curated) dashboards be created and are widgets editable? Only curated reports were observed; Edit exposed just Discard and filters.
  A: Curated Dashboards can be edited. Custom Dashboards can be created by choosing any reports that are already created through the analytics module.
- Q: [Behavior] [Nice-to-have] What do Email Now / Download export and 'Create new activity' do, and are they safe in test runs?
  A: These are safe in test runs. Email - sends the report via email to the current logged in user. Export directly downloads the file to the user machine.

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Behavior] [Blocking] Discovery described the landing tab as Activities Dashboard (tab 353503) with Export/Edit disabled, but explore found tab 353503 is Sales Essentials Dashboard (Export/Edit enabled), Activities Dashboard is ?tab=activities (native widgets, no Export/Edit), and Sales Dashboard is tab 81767; should test cases target these three observed tabs as the default dashboards?
  A: Yes
- Q: [Behavior] [Blocking] Is the Configure widgets Save (hide/show/reorder of My calendar, Quick Links, Today's summary, Freddy AI insights) safe to execute live in full-run, and should the test restore the original 4/4 visible state afterward?
  A: Yes
- Q: [Behavior] [Blocking] Is removing a dashboard tab (tab X, no confirmation dialog observed) permitted only for tabs created by the run (e.g. Sales Trends), and must the three default tabs never be removed?
  A: Yes
- Q: [Behavior] [Nice-to-have] Which of the 7 popular reports (Chat Dashboard, Ecommerce Marketing Journey Report, Product Dashboard, Team activity report, Sales Trends, Sales Forecast, Contact generation and trends) should add-report-tab tests cover: only Sales Trends, or all of them?
  A: Yes
- Q: [Edge Case] [Nice-to-have] What is expected when the same report is added twice as a tab, or when the report search finds no match?
  A: Yes
- Q: [Behavior] [Nice-to-have] Should tests assert widget values (e.g. Revenue won $12.3K, win rate 66.67%, tasks open 4) or only widget presence/titles, given data is cached (Data Updated stamp) and tenant data may change?
  A: Yes
- Q: [Behavior] [Nice-to-have] What do the activity-type filter, due-date filter (Today) and All/Open/Overdue/Completed pills on the Activities Dashboard do (filter behavior and expected empty state), as these were not fully exercised?
  A: Yes
- Q: [Scope] [Nice-to-have] Should tests cover the Sales Essentials pages not exercised (Contacts, Sales activities, Revenue breakdown), page Rename/Delete, favourite star, and filter panel +filter/+date range, or only the observed flows in flows/index.json?
  A: Yes
- Q: [Scope] [Blocking] The top-bar 'Request demo' button auto-creates a Freshdesk support ticket; should tests explicitly exclude clicking it (and is the already-created ticket 21095814 to be closed by a human)?
  A: Yes
- Q: [Behavior] [Nice-to-have] Should the Add task / Add meeting buttons on the Activities Dashboard be tested live (creating tasks/meetings owned by the run, then deleting them) or excluded?
  A: Yes
